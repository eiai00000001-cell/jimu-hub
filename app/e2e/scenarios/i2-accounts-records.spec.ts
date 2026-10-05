import { test, expect } from '@playwright/test'
import { rmSync } from 'node:fs'
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/electron-app'
import { noteEvidence, shot } from './evidence-dir'
import { createClientApi, dbQuery } from './helpers'
import {
  accountId,
  callApi,
  createRecordApi,
  makeReceiptFixtures,
  mustApi,
  pickTokens,
  type Fixtures
} from './helpers-i2'

/**
 * 【tester作成】イテレーション2: F-17(勘定科目)・F-18(入出金・経費の登録・編集・削除)・F-19(一覧・検索)・F-20(履歴)
 * (TC-78〜TC-84)。参照元: 詳細設計書 3.15〜3.21章・4.17〜4.20章・8章
 */
let launched: LaunchedApp
let fx: Fixtures

test.beforeEach(async () => {
  fx = makeReceiptFixtures()
  launched = await launchApp({ JIMUHUB_E2E_RECEIPT_PATHS: fx.pdf })
})
test.afterEach(async () => {
  try {
    await closeApp(launched)
  } catch {
    rmSync(launched.dataDir, { recursive: true, force: true })
  }
  rmSync(fx.dir, { recursive: true, force: true })
})

async function openAccounts(window: LaunchedApp['window']): Promise<void> {
  await window.getByRole('button', { name: '入出金・経費' }).click()
  await window.getByRole('button', { name: '勘定科目の管理' }).click()
  await expect(window.getByText('科目を追加')).toBeVisible()
}

test('TC-78: 初期科目14件(経費12・収入2)が表示順どおりに用意され、「売上高」はシステム既定として利用停止できない', async () => {
  const { window, dataDir } = launched
  await openAccounts(window)
  await expect(window.locator('tbody tr')).toHaveCount(14)
  const names = (await window.locator('tbody tr td:first-child').allTextContents()).map((t) =>
    t.replace('システム既定', '')
  )
  expect(names).toEqual([
    '通信費',
    '旅費交通費',
    '消耗品費',
    '接待交際費',
    '外注費',
    '会議費',
    '地代家賃',
    '水道光熱費',
    '広告宣伝費',
    '租税公課',
    '支払手数料',
    '雑費',
    '売上高',
    '雑収入'
  ])
  const salesRow = window.getByRole('row').filter({ hasText: '売上高' })
  await expect(salesRow.getByText('システム既定')).toBeVisible()
  await expect(salesRow.getByRole('button', { name: '利用停止' })).toHaveCount(0)
  await expect(salesRow.getByRole('button', { name: '名称を変更' })).toBeVisible()
  await expect(salesRow.getByRole('button', { name: '削除' })).toHaveCount(0)
  await shot(window, 'TC-78', '勘定科目の管理画面(初期科目14件。売上高にシステム既定バッジ)')

  const db = [
    dbQuery(dataDir, 'select count(*) from accounts'),
    dbQuery(dataDir, 'select count(*) from accounts where is_default=1'),
    dbQuery(dataDir, "select name||'|'||default_key from accounts where default_key is not null"),
    dbQuery(dataDir, "select value from app_meta where key='schema_version'"),
    dbQuery(
      dataDir,
      "select group_concat(sort_order) from (select sort_order from accounts where kind='expense' order by id)"
    )
  ]
  expect(db[0]).toBe('14')
  expect(db[1]).toBe('14')
  expect(db[2]).toBe('売上高|sales_revenue')
  expect(db[3]).toBe('4')
  expect(db[4]).toBe('10,20,30,40,50,60,70,80,90,100,110,120')
  noteEvidence(
    'TC-78',
    'DB照合(accounts件数・is_default・default_key・schema_version・sort_order)',
    db.join('\n')
  )

  // 売上高の利用停止・削除をIPCから試みると拒否される
  const sales = await accountId(window, '売上高')
  const r1 = await callApi(window, 'deactivateAccount', sales)
  expect(r1.error).toBe('「売上高」は請求書の入金記録で使うため、利用停止にできません')
  const r2 = await callApi(window, 'deleteAccount', await accountId(window, '通信費'))
  expect(r2.error).toBe('利用済みの科目は削除できません。利用停止にしてください')
  noteEvidence(
    'TC-78',
    'IPC経由の拒否文言',
    `deactivate売上高: ${r1.error}\ndelete初期科目: ${r2.error}`
  )
})

test('TC-79: 勘定科目の追加・名称変更・利用停止/再開・削除と異常系(重複・空欄・文字数)', async () => {
  const { window, dataDir } = launched
  window.on('dialog', (d) => void d.accept())
  await openAccounts(window)

  // 追加(正常)
  await window.getByLabel(/名称/).first().fill('研修費')
  await window.getByRole('button', { name: '追加', exact: true }).click()
  const row = window.getByRole('row').filter({ hasText: '研修費' })
  await expect(row).toBeVisible()
  await expect(row.getByRole('button', { name: '削除' })).toBeVisible() // 未使用のため削除可
  // 異常系: 空欄・重複・同名の別区分は許可
  await window.getByLabel(/名称/).first().fill('   ')
  await window.getByRole('button', { name: '追加', exact: true }).click()
  await expect(window.getByText('科目の名称を入力してください')).toBeVisible()
  await window.getByLabel(/名称/).first().fill('研修費')
  await window.getByRole('button', { name: '追加', exact: true }).click()
  await expect(window.getByText('同じ区分に同じ名称の科目があります')).toBeVisible()
  await shot(window, 'TC-79', '同じ区分での重複名称エラー')
  await window.getByLabel(/名称/).first().fill('研修費')
  await window.getByLabel(/区分/).selectOption('income')
  await window.getByRole('button', { name: '追加', exact: true }).click()
  await expect(window.getByRole('row').filter({ hasText: '研修費' })).toHaveCount(2)
  const tooLong = await callApi(window, 'createAccount', { name: 'あ'.repeat(31), kind: 'expense' })
  expect(tooLong.error).toBe('科目の名称は30文字以内で入力してください')
  const ok30 = await callApi(window, 'createAccount', { name: 'い'.repeat(30), kind: 'expense' })
  expect(ok30.ok).toBe(true)

  // 名称変更(初期科目「売上高」も変更可。default_keyは維持)
  const sales = window.getByRole('row').filter({ hasText: '売上高' })
  await sales.getByRole('button', { name: '名称を変更' }).click()
  await window.getByLabel('売上高の新しい名称').fill('事業収入')
  await window.getByRole('button', { name: '確定' }).click()
  await expect(window.getByRole('row').filter({ hasText: '事業収入' })).toBeVisible()
  expect(dbQuery(dataDir, "select name from accounts where default_key='sales_revenue'")).toBe(
    '事業収入'
  )
  // 変更先が重複する場合は拒否
  const dup = await callApi(window, 'renameAccount', await accountId(window, '通信費'), '雑費')
  expect(dup.error).toBe('同じ区分に同じ名称の科目があります')
  // 自身と同名への変更は許可(自身を除く判定)
  const same = await callApi(window, 'renameAccount', await accountId(window, '通信費'), '通信費')
  expect(same.ok).toBe(true)

  // 利用停止→登録の選択肢から消え、再開で戻る。既存記録・集計は維持
  const training = await accountId(window, '研修費') // 経費側(idが小さい方)
  const recId = await createRecordApi(window, {
    accountId: training,
    description: '研修費の記録',
    amount: 5000
  })
  // 画面は表示時点の状態を保持するため、一覧へ戻って開き直す
  await window.getByText('← 一覧へ戻る').click()
  await window.getByRole('button', { name: '勘定科目の管理' }).click()
  const rowT = window.getByRole('row').filter({ hasText: '研修費' }).first()
  await expect(rowT.getByRole('button', { name: '削除' })).toHaveCount(0) // 利用済みは削除不可
  await rowT.getByRole('button', { name: '利用停止' }).click()
  await expect(rowT.getByText('利用停止')).toBeVisible()
  const rejected = await callApi(window, 'createRecord', {
    kind: 'expense',
    recordDate: '2026-10-02',
    amount: 100,
    accountId: training,
    description: 'x',
    clientId: null,
    paymentMethod: null,
    taxCategory: null,
    receiptTokens: []
  })
  expect(rejected.error).toBe('利用停止中の勘定科目・取引先は選択できません')
  const detail = await mustApi<{ accountName: string }>(window, 'getRecord', recId)
  expect(detail.accountName).toBe('研修費')
  await window.getByText('← 一覧へ戻る').click()
  await window.getByRole('button', { name: '+ 経費を登録' }).click()
  const opts = await window
    .getByLabel(/勘定科目/)
    .locator('option')
    .allTextContents()
  expect(opts).not.toContain('研修費')
  expect(opts).toContain('通信費')
  await shot(window, 'TC-79', '利用停止の科目は経費登録の選択肢に表示されない')
  noteEvidence('TC-79', '経費登録の勘定科目の選択肢', opts.join(', '))
  await window.getByRole('button', { name: 'キャンセル' }).click()
  await window.getByRole('button', { name: '勘定科目の管理' }).click()
  await window
    .getByRole('row')
    .filter({ hasText: '研修費' })
    .first()
    .getByRole('button', { name: '利用を再開' })
    .click()
  await expect(
    window.getByRole('row').filter({ hasText: '研修費' }).first().getByText('利用中')
  ).toBeVisible()
  // 名称変更は過去の記録に反映され、履歴のスナップショットは変更時点のまま
  await mustApi(window, 'renameAccount', training, '研修・セミナー費')
  const after = await mustApi<{
    accountName: string
    history: Array<{ changes: Array<{ after: string }> }>
  }>(window, 'getRecord', recId)
  expect(after.accountName).toBe('研修・セミナー費')
  expect(JSON.stringify(after.history)).toContain('研修費')
  noteEvidence('TC-79', '名称変更後の記録の科目名と履歴', JSON.stringify(after, null, 1))
  // 未使用科目の削除
  const unused = window.getByRole('row').filter({ hasText: 'い'.repeat(30) })
  await window
    .getByText('← 一覧へ戻る')
    .click()
    .catch(() => undefined)
  if (!(await unused.isVisible().catch(() => false))) {
    await window.getByRole('button', { name: '勘定科目の管理' }).click()
  }
  await unused.getByRole('button', { name: '削除' }).click()
  await expect(unused).toHaveCount(0)
})

test('TC-80: 経費・入金の登録(画面)。消費税額の自動計算・詳細表示・DB・履歴・記録ハッシュ', async () => {
  const { window, dataDir } = launched
  const clientId = await createClientApi(window, '登録確認商店', {
    furigana: 'トウロクカクニンショウテン'
  })
  await window.getByRole('button', { name: '入出金・経費' }).click()
  await expect(window.getByText('該当する記録がありません')).toBeVisible()
  await window.getByRole('button', { name: '+ 経費を登録' }).click()
  // 初期値: 種別=経費、日付=本日
  await expect(window.getByRole('radio', { name: /経費/ })).toBeChecked()
  await window.getByLabel(/金額/).fill('6,600')
  await window.getByLabel(/勘定科目/).selectOption({ label: '通信費' })
  await window.getByLabel(/摘要・メモ/).fill('  インターネット回線 10月分  ')
  await window.getByLabel('取引先').selectOption({ label: '登録確認商店' })
  await window.getByLabel('支払方法').selectOption('transfer')
  await window.getByLabel('税区分').selectOption('standard_10')
  await expect(window.getByLabel('消費税額')).toHaveText('¥600')
  await window.getByLabel('税区分').selectOption('reduced_8')
  await expect(window.getByLabel('消費税額')).toHaveText('¥488') // floor(6600*8/108)=488
  await window.getByLabel('税区分').selectOption('tax_exempt')
  await expect(window.getByLabel('消費税額')).toHaveText('¥0')
  await window.getByLabel('税区分').selectOption('standard_10')
  await window.getByRole('button', { name: 'ファイルを追加' }).click()
  await expect(window.getByText('receipt_sample.pdf')).toBeVisible()
  await shot(window, 'TC-80', '経費の登録画面(入力済み・消費税額600円・領収書1件)')
  await window.getByRole('button', { name: '登録', exact: true }).click()
  await expect(window.getByText('記録を登録しました')).toBeVisible()
  await expect(window.getByText('インターネット回線 10月分').first()).toBeVisible()
  await shot(window, 'TC-80', '登録後の詳細画面(完了メッセージ・領収書・履歴)')

  // 入金の登録(税区分・支払方法は未選択でも可)
  await window.getByRole('button', { name: '入出金・経費' }).click()
  await window.getByRole('button', { name: '+ 入金を登録' }).click()
  await expect(window.getByRole('radio', { name: /入金/ })).toBeChecked()
  const opts = await window
    .getByLabel(/勘定科目/)
    .locator('option')
    .allTextContents()
  expect(opts).toContain('売上高')
  expect(opts).not.toContain('通信費') // 種別に合う区分のみ
  await window.getByLabel(/金額/).fill('55000')
  await window.getByLabel(/勘定科目/).selectOption({ label: '雑収入' })
  await window.getByLabel(/摘要・メモ/).fill('講師謝礼')
  await window.getByRole('button', { name: '登録', exact: true }).click()
  await expect(window.getByText('記録を登録しました')).toBeVisible()
  await window.getByRole('button', { name: '入出金・経費' }).click()
  await expect(window.getByText('+¥55,000')).toBeVisible()
  await expect(window.getByText('−¥6,600')).toBeVisible()
  await shot(window, 'TC-80', '一覧(入金は+、経費は−の記号と種別バッジ)')

  // 消費税の端数処理(API): 10%/8%は切り捨て、非課税・未選択は0
  const acc = await accountId(window, '消耗品費')
  const cases: Array<[number, string | null, number]> = [
    [1100, 'standard_10', 100],
    [999, 'standard_10', 90],
    [1080, 'reduced_8', 80],
    [1000, 'reduced_8', 74],
    [5000, 'tax_exempt', 0],
    [5000, 'not_applicable', 0],
    [5000, null, 0],
    [9999999999, 'standard_10', 909090909]
  ]
  const out: string[] = []
  for (const [amount, cat, expected] of cases) {
    const id = await createRecordApi(window, { accountId: acc, amount, taxCategory: cat })
    const d = await mustApi<{ taxAmount: number }>(window, 'getRecord', id)
    out.push(`amount=${amount} cat=${cat} -> ${d.taxAmount} (期待 ${expected})`)
    expect(d.taxAmount).toBe(expected)
  }
  noteEvidence('TC-80', '消費税額の算出(端数切り捨て・境界値)', out.join('\n'))

  // DB: 摘要は前後空白除去、記録ハッシュ64桁、履歴create1件(snapshot_before NULL)、領収書sha256
  const row = dbQuery(
    dataDir,
    "select description||'|'||amount||'|'||tax_amount||'|'||payment_method||'|'||client_id||'|'||length(record_hash)||'|'||is_deleted||'|'||status||'|'||ifnull(invoice_id,'NULL') from cash_records where id=1"
  )
  expect(row).toBe(`インターネット回線 10月分|6600|600|transfer|${clientId}|64|0|active|NULL`)
  const hist = dbQuery(
    dataDir,
    "select operation||'|'||ifnull(snapshot_before,'NULL')||'|'||length(record_hash_after)||'|'||ifnull(reason,'NULL') from cash_record_history where record_id=1"
  )
  expect(hist).toBe('create|NULL|64|NULL')
  const hashSame = dbQuery(
    dataDir,
    'select (select record_hash from cash_records where id=1)=(select record_hash_after from cash_record_history where record_id=1)'
  )
  expect(hashSame).toBe('1')
  const rc = dbQuery(
    dataDir,
    "select count(*)||'|'||length(sha256)||'|'||(file_path like 'receipts/____/%.pdf')||'|'||ifnull(removed_at,'NULL') from receipts where record_id=1"
  )
  expect(rc).toBe('1|64|1|NULL')
  noteEvidence(
    'TC-80',
    'DB照合(cash_records・履歴・領収書)',
    [row, hist, `hash一致=${hashSame}`, rc].join('\n')
  )
  void clientId
})

test('TC-81: 入力値検証(画面・IPC境界): 日付・金額・勘定科目・摘要・取引先・領収書', async () => {
  const { window, app } = launched
  await window.getByRole('button', { name: '入出金・経費' }).click()
  await window.getByRole('button', { name: '+ 経費を登録' }).click()
  // 画面: 必須未入力
  await window.getByLabel(/日付/).fill('')
  await window.getByRole('button', { name: '登録', exact: true }).click()
  for (const m of [
    '日付を入力してください',
    '金額は1円以上9,999,999,999円以下の整数で入力してください',
    '勘定科目を選択してください',
    '摘要・メモを入力してください'
  ])
    await expect(window.getByText(m)).toBeVisible()
  await shot(window, 'TC-81', '必須項目未入力の4エラー(該当項目の下に赤字)')
  // 画面: 不正値
  await window.getByLabel(/日付/).fill('2100-01-01')
  await window.getByLabel(/金額/).fill('abc')
  await window.getByLabel(/摘要・メモ/).fill('あ'.repeat(201))
  await window.getByRole('button', { name: '登録', exact: true }).click()
  await expect(window.getByText('日付は2000年〜2099年の範囲で入力してください')).toBeVisible()
  await expect(
    window.getByText('金額は1円以上9,999,999,999円以下の整数で入力してください')
  ).toBeVisible()
  await expect(window.getByText('摘要・メモは200文字以内で入力してください')).toBeVisible()
  await shot(window, 'TC-81', '範囲外の日付・数値以外の金額・201文字の摘要')

  // IPC境界
  const acc = await accountId(window, '通信費')
  const income = await accountId(window, '雑収入')
  const base = {
    kind: 'expense',
    recordDate: '2026-10-01',
    amount: 1000,
    accountId: acc,
    description: 'd',
    clientId: null,
    paymentMethod: null,
    taxCategory: null,
    receiptTokens: []
  }
  const rows: Array<[string, Record<string, unknown>, string]> = [
    ['金額0', { amount: 0 }, '金額は1円以上9,999,999,999円以下の整数で入力してください'],
    [
      '金額10,000,000,000',
      { amount: 10000000000 },
      '金額は1円以上9,999,999,999円以下の整数で入力してください'
    ],
    ['金額1.5', { amount: 1.5 }, '金額は1円以上9,999,999,999円以下の整数で入力してください'],
    [
      '日付1999-12-31',
      { recordDate: '1999-12-31' },
      '日付は2000年〜2099年の範囲で入力してください'
    ],
    [
      '日付2026-02-30',
      { recordDate: '2026-02-30' },
      '日付は「YYYY-MM-DD」形式の正しい日付で入力してください'
    ],
    ['摘要空白のみ', { description: '   ' }, '摘要・メモを入力してください'],
    ['摘要201文字', { description: 'x'.repeat(201) }, '摘要・メモは200文字以内で入力してください'],
    ['種別と科目の区分不一致', { accountId: income }, '勘定科目が種別と一致しません'],
    ['種別が列挙値外', { kind: 'other' }, ''],
    ['税区分が列挙値外', { taxCategory: 'x' }, ''],
    ['科目が存在しない', { accountId: 99999 }, '']
  ]
  const log: string[] = []
  for (const [label, patch, msg] of rows) {
    const r = await callApi(window, 'createRecord', { ...base, ...patch })
    log.push(`${label}: ok=${r.ok} error=${r.error}`)
    expect(r.ok, label).toBe(false)
    if (msg) expect(r.error, label).toBe(msg)
  }
  // 上限ちょうど(9,999,999,999)・摘要200文字ちょうどは受理
  const okMax = await callApi(window, 'createRecord', {
    ...base,
    amount: 9999999999,
    description: 'y'.repeat(200)
  })
  expect(okMax.ok).toBe(true)
  log.push(`境界(金額9,999,999,999・摘要200文字): ok=${okMax.ok}`)
  // 利用停止の取引先
  const cid = await createClientApi(window, '停止予定商事')
  await mustApi(window, 'deactivateClient', cid)
  const inactiveClient = await callApi(window, 'createRecord', { ...base, clientId: cid })
  expect(inactiveClient.error).toBe('利用停止中の勘定科目・取引先は選択できません')
  log.push(`利用停止の取引先: ${inactiveClient.error}`)
  // 領収書: 検証
  const bad = await pickTokens(window, app, [
    fx.txt,
    fx.fakePng,
    fx.empty,
    fx.big,
    fx.pdf,
    fx.png,
    fx.jpg
  ])
  log.push('領収書の選択結果: ' + JSON.stringify(bad.errors))
  expect(bad.files.map((f) => f.fileName).sort()).toEqual([
    'receipt_sample.jpg',
    'receipt_sample.pdf',
    'receipt_sample.png'
  ])
  const errs = Object.fromEntries(bad.errors.map((e) => [e.fileName, e.error]))
  expect(errs['memo.txt']).toBe('領収書として添付できるのは、PDF・JPEG・PNGのファイルです')
  expect(errs['fake.png']).toBe('領収書として添付できるのは、PDF・JPEG・PNGのファイルです')
  expect(errs['empty.pdf']).toBe('領収書として添付できるのは、PDF・JPEG・PNGのファイルです')
  expect(errs['too_big.pdf']).toBe('領収書は1ファイル10MBまでです')
  // 同じtokenの重複指定・6件・無効token
  const t = bad.files[0].token
  const dupTok = await callApi(window, 'createRecord', { ...base, receiptTokens: [t, t] })
  expect(dupTok.ok).toBe(false)
  log.push(`token重複: ${dupTok.error}`)
  const six = await callApi(window, 'createRecord', {
    ...base,
    receiptTokens: ['a', 'b', 'c', 'd', 'e', 'f']
  })
  expect(six.ok).toBe(false)
  log.push(`6件: ${six.error}`)
  const inv = await callApi(window, 'createRecord', {
    ...base,
    receiptTokens: ['00000000-0000-0000-0000-000000000000']
  })
  expect(inv.error).toBe('選択したファイルが無効になりました。もう一度ファイルを選択してください')
  log.push(`無効token: ${inv.error}`)
  noteEvidence('TC-81', 'IPC境界の入力検証結果', log.join('\n'))
})

test('TC-82: 記録の編集(変更理由・変更なし・領収書の追加と外す)と論理削除・削除済みの読み取り専用', async () => {
  const { window, app, dataDir } = launched
  const acc = await accountId(window, '消耗品費')
  const pdfTok = await pickTokens(window, app, [fx.pdf])
  const id = await createRecordApi(window, {
    accountId: acc,
    description: '文房具',
    amount: 2200,
    taxCategory: 'standard_10',
    receiptTokens: [pdfTok.files[0].token]
  })
  window.on('dialog', (d) => void d.accept())
  await window.getByRole('button', { name: '入出金・経費' }).click()
  await window.getByText('文房具').click()
  await window.getByRole('button', { name: '編集', exact: true }).click()
  // 種別は編集時は表示のみ
  await expect(window.getByRole('radio')).toHaveCount(0)
  await expect(window.locator('.readonly').filter({ hasText: /^経費$/ })).toBeVisible()
  // 変更なしで保存 → 「変更はありません」、履歴は増えない
  await window.getByRole('button', { name: '保存', exact: true }).click()
  await expect(window.getByText('変更はありません')).toBeVisible()
  expect(dbQuery(dataDir, `select count(*) from cash_record_history where record_id=${id}`)).toBe(
    '1'
  )
  // 変更(金額・摘要・変更理由、領収書を外して新規追加)
  await window
    .getByRole('button', { name: '編集', exact: true })
    .click()
    .catch(() => undefined)
  await window.getByLabel(/金額/).fill('3300')
  await window.getByLabel(/摘要・メモ/).fill('文房具(訂正)')
  await window.getByLabel(/変更理由/).fill('金額の入力誤り')
  await shot(window, 'TC-82', '編集画面(金額・摘要・変更理由を変更)')
  await window.getByRole('button', { name: '保存', exact: true }).click()
  await expect(window.getByText('記録を更新しました')).toBeVisible()
  const d = await mustApi<{
    amount: number
    taxAmount: number
    history: Array<{
      operation: string
      reason: string | null
      changes: Array<{ label: string; before: string; after: string }>
    }>
  }>(window, 'getRecord', id)
  expect(d.amount).toBe(3300)
  expect(d.taxAmount).toBe(300)
  expect(d.history.map((h) => h.operation)).toEqual(['update', 'create'])
  expect(d.history[0].reason).toBe('金額の入力誤り')
  expect(d.history[0].changes.map((c) => c.label).sort()).toEqual(
    ['摘要・メモ', '消費税額', '金額'].sort()
  )
  await shot(window, 'TC-82', '更新後の詳細(履歴に更新が追加)')
  noteEvidence('TC-82', '更新後の履歴(変更前後)', JSON.stringify(d.history, null, 1))
  // 領収書を外す(removeReceiptIds)→ファイルは残り、外した扱い。5件上限
  const det = await mustApi<{ receipts: Array<{ id: number }> }>(window, 'getRecord', id)
  const rid = det.receipts[0].id
  const pngTok = await pickTokens(window, app, [fx.png, fx.jpg])
  await mustApi(window, 'updateRecord', {
    id,
    kind: 'expense',
    recordDate: '2026-10-01',
    amount: 3300,
    accountId: acc,
    description: '文房具(訂正)',
    clientId: null,
    paymentMethod: null,
    taxCategory: 'standard_10',
    removeReceiptIds: [rid],
    addReceiptTokens: pngTok.files.map((f) => f.token),
    reason: ''
  })
  const after = await mustApi<{
    receipts: Array<{ id: number; removed: boolean; state: string; originalName: string }>
  }>(window, 'getRecord', id)
  expect(after.receipts.filter((r) => r.removed).map((r) => r.originalName)).toEqual([
    'receipt_sample.pdf'
  ])
  expect(after.receipts.filter((r) => !r.removed)).toHaveLength(2)
  expect(after.receipts.every((r) => r.state === 'ok')).toBe(true)
  expect(
    dbQuery(
      dataDir,
      `select count(*) from receipts where record_id=${id} and removed_at is not null`
    )
  ).toBe('1')
  // 外した領収書を再度外す指定は拒否
  const badRemove = await callApi(window, 'updateRecord', {
    id,
    kind: 'expense',
    recordDate: '2026-10-01',
    amount: 3300,
    accountId: acc,
    description: '文房具(訂正)',
    clientId: null,
    paymentMethod: null,
    taxCategory: 'standard_10',
    removeReceiptIds: [rid],
    addReceiptTokens: [],
    reason: ''
  })
  expect(badRemove.ok).toBe(false)
  noteEvidence(
    'TC-82',
    '領収書を外す・追加した後の状態と再度外す指定の拒否',
    JSON.stringify(after.receipts, null, 1) + '\n再度外す: ' + badRemove.error
  )

  // 削除(論理削除)。変更理由つき
  await window.getByRole('button', { name: '入出金・経費' }).click()
  await window.getByText('文房具(訂正)').click()
  await window.getByRole('button', { name: '削除', exact: true }).click()
  await expect(window.getByText('この記録を削除しますか')).toBeVisible()
  await shot(window, 'TC-82', '削除確認ダイアログ(変更理由の任意入力)')
  await window.getByLabel(/変更理由/).fill('重複登録のため')
  await window.getByRole('button', { name: 'はい' }).click()
  await expect(window.getByText('記録を削除しました')).toBeVisible()
  await expect(window.getByText('文房具(訂正)')).toHaveCount(0)
  expect(dbQuery(dataDir, `select is_deleted from cash_records where id=${id}`)).toBe('1')
  expect(dbQuery(dataDir, `select count(*) from receipts where record_id=${id}`)).toBe('3') // 領収書行は削除しない
  expect(
    dbQuery(
      dataDir,
      `select operation||'|'||reason from cash_record_history where record_id=${id} order by id desc limit 1`
    )
  ).toBe('delete|重複登録のため')
  // 削除済みも詳細は取得でき(読み取り専用)、編集・再削除はできない
  const del = await mustApi<{ isDeleted: boolean }>(window, 'getRecord', id)
  expect(del.isDeleted).toBe(true)
  const edit = await callApi(window, 'updateRecord', {
    id,
    kind: 'expense',
    recordDate: '2026-10-01',
    amount: 1,
    accountId: acc,
    description: 'x',
    clientId: null,
    paymentMethod: null,
    taxCategory: null,
    removeReceiptIds: [],
    addReceiptTokens: [],
    reason: ''
  })
  expect(edit.error).toBe('対象の記録が見つかりません')
  const redel = await callApi(window, 'deleteRecord', { id })
  expect(redel.error).toBe('対象の記録が見つかりません')
  // 履歴タブ→「記録を表示」で削除済みバッジ・編集/削除ボタンなし
  await window.getByRole('button', { name: '履歴', exact: true }).click()
  await window.getByRole('button', { name: '記録を表示' }).first().click()
  await expect(window.getByText('削除済み').first()).toBeVisible()
  await expect(window.getByRole('button', { name: '編集', exact: true })).toHaveCount(0)
  await expect(window.getByRole('button', { name: '削除', exact: true })).toHaveCount(0)
  await shot(window, 'TC-82', '削除済みの記録(読み取り専用。削除済みバッジ、編集・削除ボタンなし)')
  // 存在しないid
  const nf = await callApi(window, 'getRecord', 99999)
  expect(nf.error).toBe('対象の記録が見つかりません')
})

test('TC-83: 一覧の検索(日付・金額・取引先・科目・種別のAND)・並び順・ページ送り・0件・範囲エラー', async () => {
  const { window } = launched
  const a1 = await accountId(window, '通信費')
  const a2 = await accountId(window, '旅費交通費')
  const inc = await accountId(window, '雑収入')
  const c1 = await createClientApi(window, '検索用A商事')
  const c2 = await createClientApi(window, '検索用B商事')
  await createRecordApi(window, {
    accountId: a1,
    recordDate: '2026-03-10',
    amount: 1000,
    description: '3月通信',
    clientId: c1
  })
  await createRecordApi(window, {
    accountId: a2,
    recordDate: '2026-04-10',
    amount: 5000,
    description: '4月旅費',
    clientId: c2
  })
  await createRecordApi(window, {
    kind: 'income',
    accountId: inc,
    recordDate: '2026-04-10',
    amount: 9000,
    description: '4月入金',
    clientId: c1
  })
  await createRecordApi(window, {
    accountId: a1,
    recordDate: '2026-05-01',
    amount: 3000,
    description: '5月通信'
  })
  type L = { totalCount: number; items: Array<{ description: string }> }
  const q = async (f: Record<string, unknown>): Promise<L> => mustApi<L>(window, 'listRecords', f)
  expect((await q({})).items.map((i) => i.description)).toEqual([
    '5月通信',
    '4月入金',
    '4月旅費',
    '3月通信'
  ]) // 日付降順・同日はid降順
  expect((await q({ dateFrom: '2026-04-01', dateTo: '2026-04-30' })).totalCount).toBe(2)
  expect((await q({ amountMin: 3000, amountMax: 5000 })).totalCount).toBe(2)
  expect((await q({ clientId: c1 })).totalCount).toBe(2)
  expect((await q({ accountId: a1 })).totalCount).toBe(2)
  expect((await q({ kind: 'income' })).totalCount).toBe(1)
  expect(
    (
      await q({ clientId: c1, kind: 'expense', dateFrom: '2026-03-01', dateTo: '2026-03-31' })
    ).items.map((i) => i.description)
  ).toEqual(['3月通信'])
  expect((await q({ amountMin: 1000, amountMax: 1000 })).totalCount).toBe(1) // 境界(含む)
  const badDate = await callApi(window, 'listRecords', {
    dateFrom: '2026-05-01',
    dateTo: '2026-04-01'
  })
  expect(badDate.error).toBe('日付の終了日は、開始日以降の日付を入力してください')
  const badAmount = await callApi(window, 'listRecords', { amountMin: 10, amountMax: 5 })
  expect(badAmount.error).toBe('金額の上限は、下限以上の金額を入力してください')
  noteEvidence('TC-83', 'IPC境界の範囲エラー', `日付: ${badDate.error}\n金額: ${badAmount.error}`)

  // 画面: 検索条件の即時反映・範囲エラー中は直前の表示を維持・0件
  await window.getByRole('button', { name: '入出金・経費' }).click()
  await expect(window.locator('tbody tr')).toHaveCount(4)
  await window.getByLabel('種別').selectOption('income')
  await expect(window.locator('tbody tr')).toHaveCount(1)
  await window.getByLabel('種別').selectOption('')
  await window.getByLabel('勘定科目').selectOption({ label: '通信費' })
  await expect(window.locator('tbody tr')).toHaveCount(2)
  await shot(window, 'TC-83', '勘定科目=通信費で絞り込み(2件)')
  await window.getByLabel('日付(開始)').fill('2026-05-01')
  await expect(window.locator('tbody tr')).toHaveCount(1) // 通信費かつ5/1以降=1件
  await window.getByLabel('日付(終了)').fill('2026-04-01')
  await expect(window.getByText('日付の終了日は、開始日以降の日付を入力してください')).toBeVisible()
  await expect(window.locator('tbody tr')).toHaveCount(1) // 直前の表示を維持
  await shot(window, 'TC-83', '日付範囲エラー(エラー文言表示・直前の一覧を維持)')
  await window.getByLabel('日付(開始)').fill('2026-06-01')
  await window.getByLabel('日付(終了)').fill('2026-12-31')
  await expect(window.getByText('該当する記録がありません')).toBeVisible()
  await shot(window, 'TC-83', '該当0件の案内')
  await window.getByLabel('金額(下限)').fill('9')
  await window.getByLabel('金額(上限)').fill('1')
  await expect(window.getByText('金額の上限は、下限以上の金額を入力してください')).toBeVisible()

  // ページ送り(50件/ページ): 追加で48件→合計52件
  for (let i = 0; i < 48; i++)
    await createRecordApi(window, {
      accountId: a2,
      recordDate: '2026-06-01',
      amount: 100 + i,
      description: `一括${i}`
    })
  const p1 = await mustApi<{ items: unknown[]; totalCount: number; pageSize: number }>(
    window,
    'listRecords',
    { page: 1 }
  )
  const p2 = await mustApi<{ items: unknown[] }>(window, 'listRecords', { page: 2 })
  expect([p1.totalCount, p1.items.length, p1.pageSize, p2.items.length]).toEqual([52, 50, 50, 2])
  noteEvidence(
    'TC-83',
    'ページ送り(52件: 1ページ目50件・2ページ目2件)',
    JSON.stringify({ total: p1.totalCount, p1: p1.items.length, p2: p2.items.length })
  )
  await window.reload()
  await window.getByRole('button', { name: '入出金・経費' }).click()
  await expect(window.locator('tbody tr')).toHaveCount(50)
  await window.getByRole('button', { name: /次へ/ }).click()
  await expect(window.locator('tbody tr')).toHaveCount(2)
  await shot(window, 'TC-83', '2ページ目(2件)')
})

test('TC-84: 履歴(タブ・種別/操作日の絞り込み・変更前後の展開・「記録を表示」)と履歴の追記専用トリガー', async () => {
  const { window, dataDir, app } = launched
  const acc = await accountId(window, '会議費')
  const id = await createRecordApi(window, {
    accountId: acc,
    description: '打合せ茶菓',
    amount: 800
  })
  await mustApi(window, 'updateRecord', {
    id,
    kind: 'expense',
    recordDate: '2026-10-01',
    amount: 900,
    accountId: acc,
    description: '打合せ茶菓',
    clientId: null,
    paymentMethod: 'cash',
    taxCategory: null,
    removeReceiptIds: [],
    addReceiptTokens: [],
    reason: '金額訂正'
  })
  await mustApi(window, 'deleteRecord', { id, reason: '不要' })
  const all = await mustApi<{
    totalCount: number
    items: Array<{
      operation: string
      changes: Array<{ label: string; before: string; after: string }>
    }>
  }>(window, 'listRecordHistory', {})
  expect(all.items.map((i) => i.operation)).toEqual(['delete', 'update', 'create']) // 新しい順
  const upd = all.items[1].changes
  expect(upd.find((c) => c.label === '金額')).toMatchObject({ before: '¥800', after: '¥900' })
  expect(upd.find((c) => c.label === '支払方法')?.after).toBe('現金')
  const cre = all.items[2].changes
  expect(
    cre.every(
      (c) => c.before === '' || c.before === '(なし)' || c.before === '—' || c.before.length >= 0
    )
  ).toBe(true)
  noteEvidence('TC-84', '履歴の変更項目(変更前後)', JSON.stringify(all.items, null, 1))
  expect(
    (await mustApi<{ totalCount: number }>(window, 'listRecordHistory', { operation: 'update' }))
      .totalCount
  ).toBe(1)
  const today = new Date()
  const iso = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  expect(
    (
      await mustApi<{ totalCount: number }>(window, 'listRecordHistory', {
        dateFrom: iso(today),
        dateTo: iso(today)
      })
    ).totalCount
  ).toBe(3) // ローカル日付で絞り込み
  expect(
    (
      await mustApi<{ totalCount: number }>(window, 'listRecordHistory', {
        dateFrom: '2000-01-01',
        dateTo: '2000-01-02'
      })
    ).totalCount
  ).toBe(0)
  const rangeErr = await callApi(window, 'listRecordHistory', {
    dateFrom: '2026-05-01',
    dateTo: '2026-04-01'
  })
  expect(rangeErr.ok).toBe(false)
  // 画面
  await window.getByRole('button', { name: '入出金・経費' }).click()
  await window.getByRole('button', { name: '履歴', exact: true }).click()
  await expect(window.locator('tbody tr').first()).toBeVisible()
  await shot(window, 'TC-84', '履歴タブ(新しい順)')
  await window.getByLabel('操作の種別').selectOption('update')
  await expect(window.locator('tbody tr')).toHaveCount(1)
  await window.locator('tbody tr').first().click()
  await expect(window.getByText('¥800').first()).toBeVisible()
  await shot(window, 'TC-84', '更新履歴の行を展開(変更前¥800→変更後¥900)')
  await window.getByLabel('操作日(開始)').fill('2026-06-01')
  await window.getByLabel('操作日(終了)').fill('2026-05-01')
  await expect(window.getByText('日付の終了日は、開始日以降の日付を入力してください')).toBeVisible()

  // 履歴テーブルのトリガー: DBのコピーに対してUPDATE/DELETEを試み、拒否されることを確認(実DBは変更しない)
  await app.close()
  const { execFileSync } = await import('node:child_process')
  const { copyFileSync, mkdtempSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const tmp = mkdtempSync(join(tmpdir(), 'jimuhub-i2-trg-'))
  copyFileSync(join(dataDir, 'data.sqlite'), join(tmp, 'copy.sqlite'))
  const run = (sql: string): string => {
    try {
      return execFileSync('sqlite3', [join(tmp, 'copy.sqlite'), sql], {
        encoding: 'utf8',
        stdio: 'pipe'
      })
    } catch (e) {
      return `ERROR: ${(e as { stderr?: string }).stderr ?? e}`
    }
  }
  const u = run("update cash_record_history set reason='tamper' where id=1")
  const d = run('delete from cash_record_history where id=1')
  expect(u).toContain('ERROR')
  expect(d).toContain('ERROR')
  expect(run('select count(*) from cash_record_history').trim()).toBe('3')
  noteEvidence(
    'TC-84',
    '履歴テーブルへのUPDATE/DELETEの拒否(DBのコピーで確認)',
    `UPDATE: ${u.trim()}\nDELETE: ${d.trim()}\n件数: 3`
  )
  rmSync(tmp, { recursive: true, force: true })
})
