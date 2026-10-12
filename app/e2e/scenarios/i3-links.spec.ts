import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/electron-app'
import { noteEvidence, shot } from './evidence-dir'
import { createClientApi, dbQuery, setupCompany } from './helpers'
import { callApi, createRecordApi, accountId, mustApi } from './helpers-i2'
import {
  changeLinkApi,
  createProjectApi,
  finalizeInvoiceWithProject,
  finalizeQuoteWithProject,
  getProjectApi,
  saveInvoiceDraftApi,
  saveQuoteDraftApi
} from './helpers-i3'

/**
 * 【tester作成】イテレーション3: 紐づけ・付け替えと付け替え履歴(F-30)、案件別収支(F-31)(TC-110〜TC-113)。
 * 参照元: 詳細設計書 3.24〜3.26章・4.30章・4.31章・6.15章・6.16章・8章
 */

let launched: LaunchedApp

test.beforeEach(async () => {
  launched = await launchApp()
})
test.afterEach(async () => {
  await closeApp(launched)
})

function sqlWrite(dataDir: string, sql: string): void {
  execFileSync('sqlite3', [join(dataDir, 'data.sqlite'), sql], { stdio: 'pipe' })
}

interface Hist {
  kind: string
  targetLabel: string
  fromProjectName: string | null
  toProjectName: string | null
}

test('TC-110: [F-30] 見積書・請求書・入出金の紐づけ・付け替え・解除と履歴。PDF保存済・取消済でも変更でき、書類・記録のハッシュ・更新日時・履歴は変わらない', async () => {
  const { window, dataDir } = launched
  await setupCompany(window)
  const client = await createClientApi(window, '紐づけ確認商事')
  const A = await createProjectApi(window, { name: '案件A' })
  const B = await createProjectApi(window, { name: '案件B' })

  const q = await finalizeQuoteWithProject(window, { clientId: client, unitPrice: 10000 })
  const inv = await finalizeInvoiceWithProject(window, { clientId: client, unitPrice: 20000 })
  const expenseAcc = await accountId(window, '通信費')
  const rec = await createRecordApi(window, {
    accountId: expenseAcc,
    description:
      '案件に紐づける通信費(30文字を超える長い摘要の確認用ですのでこの先は切り捨てられます)',
    amount: 5500
  })

  const snapshot = (): string =>
    [
      dbQuery(dataDir, `select updated_at,pdf_hash,pdf_hash_mismatch from quotes where id=${q.id}`),
      dbQuery(
        dataDir,
        `select updated_at,pdf_hash,pdf_hash_mismatch from invoices where id=${inv.id}`
      ),
      dbQuery(dataDir, `select updated_at,record_hash from cash_records where id=${rec}`),
      dbQuery(dataDir, 'select count(*) from cash_record_history')
    ].join('\n')
  const before = snapshot()

  // 紐づけ(assign)→付け替え(change)→解除(unassign)を、3種類の対象で行う
  for (const [type, id] of [
    ['quote', q.id],
    ['invoice', inv.id],
    ['cash_record', rec]
  ] as const) {
    expect((await changeLinkApi(window, type, id, A)).value).toEqual({ changed: true })
    // 同じ案件への変更は何も変えず、履歴も作らない
    expect((await changeLinkApi(window, type, id, A)).value).toEqual({ changed: false })
    expect((await changeLinkApi(window, type, id, B)).value).toEqual({ changed: true })
    expect((await changeLinkApi(window, type, id, null)).value).toEqual({ changed: true })
    expect((await changeLinkApi(window, type, id, null)).value).toEqual({ changed: false })
    const h = await mustApi<Hist[]>(window, 'listProjectLinkHistory', type, id)
    expect(h.map((x) => x.kind).sort()).toEqual(['assign', 'change', 'unassign'])
  }
  // 付け替え履歴の中身(種類・前後の案件名・対象のラベル)
  const rows = dbQuery(
    dataDir,
    "select target_type,kind,ifnull(from_project_name,'-'),ifnull(to_project_name,'-'),target_label from project_link_history order by id"
  ).split('\n')
  expect(rows).toHaveLength(9)
  expect(rows[0]).toBe(`quote|assign|-|案件A|${q.quoteNumber}`)
  expect(rows[1]).toBe(`quote|change|案件A|案件B|${q.quoteNumber}`)
  expect(rows[2]).toBe(`quote|unassign|案件B|-|${q.quoteNumber}`)
  expect(rows[3]).toBe(`invoice|assign|-|案件A|${inv.invoiceNumber}`)
  expect(rows[6].startsWith('cash_record|assign|-|案件A|2026-10-01 案件に紐づける通信費')).toBe(
    true
  )
  // 摘要の先頭30文字(日付と空白を除く)に切り詰められる
  const label = rows[6].split('|')[4]
  expect([...label.slice('2026-10-01 '.length)].length).toBeLessThanOrEqual(30)

  // 書類・記録の本体(ハッシュ・更新日時)と記録の履歴は変わらない(電子帳簿保存法対応への影響なし。4.30章手順2-4)
  expect(snapshot()).toBe(before)

  // 画面: 記録の詳細で「案件を変更」ダイアログから紐づける。候補は「案件なし」と進行中の案件
  await window.getByRole('button', { name: '入出金・経費' }).click()
  await window.getByRole('cell', { name: /案件に紐づける通信費/ }).click()
  await expect(window.getByText('案件なし').first()).toBeVisible()
  await window.getByRole('button', { name: '案件を変更' }).click()
  const dialog = window.getByRole('dialog', { name: '案件を変更' })
  await expect(dialog).toBeVisible()
  const options = await dialog.locator('select option').allTextContents()
  expect(options[0]).toBe('案件なし')
  expect(options.slice(1).sort()).toEqual(['案件A', '案件B'])
  // 現在と同じ案件では「変更する」は活性化しない
  await expect(dialog.getByRole('button', { name: '変更する' })).toBeDisabled()
  await dialog.getByLabel('変更先の案件').selectOption({ label: '案件B' })
  await shot(window, 'TC-110', '記録詳細の「案件を変更」ダイアログ(候補は案件なし・進行中の案件)')
  await dialog.getByRole('button', { name: '変更する' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(window.getByRole('button', { name: '案件B' })).toBeVisible()
  await expect(window.getByText('付け替え前の案件')).toBeVisible()
  await shot(window, 'TC-110', '記録詳細(案件Bへ紐づけ後。この対象の付け替え履歴を表示)')
  expect(dbQuery(dataDir, `select project_id from cash_records where id=${rec}`)).toBe(String(B))

  // PDF保存済の書類・取消済の入金記録でも案件を変更できる
  await window.getByRole('button', { name: '見積書・請求書' }).click()
  await window.getByRole('cell', { name: q.quoteNumber }).click()
  await expect(window.getByRole('button', { name: '案件を変更' })).toBeVisible()
  await shot(window, 'TC-110', 'PDF保存済みの見積書詳細にも「案件を変更」と案件欄がある')
  // 入金済み→入金記録の自動作成→未収に戻して取消済にし、取消済でも付け替えできる
  await mustApi(window, 'updateInvoicePaymentStatus', inv.id, {
    paymentStatus: 'paid',
    paymentDate: '2026-10-20'
  })
  const income = Number(dbQuery(dataDir, `select id from cash_records where invoice_id=${inv.id}`))
  await mustApi(window, 'updateInvoicePaymentStatus', inv.id, {
    paymentStatus: 'unpaid',
    paymentDate: ''
  })
  expect(dbQuery(dataDir, `select status from cash_records where id=${income}`)).toBe('cancelled')
  const incomeRecBefore = dbQuery(
    dataDir,
    `select updated_at,record_hash from cash_records where id=${income}`
  )
  expect((await changeLinkApi(window, 'cash_record', income, A)).value).toEqual({ changed: true })
  expect(dbQuery(dataDir, `select project_id from cash_records where id=${income}`)).toBe(String(A))
  expect(
    dbQuery(dataDir, `select updated_at,record_hash from cash_records where id=${income}`)
  ).toBe(incomeRecBefore)

  // 作成時の紐づけ(IPC): 下書き保存・PDF保存・記録登録で projectId を指定できる。未指定は変更しない
  const d1 = await saveQuoteDraftApi(window, client, A)
  const d2 = await saveInvoiceDraftApi(window, client, B)
  const f1 = await finalizeQuoteWithProject(window, {
    clientId: client,
    unitPrice: 1000,
    projectId: A
  })
  const newRec = await createRecordApi(window, {
    accountId: expenseAcc,
    description: '作成時に紐づけ',
    projectId: A
  } as never)
  expect(dbQuery(dataDir, `select project_id from quotes where id=${d1}`)).toBe(String(A))
  expect(dbQuery(dataDir, `select project_id from invoices where id=${d2}`)).toBe(String(B))
  expect(dbQuery(dataDir, `select project_id from quotes where id=${f1.id}`)).toBe(String(A))
  expect(dbQuery(dataDir, `select project_id from cash_records where id=${newRec}`)).toBe(String(A))
  // 下書きを編集(projectId未指定)しても紐づけは維持され、履歴も増えない
  const histCount = dbQuery(dataDir, 'select count(*) from project_link_history')
  await mustApi(window, 'saveQuoteDraft', {
    id: d1,
    clientId: client,
    issueDate: '2026-10-06',
    validUntil: '',
    remarks: '編集',
    lineItems: [{ name: '編集後', quantity: 1, unit: '', unitPrice: 2000, taxRate: 10 }]
  })
  expect(dbQuery(dataDir, `select project_id from quotes where id=${d1}`)).toBe(String(A))
  expect(dbQuery(dataDir, 'select count(*) from project_link_history')).toBe(histCount)
  // 下書きのラベルは「下書き」
  expect(
    dbQuery(
      dataDir,
      `select target_label from project_link_history where target_type='quote' and target_id=${d1}`
    )
  ).toBe('下書き')
  // 作成画面の「案件」項目(候補は案件なしと進行中の案件)
  await window.getByRole('button', { name: '見積書・請求書' }).click()
  await window.getByRole('button', { name: /見積書を新規作成/ }).click()
  const select = window.getByLabel('案件')
  await expect(select).toBeVisible()
  await expect(select.locator('option')).toHaveCount(3) // 候補は画面表示の都度取得する
  const formOptions = await select.locator('option').allTextContents()
  expect(formOptions[0]).toBe('案件なし')
  expect(formOptions.slice(1).sort()).toEqual(['案件A', '案件B'])
  await shot(window, 'TC-110', '見積書作成画面の「案件」項目')
  noteEvidence(
    'TC-110',
    '付け替え履歴(DB)と書類・記録のハッシュ不変の照合',
    `${rows.join('\n')}\n--\n変更前後のスナップショット一致:\n${before}`
  )
})

test('TC-111: [F-30] 紐づけ・付け替えの異常系。完了の案件への新規紐づけは拒否、現在の案件が完了でも別案件・解除は可、削除済み記録・存在しない対象・履歴の記録失敗でのロールバック', async () => {
  const { window, dataDir } = launched
  const client = await createClientApi(window, '異常系確認商事')
  const done = await createProjectApi(window, { name: '完了予定の案件' })
  const live = await createProjectApi(window, { name: '進行中の案件' })
  const acc = await accountId(window, '通信費')
  const rec = await createRecordApi(window, { accountId: acc, description: '異常系の記録' })
  const q = await saveQuoteDraftApi(window, client, done)
  await mustApi(window, 'completeProject', done)

  const log: string[] = []
  // 完了の案件へ新規に紐づけ
  const r1 = await changeLinkApi(window, 'cash_record', rec, done)
  expect(r1.error).toBe('完了の案件には、新しく紐づけられません')
  log.push(`完了案件へ新規紐づけ: ${r1.error}`)
  // 作成・保存経路(下書き保存)でも拒否される
  const r1b = await callApi(window, 'saveQuoteDraft', {
    clientId: client,
    issueDate: '2026-10-04',
    validUntil: '',
    remarks: '',
    lineItems: [{ name: 'x', quantity: 1, unit: '', unitPrice: 1, taxRate: 10 }],
    projectId: done
  })
  expect(r1b.error).toBe('完了の案件には、新しく紐づけられません')
  expect(dbQuery(dataDir, 'select count(*) from quotes')).toBe('1') // 保存もされない(トランザクション)
  log.push(`下書き保存の経路: ${r1b.error}(保存されない)`)
  // 現在の案件が完了でも、別の案件・案件なしへは付け替えられる(R-40)
  expect((await changeLinkApi(window, 'quote', q, live)).value).toEqual({ changed: true })
  expect(dbQuery(dataDir, `select project_id from quotes where id=${q}`)).toBe(String(live))
  await mustApi(window, 'changeProjectLink', {
    targetType: 'quote',
    targetId: q,
    projectId: done
  }).catch(() => undefined)
  // 完了の案件が現在の案件の場合は、そのまま解除できる
  const q2 = await saveQuoteDraftApi(window, client, null)
  await mustApi(window, 'reopenProject', done)
  await mustApi(window, 'changeProjectLink', { targetType: 'quote', targetId: q2, projectId: done })
  await mustApi(window, 'completeProject', done)
  expect((await changeLinkApi(window, 'quote', q2, null)).value).toEqual({ changed: true })
  log.push('完了案件の紐づけを、別案件へ付け替え・案件なしへ解除: 可')
  // 現在の案件が完了の場合の同一案件指定は、変更なし
  // 削除済みの記録・存在しない対象・存在しない案件
  await mustApi(window, 'deleteRecord', { id: rec, reason: '誤登録' })
  const r2 = await changeLinkApi(window, 'cash_record', rec, live)
  expect(r2.error).toBe('削除した記録は案件に紐づけられません')
  const r3 = await changeLinkApi(window, 'quote', 99999, live)
  expect(r3.error).toBe('対象が見つかりません')
  const r4 = await changeLinkApi(window, 'quote', q, 99999)
  expect(r4.error).toBe('指定された案件が見つかりません')
  const r5 = await callApi(window, 'changeProjectLink', {
    targetType: 'unknown',
    targetId: 1,
    projectId: null
  })
  expect(r5.ok).toBe(false)
  const r6 = await callApi(window, 'changeProjectLink', {
    targetType: 'quote',
    targetId: 0,
    projectId: null
  })
  expect(r6.ok).toBe(false)
  log.push(
    `削除済み記録: ${r2.error} / 存在しない対象: ${r3.error} / 存在しない案件: ${r4.error} / 不正な型: 拒否`
  )

  // 履歴の記録に失敗した場合は、紐づけの更新も含めてロールバックされる
  sqlWrite(
    dataDir,
    "create trigger t_fail_history before insert on project_link_history begin select raise(abort, 'forced failure'); end;"
  )
  const before = dbQuery(dataDir, `select ifnull(project_id,'-') from quotes where id=${q}`)
  const r7 = await changeLinkApi(window, 'quote', q, null)
  expect(r7.error).toBe('付け替え履歴を記録できなかったため、変更できませんでした')
  expect(dbQuery(dataDir, `select ifnull(project_id,'-') from quotes where id=${q}`)).toBe(before)
  log.push(`履歴の記録失敗(強制): ${r7.error}。紐づけは変わらない(ロールバック)`)
  sqlWrite(dataDir, 'drop trigger t_fail_history')
  expect((await changeLinkApi(window, 'quote', q, null)).value).toEqual({ changed: true }) // 復旧後は成功
  noteEvidence('TC-111', '異常系の結果', log.join('\n'))
})

test('TC-112: [F-30] 紐づけの引き継ぎと解除。見積書→請求書の変換で進行中の案件のみ引き継ぎ、入金記録の自動作成は案件なし、削除に伴い自動解除(履歴に残る)、取消済は維持', async () => {
  const { window, dataDir } = launched
  await setupCompany(window)
  const client = await createClientApi(window, '引き継ぎ確認商事')
  const live = await createProjectApi(window, { name: '進行中の案件' })
  const doneP = await createProjectApi(window, { name: '後で完了する案件' })

  // 見積書→請求書の変換: 進行中の案件は引き継がれ、画面の初期値にもなる
  const q1 = await finalizeQuoteWithProject(window, {
    clientId: client,
    unitPrice: 10000,
    projectId: live
  })
  const c1 = await mustApi<{ invoiceId: number }>(window, 'convertQuoteToInvoice', q1.id)
  expect(dbQuery(dataDir, `select project_id from invoices where id=${c1.invoiceId}`)).toBe(
    String(live)
  )
  expect(
    dbQuery(
      dataDir,
      `select kind,ifnull(from_project_name,'-'),to_project_name from project_link_history where target_type='invoice' and target_id=${c1.invoiceId}`
    )
  ).toBe('assign|-|進行中の案件')
  // 画面: 変換元の案件が、請求書作成画面の「案件」の初期値になる
  const q4 = await finalizeQuoteWithProject(window, {
    clientId: client,
    unitPrice: 40000,
    projectId: live
  })
  await window.getByRole('button', { name: '見積書・請求書' }).click()
  await window.getByRole('cell', { name: q4.quoteNumber }).click()
  await window.getByRole('button', { name: '請求書に変換' }).click()
  // 変換後は請求書(下書き)の詳細が開き、案件欄に引き継がれた案件が表示される。編集画面の「案件」の初期値も同じ
  await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - 請求書詳細')
  await expect(window.getByRole('button', { name: '進行中の案件' })).toBeVisible()
  await shot(
    window,
    'TC-112',
    '見積書から変換した請求書(下書き)の詳細。案件欄に変換元の案件が引き継がれている'
  )
  await window.getByRole('button', { name: '編集' }).click()
  const caseSelect = window.getByLabel('案件')
  await expect(caseSelect.locator('option')).toHaveCount(3) // 案件なし+進行中の2件
  await expect(caseSelect.locator('option:checked')).toHaveText('進行中の案件')
  await shot(window, 'TC-112', '請求書の編集画面(「案件」の初期値は引き継がれた案件)')
  window.once('dialog', (d) => void d.accept()) // 入力画面の離脱確認
  await window.getByRole('button', { name: '案件管理' }).click()
  await window.getByRole('button', { name: 'ホーム' }).click()
  // 完了の案件は引き継がれない
  const q2 = await finalizeQuoteWithProject(window, {
    clientId: client,
    unitPrice: 20000,
    projectId: doneP
  })
  await mustApi(window, 'completeProject', doneP)
  const c2 = await mustApi<{ invoiceId: number }>(window, 'convertQuoteToInvoice', q2.id)
  expect(
    dbQuery(dataDir, `select ifnull(project_id,'-') from invoices where id=${c2.invoiceId}`)
  ).toBe('-')
  // 案件なしの見積書の変換
  const q3 = await finalizeQuoteWithProject(window, { clientId: client, unitPrice: 30000 })
  const c3 = await mustApi<{ invoiceId: number }>(window, 'convertQuoteToInvoice', q3.id)
  expect(
    dbQuery(dataDir, `select ifnull(project_id,'-') from invoices where id=${c3.invoiceId}`)
  ).toBe('-')

  // 請求書の入金済み→入金記録は案件を引き継がない(案件なし)
  const inv = await finalizeInvoiceWithProject(window, {
    clientId: client,
    unitPrice: 50000,
    projectId: live,
    id: c1.invoiceId
  })
  await mustApi(window, 'updateInvoicePaymentStatus', inv.id, {
    paymentStatus: 'paid',
    paymentDate: '2026-10-20'
  })
  const income = Number(dbQuery(dataDir, `select id from cash_records where invoice_id=${inv.id}`))
  expect(
    dbQuery(dataDir, `select ifnull(project_id,'-') from cash_records where id=${income}`)
  ).toBe('-')
  expect(
    dbQuery(
      dataDir,
      `select count(*) from project_link_history where target_type='cash_record' and target_id=${income}`
    )
  ).toBe('0')
  // 取消済にしても紐づけは維持される(入金記録を案件に紐づけた後に未収へ戻す)
  await mustApi(window, 'changeProjectLink', {
    targetType: 'cash_record',
    targetId: income,
    projectId: live
  })
  await mustApi(window, 'updateInvoicePaymentStatus', inv.id, {
    paymentStatus: 'unpaid',
    paymentDate: ''
  })
  expect(
    dbQuery(dataDir, `select status||'|'||project_id from cash_records where id=${income}`)
  ).toBe(`cancelled|${live}`)
  // 案件別収支の入金件数には、取消済を含む
  expect((await getProjectApi(window, live)).summary.counts.incomes).toBe(1)

  // 削除に伴う解除(auto_release): 記録の論理削除・下書きの削除
  const acc = await accountId(window, '通信費')
  const rec = await createRecordApi(window, {
    accountId: acc,
    description: '削除で解除される記録',
    projectId: live
  } as never)
  const draft = await saveQuoteDraftApi(window, client, live)
  const idraft = await saveInvoiceDraftApi(window, client, live)
  await mustApi(window, 'deleteRecord', { id: rec, reason: '誤登録' })
  await mustApi(window, 'deleteQuoteDraft', draft)
  await mustApi(window, 'deleteInvoiceDraft', idraft)
  expect(dbQuery(dataDir, `select ifnull(project_id,'-') from cash_records where id=${rec}`)).toBe(
    '-'
  )
  expect(dbQuery(dataDir, `select count(*) from quotes where id=${draft}`)).toBe('0')
  const auto = dbQuery(
    dataDir,
    "select target_type,kind,from_project_name,ifnull(to_project_name,'-') from project_link_history where kind='auto_release' order by id"
  )
  expect(auto).toBe(
    'cash_record|auto_release|進行中の案件|-\nquote|auto_release|進行中の案件|-\ninvoice|auto_release|進行中の案件|-'
  )
  // 案件詳細の履歴にも出る。削除済みの対象は紐づく一覧に出ない
  const d = await getProjectApi(window, live)
  expect(d.history.filter((h) => h.kind === 'auto_release')).toHaveLength(3)
  expect(d.records.map((r) => r.id)).not.toContain(rec)
  await window.getByRole('button', { name: '案件管理' }).click()
  await window.getByRole('cell', { name: '進行中の案件' }).click()
  await expect(window.getByText('自動解除').first()).toBeVisible()
  await shot(
    window,
    'TC-112',
    '案件詳細の付け替え履歴(削除に伴う自動解除・紐づけ・変換による引き継ぎ)'
  )
  noteEvidence('TC-112', '自動解除の履歴(DB)', auto)
})

test('TC-113: [F-31] 案件別収支。売上=発行済み請求書の合計金額(税込・源泉徴収前)、下書き・見積書・入金記録は含めず、経費は取消済・削除済を除く。差引・件数内訳・源泉徴収注記・付け替え後の再計算・一覧との一致', async () => {
  const { window, dataDir } = launched
  await setupCompany(window)
  const client = await createClientApi(window, '収支確認商事')
  const A = await createProjectApi(window, { name: '収支の案件A' })
  const B = await createProjectApi(window, { name: '収支の案件B' })
  const empty = await createProjectApi(window, { name: '紐づけなしの案件' })
  const acc = await accountId(window, '通信費')

  // 案件A: 発行済み請求書2件(うち1件は源泉徴収あり・入金済み)、下書き請求書1件、見積書2件(うち1件は下書き)、経費3件(うち取消はできないため削除1件)、入金記録
  const i1 = await finalizeInvoiceWithProject(window, {
    clientId: client,
    unitPrice: 100000,
    projectId: A
  })
  const i2 = await finalizeInvoiceWithProject(window, {
    clientId: client,
    unitPrice: 200000,
    projectId: A,
    withholding: true
  })
  await saveInvoiceDraftApi(window, client, A, '2026-10-04', 999999) // 下書き(売上に含めない)
  await finalizeQuoteWithProject(window, { clientId: client, unitPrice: 777777, projectId: A }) // 見積書(売上に含めない)
  await saveQuoteDraftApi(window, client, A)
  await mustApi(window, 'updateInvoicePaymentStatus', i1.id, {
    paymentStatus: 'paid',
    paymentDate: '2026-10-20'
  })
  const income = Number(dbQuery(dataDir, `select id from cash_records where invoice_id=${i1.id}`))
  await mustApi(window, 'changeProjectLink', {
    targetType: 'cash_record',
    targetId: income,
    projectId: A
  })
  const e1 = await createRecordApi(window, {
    accountId: acc,
    description: '経費1',
    amount: 30000,
    projectId: A
  } as never)
  await createRecordApi(window, {
    accountId: acc,
    description: '経費2',
    amount: 20000,
    projectId: A
  } as never)
  const e3 = await createRecordApi(window, {
    accountId: acc,
    description: '経費3(削除する)',
    amount: 7777,
    projectId: A
  } as never)
  void e1
  await mustApi(window, 'deleteRecord', { id: e3, reason: '誤登録' })

  const totalOf = (id: number): number =>
    Number(dbQuery(dataDir, `select total_amount from invoices where id=${id}`))
  const withholdingOf = Number(
    dbQuery(
      dataDir,
      `select sum(withholding_tax_amount) from invoices where project_id=${A} and status='finalized'`
    )
  )
  expect(withholdingOf).toBeGreaterThan(0)
  const sales = totalOf(i1.id) + totalOf(i2.id)
  expect(totalOf(i1.id)).toBe(110000) // 100,000円+消費税10%
  expect(totalOf(i2.id)).toBe(220000)

  const dA = await getProjectApi(window, A)
  expect(dA.summary.sales).toBe(sales) // 税込・源泉徴収前の合計。入金額(源泉徴収後)ではない
  expect(dA.summary.withholding).toBe(withholdingOf)
  expect(dA.summary.expense).toBe(50000) // 削除済みは含めない。入金記録も含めない
  expect(dA.summary.balance).toBe(sales - 50000)
  // 件数の内訳: 見積書(下書きを含む)2、請求書は発行済み2・下書き1、入金1(取消済を含む)、経費2(削除済は含めない)
  expect(dA.summary.counts).toEqual({
    quotes: 2,
    invoicesIssued: 2,
    invoicesDraft: 1,
    incomes: 1,
    expenses: 2
  })

  // 案件B: 経費のみ→差引はマイナス。紐づけなしの案件は、すべて0
  await createRecordApi(window, {
    accountId: acc,
    description: 'B案件の経費',
    amount: 12345,
    projectId: B
  } as never)
  const dB = await getProjectApi(window, B)
  expect(dB.summary).toMatchObject({ sales: 0, withholding: 0, expense: 12345, balance: -12345 })
  const dE = await getProjectApi(window, empty)
  expect(dE.summary).toEqual({
    sales: 0,
    withholding: 0,
    expense: 0,
    balance: 0,
    counts: { quotes: 0, invoicesIssued: 0, invoicesDraft: 0, incomes: 0, expenses: 0 }
  })

  // 画面: 案件詳細の表示(売上の注記・源泉徴収の併記・件数内訳)
  await window.getByRole('button', { name: '案件管理' }).click()
  await window.locator('#project-status').selectOption('all')
  await window.getByRole('cell', { name: '収支の案件A' }).click()
  const cards = window.locator('.summary-card .value')
  await expect(cards.nth(0)).toHaveText('¥330,000')
  await expect(cards.nth(1)).toHaveText('¥50,000')
  await expect(cards.nth(2)).toHaveText('¥280,000')
  await expect(
    window.getByText('売上は、発行済みの請求書の金額(源泉徴収前)です。入金額は含みません。')
  ).toBeVisible()
  await expect(window.getByText(/うち源泉徴収額/)).toBeVisible()
  await shot(window, 'TC-113', '案件Aの詳細(売上・経費・差引、源泉徴収額の併記、件数の内訳)')
  // 源泉徴収のない案件には「うち源泉徴収額」を出さない
  await window
    .getByText('一覧へ戻る')
    .first()
    .click()
    .catch(() => undefined)
  await window.getByRole('button', { name: '案件管理' }).click()
  await window.locator('#project-status').selectOption('all')
  await window.getByRole('cell', { name: '収支の案件B' }).click()
  await expect(window.locator('.summary-card .value').nth(2)).toHaveText('−¥12,345')
  await expect(window.getByText(/うち源泉徴収額/)).toHaveCount(0)
  await shot(window, 'TC-113', '案件Bの詳細(経費のみ。差引はマイナス)')

  // 付け替えで再計算される: 請求書i2(源泉徴収あり)を案件Bへ付け替える
  await mustApi(window, 'changeProjectLink', {
    targetType: 'invoice',
    targetId: i2.id,
    projectId: B
  })
  const dA2 = await getProjectApi(window, A)
  const dB2 = await getProjectApi(window, B)
  expect(dA2.summary.sales).toBe(totalOf(i1.id))
  expect(dA2.summary.withholding).toBe(0)
  expect(dB2.summary.sales).toBe(totalOf(i2.id))
  expect(dB2.summary.withholding).toBe(withholdingOf)
  expect(dB2.summary.balance).toBe(totalOf(i2.id) - 12345)

  // 一覧の売上・経費・差引は、詳細の案件別収支と一致する
  const list = await mustApi<
    Array<{ id: number; sales: number; expense: number; balance: number }>
  >(window, 'listProjects', { status: 'all' })
  for (const item of list) {
    const d = await getProjectApi(window, item.id)
    expect([item.sales, item.expense, item.balance]).toEqual([
      d.summary.sales,
      d.summary.expense,
      d.summary.balance
    ])
  }
  await window.getByRole('button', { name: '案件管理' }).click()
  await window.locator('#project-status').selectOption('all')
  await expect(window.locator('tbody tr')).toHaveCount(3)
  await shot(window, 'TC-113', '案件一覧の売上・経費・差引の列(付け替え後)')
  noteEvidence(
    'TC-113',
    '案件別収支の照合(DBの金額と画面・API)',
    `案件A(付け替え前): 売上=${sales}(請求書2件の合計金額・税込・源泉徴収前)、源泉徴収額=${withholdingOf}、経費=50000、差引=${sales - 50000}\n案件B: 経費12345、差引-12345\n付け替え後: 案件A売上=${dA2.summary.sales}、案件B売上=${dB2.summary.sales}`
  )
})
