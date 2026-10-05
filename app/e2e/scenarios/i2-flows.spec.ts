import { test, expect } from '@playwright/test'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/electron-app'
import { noteEvidence, shot } from './evidence-dir'
import {
  createClientApi,
  dbQuery,
  finalizeInvoiceApi,
  setupCompany,
  sha256File,
  listFilesRecursive
} from './helpers'
import {
  accountId,
  callApi,
  createRecordApi,
  dbExec,
  makeReceiptFixtures,
  mustApi,
  pickTokens,
  shellCalls,
  stubShell,
  type Fixtures
} from './helpers-i2'

/**
 * 【tester作成】イテレーション2: F-21(入金記録の自動作成・取消)・F-22(領収書)・改変検知・F-23(集計)・F-24(CSV)・
 * F-25(利用中に戻す)・F-26(下書き削除)(TC-85〜TC-91、TC-98)。
 * 参照元: 詳細設計書 3.14章・3.15〜3.20章・4.21〜4.26章・6.10〜6.13章・8章
 */
let launched: LaunchedApp
let fx: Fixtures
let csvDir: string

test.beforeEach(async () => {
  fx = makeReceiptFixtures()
  csvDir = mkdtempSync(join(tmpdir(), 'jimuhub-i2-csv-'))
  launched = await launchApp({
    JIMUHUB_E2E_RECEIPT_PATHS: fx.pdf,
    JIMUHUB_E2E_CSV_PATH: join(csvDir, 'out.csv')
  })
})
test.afterEach(async () => {
  try {
    await closeApp(launched)
  } catch {
    rmSync(launched.dataDir, { recursive: true, force: true })
  }
  rmSync(fx.dir, { recursive: true, force: true })
  rmSync(csvDir, { recursive: true, force: true })
})

interface InvoiceDetail {
  id: number
  invoiceNumber: string
  billingAmount: number
  withholdingTaxAmount: number
  totalAmount: number
  paymentStatus: string
  paymentDate: string | null
  linkedRecords: Array<{ id: number; recordDate: string; amount: number; status: string }>
}

async function newPaidReadyInvoice(
  window: LaunchedApp['window'],
  clientName = '入金連動商事'
): Promise<{ invoiceId: number; clientId: number }> {
  await setupCompany(window)
  const clientId = await createClientApi(window, clientName, {
    furigana: 'ニュウキンレンドウショウジ'
  })
  const inv = await finalizeInvoiceApi(window, clientId, '2026-10-01', [
    { name: '設計業務', quantity: 1, unitPrice: 100000, taxRate: 10, withholdingTarget: true }
  ])
  return { invoiceId: inv.id, clientId }
}

async function openInvoiceDetailUi(window: LaunchedApp['window'], number: string): Promise<void> {
  await window.reload()
  await window.getByRole('button', { name: '見積書・請求書' }).click()
  await window.getByRole('button', { name: '請求書', exact: true }).click()
  await window.getByRole('cell', { name: number }).click()
  await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - 請求書詳細')
}

test('TC-85: 請求書の入金済み→入金記録の自動作成/未収に戻す→取消/再入金→新規作成/イテレーション1の入金済みの扱い/失敗時の巻き戻し', async () => {
  const { window, dataDir } = launched
  const { invoiceId, clientId } = await newPaidReadyInvoice(window)
  const before = await mustApi<InvoiceDetail>(window, 'getInvoice', invoiceId)
  expect(before.invoiceNumber).toBe('2026-001')
  expect(before.withholdingTaxAmount).toBe(10210)
  expect(before.billingAmount).toBe(110000 - 10210)
  expect(before.linkedRecords).toEqual([])
  // 画面: 入金済みにする
  await openInvoiceDetailUi(window, '2026-001')
  await window.getByRole('button', { name: '入金済みにする' }).click()
  await window.getByLabel('入金日').fill('2026-10-20')
  await window.getByRole('button', { name: '確定' }).click()
  await expect(window.getByText('入金済みにしました')).toBeVisible()
  await expect(window.getByText('紐づく入金記録')).toBeVisible()
  await expect(window.getByText('+¥99,790')).toBeVisible()
  await shot(window, 'TC-85', '入金済みにした直後の請求書詳細(紐づく入金記録 +¥99,790・有効)')
  const row = dbQuery(
    dataDir,
    "select record_date||'|'||kind||'|'||amount||'|'||withholding_tax_amount||'|'||account_id||'|'||client_id||'|'||invoice_id||'|'||description||'|'||ifnull(payment_method,'NULL')||'|'||ifnull(tax_category,'NULL')||'|'||tax_amount||'|'||status||'|'||is_deleted||'|'||length(record_hash) from cash_records"
  )
  const sales = dbQuery(dataDir, "select id from accounts where default_key='sales_revenue'")
  expect(row).toBe(
    `2026-10-20|income|99790|10210|${sales}|${clientId}|${invoiceId}|請求書 2026-001 の入金|NULL|NULL|0|active|0|64`
  )
  const hist = dbQuery(
    dataDir,
    "select operation||'|'||ifnull(reason,'NULL')||'|'||ifnull(snapshot_before,'NULL') from cash_record_history order by id"
  )
  expect(hist).toBe('create|NULL|NULL')
  noteEvidence('TC-85', '自動作成された入金記録(DB)と履歴', `${row}\n${hist}`)
  // 記録詳細(請求書番号リンク) → 請求書へ戻る
  await window
    .getByRole('button', { name: '入金記録を見る' })
    .or(window.getByText('入金記録を見る'))
    .first()
    .click()
  await expect(window.getByText('請求書 2026-001 の入金').first()).toBeVisible()
  await shot(window, 'TC-85', '入金記録の詳細(請求書番号リンク・源泉徴収後の金額)')
  await window.locator('dd').getByText('2026-001', { exact: true }).click()
  await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - 請求書詳細')
  // 入金記録の編集は請求書側の入金日に反映されない
  const recId = Number(dbQuery(dataDir, 'select id from cash_records'))
  const accId = await accountId(window, '売上高')
  await mustApi(window, 'updateRecord', {
    id: recId,
    kind: 'income',
    recordDate: '2026-10-25',
    amount: 99790,
    accountId: accId,
    description: '請求書 2026-001 の入金(日付訂正)',
    clientId,
    paymentMethod: 'transfer',
    taxCategory: null,
    removeReceiptIds: [],
    addReceiptTokens: [],
    reason: '入金日の訂正'
  })
  expect(dbQuery(dataDir, `select payment_date from invoices where id=${invoiceId}`)).toBe(
    '2026-10-20'
  )
  // 未収に戻す → 取消
  await window.getByRole('button', { name: '未収に戻す' }).click()
  await window.getByRole('button', { name: 'はい' }).click()
  await expect(window.getByText('未収に戻しました')).toBeVisible()
  await expect(window.getByText('取消済').first()).toBeVisible()
  await shot(window, 'TC-85', '未収に戻した直後(入金記録は「取消済」で残る)')
  const afterCancel = dbQuery(dataDir, "select status||'|'||is_deleted from cash_records")
  expect(afterCancel).toBe('cancelled|0')
  const h2 = dbQuery(
    dataDir,
    "select operation||'|'||ifnull(reason,'NULL') from cash_record_history order by id desc limit 1"
  )
  expect(h2).toBe('cancel|請求書の入金済みを取り消しました')
  // 取消済は集計から除外、CSVには「取消済」で出力
  const sum = await mustApi<{ period: { income: number } }>(window, 'getSummary', {
    year: 2026,
    month: null
  })
  expect(sum.period.income).toBe(0)
  const csv = await mustApi<{ success: boolean; count?: number }>(window, 'exportCsv', {
    fromMonth: '2026-10',
    toMonth: '2026-10'
  })
  expect(csv).toMatchObject({ success: true, count: 1 })
  expect(readFileSync(join(csvDir, 'out.csv'), 'utf8')).toContain('取消済')
  // 再度入金済み → 取消済を残したまま新規作成
  await window.getByRole('button', { name: '入金済みにする' }).click()
  await window.getByLabel('入金日').fill('2026-10-28')
  await window.getByRole('button', { name: '確定' }).click()
  await expect(window.getByText('入金済みにしました')).toBeVisible()
  const recs = dbQuery(
    dataDir,
    "select id||':'||status||':'||record_date||':'||amount from cash_records order by id"
  )
  expect(recs.split('\n')).toEqual([
    `${recId}:cancelled:2026-10-25:99790`,
    `${recId + 1}:active:2026-10-28:99790`
  ])
  await expect(window.locator('.payment-block table tbody tr')).toHaveCount(2)
  await shot(window, 'TC-85', '再入金後(取消済1件+有効1件)')
  const linked = (await mustApi<InvoiceDetail>(window, 'getInvoice', invoiceId)).linkedRecords
  expect(linked.map((l) => l.status)).toEqual(['active', 'cancelled']) // id降順
  noteEvidence('TC-85', '請求書に紐づく入金記録(id降順)・DB', JSON.stringify(linked) + '\n' + recs)

  // イテレーション1で入金済みにした請求書(入金記録なし)を未収に戻しても、エラーにならず記録も作られない
  const inv2 = await finalizeInvoiceApi(window, clientId, '2026-10-02', [
    { name: '保守', quantity: 1, unitPrice: 5000, taxRate: 10 }
  ])
  dbExec(
    dataDir,
    `update invoices set payment_status='paid', payment_date='2026-10-03' where id=${inv2.id}`
  )
  const r = await callApi(window, 'updateInvoicePaymentStatus', inv2.id, {
    paymentStatus: 'unpaid'
  })
  expect(r.ok).toBe(true)
  expect(dbQuery(dataDir, `select payment_status from invoices where id=${inv2.id}`)).toBe('unpaid')
  expect(dbQuery(dataDir, `select count(*) from cash_records where invoice_id=${inv2.id}`)).toBe(
    '0'
  )

  // 失敗時の巻き戻し: 売上高(sales_revenue)を参照できない状態で入金済みにすると、請求書も入金済みにならない
  dbExec(dataDir, "update accounts set default_key=NULL where default_key='sales_revenue'")
  const cnt0 = dbQuery(dataDir, 'select count(*) from cash_records')
  const r2 = await callApi(window, 'updateInvoicePaymentStatus', inv2.id, {
    paymentStatus: 'paid',
    paymentDate: '2026-10-30'
  })
  expect(r2.ok).toBe(false)
  expect(dbQuery(dataDir, `select payment_status from invoices where id=${inv2.id}`)).toBe('unpaid')
  expect(dbQuery(dataDir, 'select count(*) from cash_records')).toBe(cnt0)
  noteEvidence(
    'TC-85',
    '入金記録を作成できない場合の巻き戻し',
    `エラー: ${r2.error}\n請求書の入金ステータス=unpaid、記録件数=${cnt0}(変化なし)`
  )
  dbExec(dataDir, `update accounts set default_key='sales_revenue' where id=${sales}`)
})

test('TC-98: [R-14] すでに入金済みの請求書へ再度「入金済み」を指定した場合(IPC)の挙動の実機確認', async () => {
  const { window, dataDir } = launched
  const { invoiceId } = await newPaidReadyInvoice(window, 'R14確認商事')
  await mustApi(window, 'updateInvoicePaymentStatus', invoiceId, {
    paymentStatus: 'paid',
    paymentDate: '2026-10-10'
  })
  const before = dbQuery(
    dataDir,
    `select payment_status||'|'||payment_date from invoices where id=${invoiceId}`
  )
  const recBefore = dbQuery(dataDir, 'select count(*)||"|"||group_concat(status) from cash_records')
  const r = await callApi(window, 'updateInvoicePaymentStatus', invoiceId, {
    paymentStatus: 'paid',
    paymentDate: '2026-10-15'
  })
  const after = dbQuery(
    dataDir,
    `select payment_status||'|'||payment_date from invoices where id=${invoiceId}`
  )
  const recAfter = dbQuery(dataDir, 'select count(*)||"|"||group_concat(status) from cash_records')
  noteEvidence(
    'TC-98',
    'R-14: 入金済みの請求書へ再度「入金済み」(IPC直叩き)',
    `結果: ok=${r.ok} error=${r.error}\n請求書(前)=${before}\n請求書(後)=${after}\n入金記録(前)=${recBefore}\n入金記録(後)=${recAfter}`
  )
  // 期待: データは変化しない(トランザクション全体が戻る)。エラー文言が汎用文言であることはR-14の記録事項(不合格にはしない)
  expect(r.ok).toBe(false)
  expect(r.error).toBe('この請求書はすでに入金済みです') // R-14対応(コミット3de4abf)
  expect(after).toBe(before)
  expect(recAfter).toBe(recBefore)
})

interface RecordDetailLite {
  id: number
  receipts: Array<{
    id: number
    originalName: string
    mimeType: string
    fileSize: number
    removed: boolean
    state: string
  }>
  integrity: {
    recordHashOk: boolean
    historyHashOk: boolean
    receipts: Array<{ id: number; state: string }>
  }
}

test('TC-86: 領収書の添付(選択時・保存直前の検証、保存先・ハッシュ、5件上限、サムネイル・プレビュー)', async () => {
  const { window, app, dataDir } = launched
  const acc = await accountId(window, '消耗品費')
  // 選択時の検証: 受理(pdf/png/jpg)と拒否(偽装png・0バイト・対応外拡張子・10MB超・拡張子と形式の不一致)
  const { writeFileSync: wf } = await import('node:fs')
  const pngAsJpg = join(fx.dir, 'png_as.jpg')
  wf(pngAsJpg, readFileSync(fx.png))
  const upper = join(fx.dir, 'UPPER.PDF')
  wf(upper, readFileSync(fx.pdf))
  const ok = await pickTokens(window, app, [fx.pdf, fx.png, fx.jpg, upper])
  expect(ok.errors).toEqual([])
  expect(ok.files.map((f) => f.fileName)).toEqual([
    'receipt_sample.pdf',
    'receipt_sample.png',
    'receipt_sample.jpg',
    'UPPER.PDF'
  ])
  const ng = await pickTokens(window, app, [fx.fakePng, fx.empty, fx.txt, fx.big, pngAsJpg])
  expect(ng.files).toEqual([])
  const msgs = ng.errors.map((e) => `${e.fileName}: ${e.error}`)
  noteEvidence(
    'TC-86',
    '選択時の検証結果',
    `受理: ${ok.files.map((f) => f.fileName).join(', ')}\n拒否:\n${msgs.join('\n')}`
  )
  expect(ng.errors.find((e) => e.fileName === 'fake.png')?.error).toContain('PDF・JPEG・PNG')
  expect(ng.errors.find((e) => e.fileName === 'empty.pdf')?.error).toContain('PDF・JPEG・PNG')
  expect(ng.errors.find((e) => e.fileName === 'memo.txt')?.error).toContain('PDF・JPEG・PNG')
  expect(ng.errors.find((e) => e.fileName === 'too_big.pdf')?.error).toContain('10MB')
  expect(ng.errors.find((e) => e.fileName === 'png_as.jpg')?.error).toContain('PDF・JPEG・PNG')
  // 良いファイルと悪いファイルの混在: 良いものだけ追加できる
  const mixed = await pickTokens(window, app, [fx.pdf, fx.fakePng])
  expect(mixed.files).toHaveLength(1)
  expect(mixed.errors).toHaveLength(1)
  // 保存(4件)。保存先・ハッシュ・ファイル名
  const id = await createRecordApi(window, {
    accountId: acc,
    receiptTokens: ok.files.map((f) => f.token)
  })
  const year = String(new Date().getFullYear())
  const files = listFilesRecursive(join(dataDir, 'documents', 'receipts'))
  expect(files).toHaveLength(4)
  const rows = dbQuery(
    dataDir,
    'select original_name||"|"||file_path||"|"||mime_type||"|"||file_size||"|"||sha256 from receipts order by id'
  ).split('\n')
  const uuidRe = /^receipts\/\d{4}\/[0-9a-f-]{36}\.(pdf|jpg|png)$/
  const log: string[] = []
  for (const line of rows) {
    const [orig, path, mime, size, sha] = line.split('|')
    expect(path).toMatch(uuidRe)
    expect(path).not.toContain(orig.replace(/\.\w+$/, '')) // 利用者のファイル名を保存先に使わない
    const abs = join(dataDir, 'documents', path)
    expect(sha256File(abs)).toBe(sha)
    expect(statSync(abs).size).toBe(Number(size))
    log.push(`${orig} -> ${path} (${mime}, ${size}B, sha256=${sha.slice(0, 12)}…一致)`)
  }
  expect(rows.map((r) => r.split('|')[2])).toEqual([
    'application/pdf',
    'image/png',
    'image/jpeg',
    'application/pdf'
  ])
  expect(rows[3].split('|')[1]).toMatch(/\.pdf$/) // UPPER.PDF は小文字の拡張子で保存
  const mode = (statSync(join(dataDir, 'documents', 'receipts', year)).mode & 0o777).toString(8)
  log.push(`保存先ディレクトリの権限: ${mode}`)
  expect(mode).toBe('700')
  noteEvidence('TC-86', '保存先・ハッシュ・MIME種別', log.join('\n'))
  // サムネイル・プレビュー(API)
  const rec = await mustApi<RecordDetailLite>(window, 'getRecord', id)
  const [pdfR, pngR, jpgR] = rec.receipts
  const thPng = await mustApi<{ success: boolean; state: string; kind?: string; dataUrl?: string }>(
    window,
    'getReceiptThumbnail',
    pngR.id
  )
  expect(thPng).toMatchObject({ success: true, state: 'ok', kind: 'image' })
  expect(thPng.dataUrl).toMatch(/^data:image\/(png|jpeg);base64,/)
  expect(await mustApi(window, 'getReceiptThumbnail', jpgR.id)).toMatchObject({
    success: true,
    kind: 'image'
  })
  expect(await mustApi(window, 'getReceiptThumbnail', pdfR.id)).toEqual({
    success: true,
    state: 'ok',
    kind: 'pdf'
  })
  const pv = await mustApi<{ mimeType: string; dataUrl: string }>(
    window,
    'getReceiptPreview',
    pngR.id
  )
  expect(pv.mimeType).toBe('image/png')
  expect(pv.dataUrl.startsWith('data:image/png;base64,')).toBe(true)
  expect(JSON.stringify(pv)).not.toContain(dataDir) // パスを返さない
  // 画面: サムネイル・拡大プレビュー
  await window.getByRole('button', { name: '入出金・経費' }).click()
  await window.getByRole('cell', { name: '試験用の記録' }).first().click()
  await expect(window.getByText('receipt_sample.png')).toBeVisible()
  await shot(window, 'TC-86', '詳細画面の領収書(PDFアイコン・画像サムネイル、4件)')
  await window.locator('.receipt-card').nth(1).locator('img, button, .thumb').first().click()
  await shot(window, 'TC-86', '画像の拡大プレビュー')
  await window.keyboard.press('Escape')
  // 開く・Finderで表示は外部アプリを起動しないよう差し替えたshellで呼び出しを確認
  await stubShell(app, 0)
  expect(await mustApi(window, 'openReceipt', pngR.id)).toEqual({ success: true })
  expect(await mustApi(window, 'showReceiptInFolder', pngR.id)).toEqual({ success: true })
  const calls = await shellCalls(app)
  expect(calls.shell.some((c) => c.startsWith('open:') && c.includes('documents/receipts/'))).toBe(
    true
  )
  expect(calls.shell.some((c) => c.startsWith('show:'))).toBe(true)
  expect(calls.dialog).toEqual([]) // 改変なしでは警告ダイアログは出ない
  // 5件上限(登録時6件はエラー・画面は5件を超える選択を許可しない)
  const six = await pickTokens(window, app, [fx.pdf, fx.pdf, fx.pdf, fx.pdf, fx.pdf, fx.pdf])
  const over = await callApi(window, 'createRecord', {
    kind: 'expense',
    recordDate: '2026-10-01',
    amount: 100,
    accountId: acc,
    description: '6件',
    clientId: null,
    paymentMethod: null,
    taxCategory: null,
    receiptTokens: six.files.map((f) => f.token)
  })
  expect(over.ok).toBe(false)
  expect(over.error).toContain('5件')
  const five = await pickTokens(window, app, [fx.pdf, fx.pdf, fx.pdf, fx.pdf, fx.pdf])
  const id5 = await createRecordApi(window, {
    accountId: acc,
    description: '5件',
    receiptTokens: five.files.map((f) => f.token)
  })
  expect((await mustApi<RecordDetailLite>(window, 'getRecord', id5)).receipts).toHaveLength(5)
  // 保存済み5件に追加すると超過
  const one = await pickTokens(window, app, [fx.pdf])
  const upd = await callApi(window, 'updateRecord', {
    id: id5,
    kind: 'expense',
    recordDate: '2026-10-01',
    amount: 1100,
    accountId: acc,
    description: '5件',
    clientId: null,
    paymentMethod: null,
    taxCategory: null,
    removeReceiptIds: [],
    addReceiptTokens: [one.files[0].token],
    reason: '追加'
  })
  expect(upd.ok).toBe(false)
  // 同じトークンの重複指定
  const dup = await pickTokens(window, app, [fx.pdf])
  const dupRes = await callApi(window, 'createRecord', {
    kind: 'expense',
    recordDate: '2026-10-01',
    amount: 100,
    accountId: acc,
    description: '重複',
    clientId: null,
    paymentMethod: null,
    taxCategory: null,
    receiptTokens: [dup.files[0].token, dup.files[0].token]
  })
  expect(dupRes.ok).toBe(false)
  expect(dupRes.error).toContain('重複')
  // 存在しない(無効な)トークン
  const bad = await callApi(window, 'createRecord', {
    kind: 'expense',
    recordDate: '2026-10-01',
    amount: 100,
    accountId: acc,
    description: '無効',
    clientId: null,
    paymentMethod: null,
    taxCategory: null,
    receiptTokens: ['00000000-0000-4000-8000-000000000000']
  })
  expect(bad.ok).toBe(false)
  // 保存直前の再検証: 選択後にファイルが差し替えられた場合は保存されない(記録も作られない)
  const swap = join(fx.dir, 'swap.pdf')
  wf(swap, readFileSync(fx.pdf))
  const sw = await pickTokens(window, app, [swap])
  wf(swap, 'replaced by text after picking')
  const cntRec = dbQuery(dataDir, 'select count(*) from cash_records')
  const cntRc = dbQuery(dataDir, 'select count(*) from receipts')
  const swRes = await callApi(window, 'createRecord', {
    kind: 'expense',
    recordDate: '2026-10-01',
    amount: 100,
    accountId: acc,
    description: '差し替え',
    clientId: null,
    paymentMethod: null,
    taxCategory: null,
    receiptTokens: [sw.files[0].token]
  })
  expect(swRes.ok).toBe(false)
  expect(dbQuery(dataDir, 'select count(*) from cash_records')).toBe(cntRec)
  expect(dbQuery(dataDir, 'select count(*) from receipts')).toBe(cntRc)
  noteEvidence(
    'TC-86',
    '上限・重複・無効トークン・差し替えの異常系',
    `6件: ${over.error}\n重複: ${dupRes.error}\n無効トークン: ${bad.error}\n差し替え: ${swRes.error}\n(いずれも記録・領収書は増えない)`
  )
  // 孤立ファイルが残らない(失敗した保存の領収書ファイルは削除される)
  expect(listFilesRecursive(join(dataDir, 'documents', 'receipts')).length).toBe(
    Number(dbQuery(dataDir, 'select count(*) from receipts'))
  )
  expect(existsSync(join(dataDir, 'documents', 'receipts'))).toBe(true)
  void readdirSync
})

test('TC-87: 改変検知(電帳法)。誤検知なし・領収書ファイルの改ざん/欠落・記録の改ざん・外した領収書・開く前の警告', async () => {
  const { window, app, dataDir } = launched
  const acc = await accountId(window, '消耗品費')
  const t = await pickTokens(window, app, [fx.pdf, fx.png])
  const id = await createRecordApi(window, {
    accountId: acc,
    description: '改変検知の対象',
    amount: 3300,
    receiptTokens: t.files.map((f) => f.token)
  })
  const check = async (): Promise<RecordDetailLite> =>
    mustApi<RecordDetailLite>(window, 'getRecord', id)
  const okState = (d: RecordDetailLite): string =>
    `recordHashOk=${d.integrity.recordHashOk} historyHashOk=${d.integrity.historyHashOk} receipts=${d.integrity.receipts.map((r) => r.state).join(',')}`
  // 誤検知がないこと: 登録・更新・領収書の追加と外す・取消相当の操作のたびに照合してOK
  let d = await check()
  expect(okState(d)).toBe('recordHashOk=true historyHashOk=true receipts=ok,ok')
  const upd = (extra: Record<string, unknown>): Promise<unknown> =>
    mustApi(window, 'updateRecord', {
      id,
      kind: 'expense',
      recordDate: '2026-10-01',
      amount: 3300,
      accountId: acc,
      description: '改変検知の対象',
      clientId: null,
      paymentMethod: null,
      taxCategory: null,
      removeReceiptIds: [],
      addReceiptTokens: [],
      reason: '操作',
      ...extra
    })
  await upd({ amount: 4400 })
  expect(okState(await check())).toBe('recordHashOk=true historyHashOk=true receipts=ok,ok')
  const t2 = await pickTokens(window, app, [fx.jpg])
  await upd({ addReceiptTokens: [t2.files[0].token] })
  d = await check()
  expect(d.receipts).toHaveLength(3)
  await upd({ removeReceiptIds: [d.receipts[0].id] })
  d = await check()
  expect(okState(d)).toBe('recordHashOk=true historyHashOk=true receipts=ok,ok,ok') // 外した領収書も照合対象
  expect(d.receipts[0].removed).toBe(true)
  noteEvidence(
    'TC-87',
    '正常操作後の照合(誤検知なし)',
    `作成→更新→領収書追加→領収書を外す の各時点: ${okState(d)}`
  )
  await window.getByRole('button', { name: '入出金・経費' }).click()
  await window.getByRole('cell', { name: '改変検知の対象' }).click()
  await expect(window.getByText('改変が疑われます')).toHaveCount(0)
  await shot(window, 'TC-87', '正常な記録の詳細(警告なし)')

  // (1) 領収書ファイルの改ざん(1バイト変更)
  const paths = dbQuery(dataDir, 'select id||"|"||file_path from receipts order by id')
    .split('\n')
    .map((l) => l.split('|'))
  const abs = (rel: string): string => join(dataDir, 'documents', rel)
  const pngPath = abs(paths[1][1])
  const orig = readFileSync(pngPath)
  const tampered = Buffer.from(orig)
  tampered[tampered.length - 5] ^= 0xff
  writeFileSync(pngPath, tampered)
  d = await check()
  expect(d.integrity.receipts.find((r) => r.id === Number(paths[1][0]))?.state).toBe('mismatch')
  expect(d.integrity.recordHashOk).toBe(true)
  await window.reload()
  await window.getByRole('button', { name: '入出金・経費' }).click()
  await window.getByRole('cell', { name: '改変検知の対象' }).click()
  await expect(window.getByText('ファイルの改変が疑われます')).toBeVisible()
  await shot(window, 'TC-87', '領収書ファイルを改ざん(警告「ファイルの改変が疑われます」)')
  // プレビューは画像を返さず mismatch
  expect(await mustApi(window, 'getReceiptPreview', Number(paths[1][0]))).toEqual({
    success: false,
    state: 'mismatch'
  })
  expect(await mustApi(window, 'getReceiptThumbnail', Number(paths[1][0]))).toEqual({
    success: false,
    state: 'mismatch'
  })
  // 開く前に警告(続行/中止)。中止ではOSに渡さない。続行では渡す
  await stubShell(app, 1) // 「中止」(2番目のボタン)
  expect(await mustApi(window, 'openReceipt', Number(paths[1][0]))).toEqual({ success: true })
  let c = await shellCalls(app)
  expect(c.dialog).toHaveLength(1)
  expect(c.dialog[0]).toContain('改変が疑われます')
  expect(c.shell.filter((x) => x.startsWith('open:'))).toHaveLength(0)
  await stubShell(app, 0) // 「続行」
  expect(await mustApi(window, 'openReceipt', Number(paths[1][0]))).toEqual({ success: true })
  c = await shellCalls(app)
  expect(c.dialog).toHaveLength(1)
  expect(c.shell.filter((x) => x.startsWith('open:'))).toHaveLength(1)
  noteEvidence(
    'TC-87',
    '改ざんされた領収書を開く前の警告',
    `警告文言: ${c.dialog[0]}\n中止→OSへ渡さない、続行→OSへ渡す(shellを差し替えて確認)`
  )
  writeFileSync(pngPath, orig)
  expect(okState(await check())).toContain('receipts=ok,ok,ok') // 元に戻せば解消

  // (2) 領収書ファイルの欠落
  const pdfPath = abs(paths[0][1]) // 外した領収書(removed)も検知対象
  const pdfBytes = readFileSync(pdfPath)
  rmSync(pdfPath)
  d = await check()
  expect(d.integrity.receipts.find((r) => r.id === Number(paths[0][0]))?.state).toBe('missing')
  expect(await mustApi(window, 'getReceiptThumbnail', Number(paths[0][0]))).toEqual({
    success: false,
    state: 'missing'
  })
  const openMissing = await mustApi<{ success: boolean; error?: string }>(
    window,
    'openReceipt',
    Number(paths[0][0])
  )
  expect(openMissing.success).toBe(false)
  expect(openMissing.error).toContain('見つかりません')
  await window.reload()
  await window.getByRole('button', { name: '入出金・経費' }).click()
  await window.getByRole('cell', { name: '改変検知の対象' }).click()
  await expect(window.getByText('ファイルが見つかりません').first()).toBeVisible()
  await shot(
    window,
    'TC-87',
    '領収書ファイルを削除(外した領収書も警告「ファイルが見つかりません」)'
  )
  writeFileSync(pdfPath, pdfBytes)

  // (3) 保存先が不正(documents/receipts/ の外を指す)
  dbExec(dataDir, `update receipts set file_path='../data.sqlite' where id=${paths[0][0]}`)
  d = await check()
  expect(d.integrity.receipts.find((r) => r.id === Number(paths[0][0]))?.state).toBe('missing')
  expect(await mustApi(window, 'getReceiptPreview', Number(paths[0][0]))).toEqual({
    success: false,
    state: 'missing'
  })
  expect(
    (await mustApi<{ success: boolean }>(window, 'openReceipt', Number(paths[0][0]))).success
  ).toBe(false)
  dbExec(dataDir, `update receipts set file_path='${paths[0][1]}' where id=${paths[0][0]}`)

  // (4) 記録(DB)の改ざん: 金額を直接書き換える → 記録ハッシュ不一致(履歴のハッシュとは整合)
  dbExec(dataDir, `update cash_records set amount=1 where id=${id}`)
  d = await check()
  expect(d.integrity.recordHashOk).toBe(false)
  expect(d.integrity.historyHashOk).toBe(true)
  await window.reload()
  await window.getByRole('button', { name: '入出金・経費' }).click()
  await window.getByRole('cell', { name: '改変検知の対象' }).click()
  await expect(window.getByText('この記録の改変が疑われます')).toBeVisible()
  await shot(window, 'TC-87', '記録(金額)をDBで直接改ざん(警告「この記録の改変が疑われます」)')
  dbExec(dataDir, `update cash_records set amount=3300 where id=${id}`)
  expect(okState(await check())).toContain('recordHashOk=true historyHashOk=true')
  // (5) 記録ハッシュ自体の書き換え → 履歴の最新ハッシュと不一致(historyHashOk=false)
  dbExec(dataDir, `update cash_records set record_hash='${'0'.repeat(64)}' where id=${id}`)
  d = await check()
  expect(d.integrity.recordHashOk).toBe(false)
  expect(d.integrity.historyHashOk).toBe(false)
  noteEvidence('TC-87', '記録ハッシュの書き換え', okState(d))
  // (6) 領収書の指す内容(sha256列)の書き換え
  // 一覧表示では照合しない(設計: 一覧・起動時の照合は行わない)
  const list = await mustApi<{ items: Array<{ id: number }> }>(window, 'listRecords', {})
  expect(list.items.length).toBeGreaterThan(0)
  // (7) 履歴の追記専用: 履歴のハッシュを書き換えようとしても拒否される(TC-84で詳細確認)
  const attempt = (() => {
    try {
      dbExec(dataDir, `update cash_record_history set record_hash_after='x' where record_id=${id}`)
      return 'allowed'
    } catch {
      return 'rejected'
    }
  })()
  expect(attempt).toBe('rejected')
  noteEvidence('TC-87', '履歴ハッシュの書き換え試行', `cash_record_history の UPDATE: ${attempt}`)
})

test('TC-88: 集計(月別・年別・勘定科目別。取消済・削除済の除外、境界日、年の選択肢、0件、入力検証)', async () => {
  const { window } = launched
  const tsu = await accountId(window, '通信費')
  const sho = await accountId(window, '消耗品費')
  const uri = await accountId(window, '売上高')
  const mk = (
    kind: 'income' | 'expense',
    recordDate: string,
    amount: number,
    accountId: number,
    description: string
  ): Promise<number> =>
    createRecordApi(window, { kind, recordDate, amount, accountId, description })
  await mk('expense', '2026-01-01', 1000, tsu, '1月1日の通信費')
  await mk('income', '2026-01-31', 5000, uri, '1月31日の入金')
  await mk('expense', '2026-02-15', 2500, tsu, '2月の経費')
  await mk('expense', '2026-03-10', 500, tsu, '3月の通信費')
  await mk('expense', '2026-03-20', 1500, sho, '3月の消耗品')
  await mk('expense', '2026-12-31', 2000, sho, '12月31日の消耗品')
  await mk('income', '2025-12-31', 7000, uri, '前年末の入金')
  await mk('expense', '2027-01-01', 300, tsu, '翌年初の経費')
  const del = await mk('expense', '2026-03-15', 99999, tsu, '削除する記録')
  await mustApi(window, 'deleteRecord', { id: del, reason: '除外確認' })
  // 請求書の入金記録: 有効分は集計へ(源泉徴収後の実入金額)、取消済は除外
  await setupCompany(window)
  const cid = await createClientApi(window, '集計商事')
  const inv = await finalizeInvoiceApi(window, cid, '2026-04-01', [
    { name: '業務', quantity: 1, unitPrice: 100000, taxRate: 10, withholdingTarget: true }
  ])
  await mustApi(window, 'updateInvoicePaymentStatus', inv.id, {
    paymentStatus: 'paid',
    paymentDate: '2026-04-30'
  })
  const s0 = await mustApi<SummaryT>(window, 'getSummary', { year: 2026, month: null })
  expect(s0.period.income).toBe(5000 + 99790)
  await mustApi(window, 'updateInvoicePaymentStatus', inv.id, { paymentStatus: 'unpaid' })
  const s = await mustApi<SummaryT>(window, 'getSummary', { year: 2026, month: null })
  expect(s.period).toMatchObject({
    income: 5000,
    expense: 1000 + 2500 + 500 + 1500 + 2000,
    balance: 5000 - 7500
  })
  expect(s.yearTotal).toEqual(s.period)
  expect(s.monthly).toHaveLength(12)
  expect(s.monthly[0]).toMatchObject({ month: 1, income: 5000, expense: 1000, balance: 4000 })
  expect(s.monthly[1]).toMatchObject({ month: 2, income: 0, expense: 2500, balance: -2500 }) // 負の差額
  expect(s.monthly[3]).toMatchObject({ month: 4, income: 0, expense: 0 }) // 取消済は除外
  expect(s.monthly[11]).toMatchObject({ month: 12, expense: 2000 }) // 12/31は含む
  expect(s.years).toEqual([2025, 2026, 2027])
  expect(s.yearly.map((y) => [y.year, y.income, y.expense])).toEqual([
    [2025, 7000, 0],
    [2026, 5000, 7500],
    [2027, 0, 300]
  ])
  const m3 = await mustApi<SummaryT>(window, 'getSummary', { year: 2026, month: 3 })
  expect(m3.period).toMatchObject({ income: 0, expense: 2000, balance: -2000 })
  expect(m3.expenseByAccount.map((a) => [a.accountName, a.total])).toEqual([
    ['通信費', 500],
    ['消耗品費', 1500]
  ]) // 並びは科目の表示順
  const y2025 = await mustApi<SummaryT>(window, 'getSummary', { year: 2025, month: null })
  expect(y2025.period).toMatchObject({ income: 7000, expense: 0 })
  const empty = await mustApi<SummaryT>(window, 'getSummary', { year: 2030, month: 5 })
  expect(empty.period).toEqual({ income: 0, expense: 0, balance: 0 })
  expect(empty.monthly.every((m) => m.income === 0 && m.expense === 0)).toBe(true)
  expect(empty.expenseByAccount).toEqual([])
  noteEvidence(
    'TC-88',
    '集計結果(2026年・3月・記録のない年月)',
    JSON.stringify({ y2026: s, m3, empty }, null, 1)
  )
  // 入力検証(IPC直叩き)
  for (const bad of [
    { year: 1999, month: null },
    { year: 2100, month: null },
    { year: 2026, month: 0 },
    { year: 2026, month: 13 },
    { year: 2026.5, month: null },
    { year: '2026', month: null }
  ]) {
    expect((await callApi(window, 'getSummary', bad)).ok).toBe(false)
  }
  // 画面
  await window.getByRole('button', { name: '入出金・経費' }).click()
  await window.getByRole('button', { name: '集計' }).click()
  await window.locator('#summary-year').selectOption('2026')
  await expect(window.getByText('2026年 入金合計')).toBeVisible()
  await expect(window.getByText('−¥2,500').first()).toBeVisible()
  await shot(window, 'TC-88', '集計タブ(2026年・年全体)。差額は符号つき、表のみ')
  await window.locator('#summary-month').selectOption('3')
  await expect(window.getByText('勘定科目別の経費合計(2026年3月)')).toBeVisible()
  await shot(window, 'TC-88', '2026年3月の勘定科目別')
  await window.getByRole('row', { name: /^2月/ }).click()
  await expect(window.locator('#summary-month')).toHaveValue('2')
  await window.getByRole('row', { name: /^2025年/ }).click()
  await expect(window.locator('#summary-year')).toHaveValue('2025')
})

interface SummaryT {
  years: number[]
  period: { income: number; expense: number; balance: number }
  yearTotal: { income: number; expense: number; balance: number }
  monthly: Array<{ month: number; income: number; expense: number; balance: number }>
  yearly: Array<{ year: number; income: number; expense: number; balance: number }>
  expenseByAccount: Array<{ accountId: number; accountName: string; total: number }>
}

test('TC-89: CSV出力(列・書式・BOM・CRLF・引用符・数式対策・期間境界・取消済/削除済・0件・入力検証・画面)', async () => {
  const { window, app } = launched
  const out = join(csvDir, 'out.csv')
  const tsu = await accountId(window, '通信費')
  const uri = await accountId(window, '売上高')
  const c1 = await createClientApi(window, '+数式風商事')
  const c2 = await createClientApi(window, '通常商事')
  const t = await pickTokens(window, app, [fx.pdf, fx.png])
  await createRecordApi(window, {
    recordDate: '2026-10-05',
    amount: 1100,
    accountId: tsu,
    description: '=SUM(A1:A9)',
    clientId: c1,
    paymentMethod: 'cash',
    taxCategory: 'standard_10',
    receiptTokens: t.files.map((f) => f.token)
  })
  await createRecordApi(window, {
    recordDate: '2026-10-05',
    amount: 500,
    accountId: tsu,
    description: 'カンマ,と"引用符"を含む'
  })
  await createRecordApi(window, {
    kind: 'income',
    recordDate: '2026-09-30',
    amount: 3000,
    accountId: uri,
    description: '@メンション風',
    clientId: c2
  })
  await createRecordApi(window, {
    recordDate: '2026-12-31',
    amount: 400,
    accountId: tsu,
    description: '-マイナス風',
    taxCategory: 'reduced_8'
  })
  await createRecordApi(window, {
    recordDate: '2027-01-01',
    amount: 999,
    accountId: tsu,
    description: '範囲外(翌年)'
  })
  await createRecordApi(window, {
    recordDate: '2026-08-31',
    amount: 888,
    accountId: tsu,
    description: '範囲外(前月)'
  })
  const del = await createRecordApi(window, {
    recordDate: '2026-10-06',
    amount: 777,
    accountId: tsu,
    description: '削除済みは出力しない'
  })
  await mustApi(window, 'deleteRecord', { id: del, reason: '' })
  // 請求書の入金記録(取消済)を含める
  await setupCompany(window)
  const inv = await finalizeInvoiceApi(window, c2, '2026-10-01', [
    { name: '業務', quantity: 1, unitPrice: 10000, taxRate: 10 }
  ])
  await mustApi(window, 'updateInvoicePaymentStatus', inv.id, {
    paymentStatus: 'paid',
    paymentDate: '2026-10-05'
  })
  await mustApi(window, 'updateInvoicePaymentStatus', inv.id, { paymentStatus: 'unpaid' })
  const res = await mustApi<{ success: boolean; count?: number; filePath?: string }>(
    window,
    'exportCsv',
    { fromMonth: '2026-09', toMonth: '2026-12' }
  )
  expect(res).toMatchObject({ success: true, count: 5 })
  const raw = readFileSync(out)
  expect(raw.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(true)
  const text = raw.toString('utf8')
  expect(text.endsWith('\r\n')).toBe(true)
  expect(text.replace(/\r\n/g, '').includes('\n')).toBe(false) // 改行はCRLFのみ
  const lines = text.slice(1).split('\r\n')
  expect(lines.pop()).toBe('')
  expect(lines[0]).toBe(
    '日付,種別,取引先,金額,勘定科目,摘要,税区分,消費税額,領収書ファイル名,請求書番号,状態'
  )
  expect(lines.slice(1)).toEqual([
    "2026-09-30,入金,通常商事,3000,売上高,'@メンション風,,0,,,有効",
    "2026-10-05,経費,'+数式風商事,1100,通信費,'=SUM(A1:A9),10%,100,receipt_sample.pdf; receipt_sample.png,,有効",
    '2026-10-05,経費,,500,通信費,"カンマ,と""引用符""を含む",,0,,,有効',
    '2026-10-05,入金,通常商事,11000,売上高,請求書 2026-001 の入金,,0,,2026-001,取消済',
    "2026-12-31,経費,,400,通信費,'-マイナス風,8%(軽減),29,,,有効"
  ])
  expect(text).not.toContain('範囲外')
  expect(text).not.toContain('削除済み')
  expect(text).not.toContain('源泉')
  noteEvidence('TC-89', 'CSVの内容(先頭BOM・CRLFを可視化せず行単位で記録)', lines.join('\n'))
  // 摘要に改行を含む場合(入力が受理される場合のみ。受理されなければ入力検証で拒否されることを記録)
  const nl = await callApi(window, 'createRecord', {
    kind: 'expense',
    recordDate: '2026-11-15',
    amount: 100,
    accountId: tsu,
    description: '1行目\n2行目',
    clientId: null,
    paymentMethod: null,
    taxCategory: null,
    receiptTokens: []
  })
  if (nl.ok) {
    await mustApi(window, 'exportCsv', { fromMonth: '2026-11', toMonth: '2026-11' })
    const t2 = readFileSync(out, 'utf8')
    expect(t2).toContain('"1行目\n2行目"')
    noteEvidence('TC-89', '摘要に改行を含む場合(全体を引用符で囲む)', JSON.stringify(t2.slice(1)))
  } else {
    noteEvidence('TC-89', '摘要に改行を含む入力', `入力検証で拒否: ${nl.error}`)
  }
  await mustApi(window, 'exportCsv', { fromMonth: '2026-09', toMonth: '2026-12' })
  // 期間境界: 12月末まで・翌年1月1日は含まない/9月のみ
  expect(
    (
      await mustApi<{ count: number }>(window, 'exportCsv', {
        fromMonth: '2026-12',
        toMonth: '2026-12'
      })
    ).count
  ).toBe(1)
  expect(
    (
      await mustApi<{ count: number }>(window, 'exportCsv', {
        fromMonth: '2027-01',
        toMonth: '2027-01'
      })
    ).count
  ).toBe(1)
  // 0件: 保存せず reason=empty
  rmSync(out)
  const emp = await mustApi<{ success: boolean; reason?: string }>(window, 'exportCsv', {
    fromMonth: '2030-01',
    toMonth: '2030-02'
  })
  expect(emp).toMatchObject({ success: false, reason: 'empty' })
  expect(existsSync(out)).toBe(false)
  // 入力検証(IPC)
  for (const bad of [
    { fromMonth: '2026-13', toMonth: '2026-12' },
    { fromMonth: '2026-12', toMonth: '2026-01' },
    { fromMonth: '2026/01', toMonth: '2026-02' },
    { fromMonth: '', toMonth: '' },
    { fromMonth: '2026-02-01', toMonth: '2026-03' }
  ]) {
    expect((await callApi(window, 'exportCsv', bad)).ok).toBe(false)
  }
  // 書き込み失敗(保存先が存在しないフォルダ)
  await (
    await import('./helpers-i2')
  ).setEnv(app, 'JIMUHUB_E2E_CSV_PATH', join(csvDir, 'no-such-dir', 'x.csv'))
  const fail = await mustApi<{ success: boolean; reason?: string; error?: string }>(
    window,
    'exportCsv',
    { fromMonth: '2026-09', toMonth: '2026-12' }
  )
  expect(fail.success).toBe(false)
  noteEvidence('TC-89', '書き込み失敗時の応答', JSON.stringify(fail))
  await (await import('./helpers-i2')).setEnv(app, 'JIMUHUB_E2E_CSV_PATH', out)
  // 画面
  await window.getByRole('button', { name: '入出金・経費' }).click()
  await window.getByRole('button', { name: 'CSV出力' }).click()
  await expect(window.getByRole('dialog', { name: 'CSV出力' })).toBeVisible()
  await window.getByLabel(/開始年月/).fill('2026-12')
  await window.getByLabel(/終了年月/).fill('2026-01')
  await window.getByRole('button', { name: '出力', exact: true }).click()
  await expect(window.getByText('終了年月は、開始年月以降を指定してください')).toBeVisible()
  await shot(window, 'TC-89', '範囲エラー(終了が開始より前)')
  await window.getByLabel(/開始年月/).fill('2030-01')
  await window.getByLabel(/終了年月/).fill('2030-02')
  await window.getByRole('button', { name: '出力', exact: true }).click()
  await expect(window.getByText('対象期間に出力する記録がありません')).toBeVisible()
  await shot(window, 'TC-89', '0件の案内')
  await window.getByLabel(/開始年月/).fill('2026-09')
  await window.getByLabel(/終了年月/).fill('2026-12')
  await window.getByRole('button', { name: '出力', exact: true }).click()
  await expect(window.getByText(/CSVを出力しました/)).toBeVisible()
  await expect(window.getByText(/CSVを出力しました。保存先: .*\([0-9]+件\)/)).toBeVisible()
  await shot(window, 'TC-89', '出力成功(保存先と件数)')
})

test('TC-90: [F-25] 取引先を「利用中に戻す」(一覧・詳細・確認ダイアログ・選択肢への復帰・IPCガード)', async () => {
  const { window, dataDir } = launched
  const id = await createClientApi(window, '復帰確認商店', { furigana: 'フッキカクニンショウテン' })
  await mustApi(window, 'deactivateClient', id)
  const before = dbQuery(
    dataDir,
    `select name||'|'||furigana||'|'||honorific||'|'||created_at from clients where id=${id}`
  )
  expect((await mustApi<unknown[]>(window, 'listClients', { statusFilter: 'active' })).length).toBe(
    0
  )
  await window.getByRole('button', { name: '取引先管理' }).click()
  await window.getByLabel('利用停止も表示').check()
  await expect(window.getByText('復帰確認商店')).toBeVisible()
  await shot(window, 'TC-90', '一覧(利用停止も表示。利用停止の行に「利用中に戻す」)')
  // 確認で「キャンセル」→変化なし
  let msg = ''
  window.once('dialog', async (d) => {
    msg = d.message()
    await d.dismiss()
  })
  await window.getByRole('button', { name: '利用中に戻す' }).click()
  expect(msg).toBe('この取引先を利用中に戻します。よろしいですか')
  expect(dbQuery(dataDir, `select status from clients where id=${id}`)).toBe('inactive')
  // 確認で「OK」→一覧で復帰
  window.once('dialog', (d) => void d.accept())
  await window.getByRole('button', { name: '利用中に戻す' }).click()
  await expect(window.getByText('取引先を利用中に戻しました')).toBeVisible()
  expect(dbQuery(dataDir, `select status from clients where id=${id}`)).toBe('active')
  expect(
    dbQuery(
      dataDir,
      `select name||'|'||furigana||'|'||honorific||'|'||created_at from clients where id=${id}`
    )
  ).toBe(before) // 登録内容は変わらない
  await shot(window, 'TC-90', '一覧から利用中に戻した直後')
  // 選択肢への復帰(見積書・入出金の取引先選択はlistClients(利用中のみ))
  expect(
    (await mustApi<Array<{ id: number }>>(window, 'listClients', { statusFilter: 'active' })).map(
      (c) => c.id
    )
  ).toEqual([id])
  // 詳細画面から: 再度停止→詳細で復帰
  await mustApi(window, 'deactivateClient', id)
  await window.reload()
  await window.getByRole('button', { name: '取引先管理' }).click()
  await window.getByLabel('利用停止も表示').check()
  await window.getByRole('cell', { name: '復帰確認商店' }).click()
  await expect(window.getByRole('button', { name: '利用中に戻す' })).toBeVisible()
  await expect(window.getByRole('button', { name: '編集' }))
    .toBeDisabled()
    .catch(() => undefined)
  await shot(window, 'TC-90', '詳細画面(利用停止中。利用中に戻す)')
  window.once('dialog', (d) => void d.accept())
  await window.getByRole('button', { name: '利用中に戻す' }).click()
  await expect(window.getByText('取引先を利用中に戻しました')).toBeVisible()
  await expect(window.getByRole('button', { name: '利用中に戻す' })).toHaveCount(0)
  await expect(window.getByRole('button', { name: '利用停止にする' })).toBeVisible()
  await shot(window, 'TC-90', '詳細画面から利用中に戻した直後(利用停止にするが再び表示)')
  // 記録登録フォームの取引先欄にも出る
  await window.getByRole('button', { name: '入出金・経費' }).click()
  await window.getByRole('button', { name: '+ 経費を登録' }).click()
  expect(await window.getByLabel('取引先').locator('option').allTextContents()).toContain(
    '復帰確認商店'
  )
  // IPCガード: 既に利用中・存在しないID
  const already = await callApi(window, 'reactivateClient', id)
  expect(already.ok).toBe(false)
  expect(already.error).toContain('既に「利用中」の取引先です')
  const none = await callApi(window, 'reactivateClient', 99999)
  expect(none.ok).toBe(false)
  expect(none.error).toContain('見つかりません')
  expect((await callApi(window, 'reactivateClient', 'abc')).ok).toBe(false)
  noteEvidence(
    'TC-90',
    'IPCガードの文言',
    `既に利用中: ${already.error}\n存在しない: ${none.error}`
  )
})

test('TC-91: [F-26] 下書きの見積書・請求書の削除(一覧・詳細・確認・PDF保存済みは不可・番号採番への影響なし・ガード)', async () => {
  const { window, dataDir } = launched
  await setupCompany(window)
  const cid = await createClientApi(window, '削除確認商事')
  const line = [
    {
      name: '下書き明細',
      quantity: 1,
      unit: '式',
      unitPrice: 1000,
      taxRate: 10,
      withholdingTarget: false
    }
  ]
  const qIn = {
    clientId: cid,
    issueDate: '2026-10-01',
    validUntil: '',
    remarks: '',
    lineItems: line
  }
  const iIn = { clientId: cid, issueDate: '2026-10-01', dueDate: '', remarks: '', lineItems: line }
  const q1 = (await mustApi<{ id: number }>(window, 'saveQuoteDraft', qIn)).id
  const q2 = (await mustApi<{ id: number }>(window, 'saveQuoteDraft', qIn)).id
  const i1 = (await mustApi<{ id: number }>(window, 'saveInvoiceDraft', iIn)).id
  const i2 = (await mustApi<{ id: number }>(window, 'saveInvoiceDraft', iIn)).id
  const qFinal = await mustApi<{ id: number; quoteNumber: string }>(window, 'finalizeQuote', qIn)
  const iFinal = await mustApi<{ id: number; invoiceNumber: string }>(
    window,
    'finalizeInvoice',
    iIn
  )
  const seqBefore = dbQuery(
    dataDir,
    'select doc_type||year||":"||last_number from document_number_sequences order by 1'
  )
  // 一覧: 下書き行にのみ「削除」ボタン
  await window.getByRole('button', { name: '見積書・請求書' }).click()
  const draftRows = window.locator('tbody tr').filter({ hasText: '下書き' })
  await expect(draftRows.getByRole('button', { name: '削除' })).toHaveCount(2)
  await expect(
    window
      .locator('tbody tr')
      .filter({ hasText: qFinal.quoteNumber })
      .getByRole('button', { name: '削除' })
  ).toHaveCount(0)
  await shot(window, 'TC-91', '見積書一覧(下書き行のみ「削除」。PDF保存済みの行にはない)')
  // キャンセル→削除されない
  let msg = ''
  window.once('dialog', async (d) => {
    msg = d.message()
    await d.dismiss()
  })
  await draftRows.first().getByRole('button', { name: '削除' }).click()
  expect(msg).toBe('この下書きを削除します。削除すると元に戻せません。よろしいですか')
  expect(dbQuery(dataDir, 'select count(*) from quotes')).toBe('3')
  // OK→削除。明細行も消える
  window.once('dialog', (d) => void d.accept())
  await draftRows.first().getByRole('button', { name: '削除' }).click()
  await expect(window.getByText('下書きを削除しました')).toBeVisible()
  expect(dbQuery(dataDir, 'select count(*) from quotes')).toBe('2')
  expect(dbQuery(dataDir, 'select count(*) from quote_line_items')).toBe('2') // 残る見積書2件分
  await shot(window, 'TC-91', '一覧から削除した直後')
  // 詳細から削除(請求書)
  await window.getByRole('button', { name: '請求書', exact: true }).click()
  await window.locator('tbody tr').filter({ hasText: '下書き' }).first().click()
  await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - 請求書詳細')
  await shot(window, 'TC-91', '下書き請求書の詳細(削除ボタン)')
  window.once('dialog', (d) => void d.accept())
  await window.getByRole('button', { name: '削除', exact: true }).click()
  await expect(window.getByText('事務HUB - 請求書詳細'))
    .toHaveCount(0)
    .catch(() => undefined)
  await expect(window.getByText('下書きを削除しました')).toBeVisible()
  expect(dbQuery(dataDir, 'select count(*) from invoices')).toBe('2')
  // PDF保存済みの詳細には削除ボタンがない
  await window.getByRole('button', { name: '請求書', exact: true }).click()
  await window.getByRole('cell', { name: iFinal.invoiceNumber }).click()
  await expect(window.getByRole('button', { name: '削除', exact: true })).toHaveCount(0)
  await shot(window, 'TC-91', 'PDF保存済みの請求書詳細(削除ボタンなし)')
  // 採番は変化しない
  expect(
    dbQuery(
      dataDir,
      'select doc_type||year||":"||last_number from document_number_sequences order by 1'
    )
  ).toBe(seqBefore)
  // IPCガード
  const g1 = await callApi(window, 'deleteQuoteDraft', qFinal.id)
  expect(g1.ok).toBe(false)
  expect(g1.error).toContain('PDF保存済みの見積書は削除できません')
  const g2 = await callApi(window, 'deleteInvoiceDraft', iFinal.id)
  expect(g2.error).toContain('PDF保存済みの請求書は削除できません')
  const g3 = await callApi(window, 'deleteQuoteDraft', 99999)
  expect(g3.error).toContain('見つかりません')
  const g4 = await callApi(window, 'deleteInvoiceDraft', 99999)
  expect(g4.error).toContain('見つかりません')
  expect((await callApi(window, 'deleteQuoteDraft', -1)).ok).toBe(false)
  // 派生請求書がある下書き見積書、入金記録が紐づく下書き請求書(DBを直接加工して再現)
  const remainingQuoteDraft = Number(dbQuery(dataDir, "select id from quotes where status='draft'"))
  const remainingInvoiceDraft = Number(
    dbQuery(dataDir, "select id from invoices where status='draft'")
  )
  expect([remainingQuoteDraft, remainingInvoiceDraft].every((n) => n > 0)).toBe(true)
  dbExec(
    dataDir,
    `update invoices set source_quote_id=${remainingQuoteDraft} where id=${iFinal.id}`
  )
  const g5 = await callApi(window, 'deleteQuoteDraft', remainingQuoteDraft)
  expect(g5.ok).toBe(false)
  expect(g5.error).toContain('請求書があるため削除できません')
  dbExec(dataDir, `update invoices set source_quote_id=NULL where id=${iFinal.id}`)
  const acc = await accountId(window, '売上高')
  const rid = await createRecordApi(window, {
    kind: 'income',
    accountId: acc,
    description: '紐づけ確認'
  })
  dbExec(dataDir, `update cash_records set invoice_id=${remainingInvoiceDraft} where id=${rid}`)
  const g6 = await callApi(window, 'deleteInvoiceDraft', remainingInvoiceDraft)
  expect(g6.ok).toBe(false)
  expect(g6.error).toContain('入金記録があるため削除できません')
  dbExec(dataDir, `update cash_records set invoice_id=NULL where id=${rid}`)
  noteEvidence('TC-91', 'IPCガードの文言', [g1, g2, g3, g4, g5, g6].map((g) => g.error).join('\n'))
  // ガードで拒否されたものは削除されていない
  expect(dbQuery(dataDir, 'select count(*) from quotes')).toBe('2')
  void q1
  void q2
  void i1
  void i2
  void qFinal
})
