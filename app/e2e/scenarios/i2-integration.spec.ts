import { test, expect } from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/electron-app'
import { noteEvidence, shot } from './evidence-dir'
import { createClientApi, dbQuery, finalizeQuoteApi, setupCompany } from './helpers'
import {
  accountId,
  createRecordApi,
  makeReceiptFixtures,
  mustApi,
  setEnv,
  type Fixtures
} from './helpers-i2'

/**
 * 【tester作成】イテレーション2の機能横断・結合(TC-96: 受入条件単位の通しシナリオ、TC-97: 画面遷移・離脱確認・サイドバー)。
 * 参照元: 詳細設計書 3.0章・3.14〜3.21章・4.2〜4.3章・4.15章・4.21〜4.26章
 */
let launched: LaunchedApp
let fx: Fixtures
let outDir: string

test.beforeEach(async () => {
  fx = makeReceiptFixtures()
  outDir = mkdtempSync(join(tmpdir(), 'jimuhub-i2-int-'))
  launched = await launchApp({
    JIMUHUB_E2E_RECEIPT_PATHS: fx.pdf,
    JIMUHUB_E2E_CSV_PATH: join(outDir, 'out.csv'),
    JIMUHUB_E2E_EXPORT_PATH: join(outDir, 'backup.zip'),
    JIMUHUB_E2E_IMPORT_PATH: join(outDir, 'backup.zip')
  })
})
test.afterEach(async () => {
  try {
    await closeApp(launched)
  } catch {
    rmSync(launched.dataDir, { recursive: true, force: true })
  }
  rmSync(fx.dir, { recursive: true, force: true })
  rmSync(outDir, { recursive: true, force: true })
})

test('TC-96: [通しシナリオ] 見積書→請求書→入金済み→入金記録→経費(領収書)→集計→CSV→エクスポート→削除→復元→取消・再入金', async () => {
  const { window, dataDir } = launched
  await setupCompany(window)
  const cid = await createClientApi(window, '通し確認商事', { furigana: 'トオシカクニンショウジ' })
  // 見積書(PDF保存済み)→請求書へ変換→確定→入金済み(UI)
  const q = await finalizeQuoteApi(window, cid, '2026-10-01', [
    { name: '制作', quantity: 1, unit: '式', unitPrice: 300000, taxRate: 10 }
  ])
  const conv = await window.evaluate((id) => window.jimuhubApi.convertQuoteToInvoice(id), q.id)
  await window.evaluate(async (id) => {
    const inv = await window.jimuhubApi.getInvoice(id)
    await window.jimuhubApi.finalizeInvoice({
      id,
      clientId: inv.clientId,
      issueDate: '2026-10-02',
      dueDate: '2026-11-30',
      remarks: '',
      lineItems: inv.lineItems.map((l) => ({
        name: l.name,
        quantity: l.quantity,
        unit: l.unit ?? '',
        unitPrice: l.unitPrice,
        taxRate: l.taxRate,
        withholdingTarget: true
      }))
    })
  }, conv.invoiceId)
  const inv = await mustApi<{ invoiceNumber: string; billingAmount: number }>(
    window,
    'getInvoice',
    conv.invoiceId
  )
  expect(inv.billingAmount).toBe(330000 - 30630) // 源泉徴収後(300,000×10.21%=30,630)
  await window.reload()
  await window.getByRole('button', { name: '見積書・請求書' }).click()
  await window.getByRole('button', { name: '請求書', exact: true }).click()
  await window.getByRole('cell', { name: inv.invoiceNumber }).click()
  await window.getByRole('button', { name: '入金済みにする' }).click()
  await window.getByLabel('入金日').fill('2026-10-15')
  await window.getByRole('button', { name: '確定' }).click()
  await expect(window.getByText('入金済みにしました')).toBeVisible()
  // トップの未収件数が減る
  await window.getByRole('button', { name: 'ホーム' }).click()
  await expect(
    window
      .locator('.summary-card')
      .filter({ has: window.getByText('未収の請求書件数', { exact: true }) })
      .locator('.summary-value')
  ).toHaveText('0件')
  // 入出金・経費一覧に入金記録(請求書から作成)
  await window.getByRole('button', { name: '入出金・経費' }).click()
  await expect(window.getByText('+¥299,370')).toBeVisible()
  await expect(window.getByText(`請求書 ${inv.invoiceNumber} の入金`)).toBeVisible()
  await shot(window, 'TC-96', '一覧に請求書から自動作成された入金記録')
  // 経費の登録(領収書つき)→一覧の検索(取引先)
  await window.getByRole('button', { name: '+ 経費を登録' }).click()
  await window.getByLabel(/金額/).fill('11000')
  await window.getByLabel(/勘定科目/).selectOption({ label: '外注費' })
  await window.getByLabel(/摘要・メモ/).fill('外注デザイン費')
  await window.getByLabel('取引先').selectOption({ label: '通し確認商事' })
  await window.getByLabel('税区分').selectOption('standard_10')
  await window.getByRole('button', { name: 'ファイルを追加' }).click()
  await window.getByRole('button', { name: '登録', exact: true }).click()
  await expect(window.getByText('記録を登録しました')).toBeVisible()
  await window.getByRole('button', { name: '入出金・経費' }).click()
  await window.getByLabel('取引先', { exact: true }).selectOption({ label: '通し確認商事' })
  await expect(window.locator('tbody tr')).toHaveCount(2)
  // 集計(2026年10月)
  await window.getByRole('button', { name: '集計' }).click()
  await window.locator('#summary-year').selectOption('2026')
  await window.locator('#summary-month').selectOption('10')
  await expect(window.getByText('2026年10月 入金合計')).toBeVisible()
  await expect(window.getByText('+¥299,370').first()).toBeVisible()
  await expect(window.getByText('−¥11,000').first()).toBeVisible()
  await expect(window.getByText('+¥288,370').first()).toBeVisible()
  await shot(window, 'TC-96', '集計(2026年10月: 入金299,370・経費11,000・差額+288,370)')
  // CSV
  await window.getByRole('button', { name: 'CSV出力' }).click()
  await window.getByLabel(/開始年月/).fill('2026-10')
  await window.getByLabel(/終了年月/).fill('2026-10')
  await window.getByRole('button', { name: '出力', exact: true }).click()
  await expect(window.getByText(/\(2件\)/)).toBeVisible()
  const csv = readFileSync(join(outDir, 'out.csv'), 'utf8')
  expect(csv).toContain(`請求書 ${inv.invoiceNumber} の入金`)
  expect(csv).toContain('外注デザイン費')
  expect(csv).toContain('receipt_sample.pdf')
  await window.getByRole('button', { name: '閉じる' }).click()
  // エクスポート → 経費を削除 → 復元で元に戻る
  const before = dbQuery(dataDir, 'select count(*) from cash_records where is_deleted=0')
  await window.getByRole('button', { name: 'ホーム' }).click()
  await window.getByRole('button', { name: 'データをエクスポート' }).click()
  await window.getByRole('button', { name: 'エクスポート実行' }).click()
  await expect(window.getByText(/保存しました/)).toBeVisible()
  await window.getByLabel('閉じる').click()
  const expId = Number(
    dbQuery(dataDir, "select id from cash_records where description='外注デザイン費'")
  )
  await window.getByRole('button', { name: '入出金・経費' }).click()
  await window.getByRole('cell', { name: '外注デザイン費' }).click()
  await window.getByRole('button', { name: '削除', exact: true }).click()
  await window.locator('#delete-reason').fill('通し確認のため')
  await window.getByRole('button', { name: 'はい' }).click()
  await expect(window.getByText('外注デザイン費').first()).toBeVisible() // 削除済みの読み取り専用表示
  expect(dbQuery(dataDir, `select is_deleted from cash_records where id=${expId}`)).toBe('1')
  await shot(window, 'TC-96', '記録を削除した直後(削除済みの表示)')
  await window.getByRole('button', { name: 'ホーム' }).click()
  await window.getByRole('button', { name: 'データを復元' }).click()
  await window.getByRole('button', { name: 'ファイルを選択して復元' }).click()
  await window.getByRole('button', { name: '続行' }).click()
  await expect(window.locator('.modal .message-success')).toContainText('復元が完了しました')
  await window.getByLabel('閉じる').click()
  expect(dbQuery(dataDir, `select is_deleted from cash_records where id=${expId}`)).toBe('0')
  expect(dbQuery(dataDir, 'select count(*) from cash_records where is_deleted=0')).toBe(before)
  await window.getByRole('button', { name: '入出金・経費' }).click()
  await expect(window.getByText('外注デザイン費')).toBeVisible()
  await shot(window, 'TC-96', '復元後(削除前の状態に戻り、領収書・履歴も復元)')
  // 復元後: 請求書の未収に戻す→取消済→CSV/集計から除外
  const acc = await accountId(window, '外注費')
  void acc
  await mustApi(window, 'updateInvoicePaymentStatus', conv.invoiceId, { paymentStatus: 'unpaid' })
  const sum = await mustApi<{ period: { income: number; expense: number } }>(window, 'getSummary', {
    year: 2026,
    month: 10
  })
  expect(sum.period).toMatchObject({ income: 0, expense: 11000 })
  await mustApi(window, 'updateInvoicePaymentStatus', conv.invoiceId, {
    paymentStatus: 'paid',
    paymentDate: '2026-10-31'
  })
  expect(
    (await mustApi<{ period: { income: number } }>(window, 'getSummary', { year: 2026, month: 10 }))
      .period.income
  ).toBe(299370)
  noteEvidence(
    'TC-96',
    '通しシナリオの最終状態(DB)',
    dbQuery(
      dataDir,
      "select id||'|'||kind||'|'||amount||'|'||status||'|'||is_deleted||'|'||description from cash_records order by id"
    )
  )
  void createRecordApi
})

test('TC-97: [画面遷移] 新画面でのサイドバー遷移・離脱確認・準備中メニュー・画面タイトル・レイアウトの一貫性', async () => {
  const { window } = launched
  const dialogs: string[] = []
  let accept = false
  window.on('dialog', (d) => {
    dialogs.push(d.message())
    void (accept ? d.accept() : d.dismiss())
  })
  const CONFIRM = '入力中の内容は保存されません。この画面を離れてよろしいですか'
  const title = window.locator('.titlebar-title')
  await window.getByRole('button', { name: '入出金・経費' }).click()
  await expect(title).toContainText('入出金・経費')
  await shot(window, 'TC-97', '入出金・経費一覧(サイドバーの現在位置が強調される)')
  await expect(window.getByRole('button', { name: '入出金・経費' })).toHaveClass(/active/)
  // 一覧(確認なし)
  await window.getByRole('button', { name: '取引先管理' }).click()
  expect(dialogs).toEqual([])
  // 登録画面: 常に確認。キャンセルで留まる
  await window.getByRole('button', { name: '入出金・経費' }).click()
  await window.getByRole('button', { name: '+ 経費を登録' }).click()
  const formTitle = await title.innerText()
  await window.getByLabel(/摘要・メモ/).fill('入力途中のメモ')
  await window.getByRole('button', { name: '見積書・請求書' }).click()
  await expect(title).toHaveText(formTitle)
  await expect(window.getByLabel(/摘要・メモ/)).toHaveValue('入力途中のメモ')
  expect(dialogs).toEqual([CONFIRM])
  // 画面内のキャンセルでは確認が出ない
  await window.getByRole('button', { name: 'キャンセル' }).click()
  expect(dialogs).toEqual([CONFIRM])
  // 勘定科目管理: 追加フォーム入力中の離脱確認
  await window.getByRole('button', { name: '勘定科目の管理' }).click()
  await expect(title).toContainText('勘定科目')
  await shot(window, 'TC-97', '勘定科目管理画面')
  await window
    .getByLabel(/科目の名称|名称/)
    .first()
    .fill('入力途中の科目')
  await window.getByRole('button', { name: '取引先管理' }).click()
  expect(dialogs.length).toBe(2)
  expect(dialogs[1]).toBe(CONFIRM)
  // 準備中メニュー(案件・タスク)は遷移せず案内
  await window.getByRole('button', { name: 'タスク・期限' }).click()
  await expect(
    window.getByText('「タスク・期限」は以降のイテレーションで実装予定です。')
  ).toBeVisible()
  // OKで遷移
  accept = true
  await window.getByRole('button', { name: '取引先管理' }).click()
  await expect(title).toHaveText('事務HUB - 取引先一覧')
  // 詳細画面(記録)からもサイドバーで遷移可能
  accept = false
  const acc = await accountId(window, '通信費')
  await createRecordApi(window, { accountId: acc, description: '遷移確認の記録' })
  await window.getByRole('button', { name: '入出金・経費' }).click()
  await window.getByRole('cell', { name: '遷移確認の記録' }).click()
  await expect(title).toContainText('詳細')
  const n = dialogs.length
  await window.getByRole('button', { name: 'ホーム' }).click()
  await expect(title).toHaveText('事務HUB - ホーム')
  expect(dialogs.length).toBe(n) // 詳細画面では確認なし
  noteEvidence('TC-97', '離脱確認ダイアログの文言と表示回数', dialogs.join('\n'))
  void setEnv
})
