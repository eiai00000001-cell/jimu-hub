import { test, expect } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/electron-app'
import { noteEvidence, shot } from './evidence-dir'
import { createClientApi, dbQuery, listFilesRecursive, setupCompany } from './helpers'
import { dumpAll, mustApi } from './helpers-i2'
import { answerNextConfirm, createProjectApi, getProjectApi } from './helpers-i3'

/**
 * 【tester作成】イテレーション3の受入条件単位の通しシナリオ(TC-123)と、案件画面の画面遷移・レイアウト整合(TC-124)。
 * 通し: 案件登録→見積書・請求書・入出金・経費の紐づけ→案件別収支→バックアップ→別のデータ保存先へ復元→一致確認。
 * 参照元: 詳細設計書 3.0章・3.22〜3.26章・4.27〜4.33章
 */
let launched: LaunchedApp | undefined
test.afterEach(async () => {
  if (launched) await closeApp(launched)
  launched = undefined
})

function dumpI3(dataDir: string): string {
  return [
    dumpAll(dataDir, dbQuery),
    dbQuery(dataDir, 'select * from projects order by id'),
    dbQuery(dataDir, 'select * from project_link_history order by id')
  ].join('\n--\n')
}

test('TC-123: [通しシナリオ] 案件登録→見積書(案件指定)→請求書変換→PDF保存→入金済み→入金記録の紐づけ→経費(案件指定)→案件別収支→エクスポート→別データへ復元→案件・紐づけ・収支・履歴の一致', async () => {
  test.setTimeout(180_000)
  const work = mkdtempSync(join(tmpdir(), 'jimuhub-i3-int-'))
  const zip = join(work, 'journey.zip')
  const src = await launchApp({ JIMUHUB_E2E_EXPORT_PATH: zip })
  launched = src
  const { window, dataDir } = src
  await setupCompany(window)
  await createClientApi(window, '通し確認商事株式会社', { furigana: 'トオシカクニンショウジ' })

  // 1) 案件を登録(画面)
  await window.getByRole('button', { name: '案件管理' }).click()
  await window.getByRole('button', { name: '+ 案件を登録' }).click()
  await window.getByLabel('案件名').fill('コーポレートサイト制作')
  await window.getByLabel('取引先').selectOption({ label: '通し確認商事株式会社' })
  await window.getByLabel('開始日').fill('2026-10-01')
  await window.getByLabel('終了日').fill('2026-12-28')
  await window.getByRole('button', { name: '登録', exact: true }).click()
  await expect(window.getByText('案件を保存しました')).toBeVisible()
  await shot(window, 'TC-123', '1) 案件を登録した直後の案件詳細(収支はすべて0円)')

  // 2) 見積書を、案件を指定してPDF保存(画面)
  await window.getByRole('button', { name: '見積書・請求書' }).click()
  await window.getByRole('button', { name: /見積書を新規作成/ }).click()
  await window
    .getByLabel('取引先')
    .selectOption({ label: '通し確認商事株式会社 御中' })
    .catch(async () => {
      await window.getByLabel('取引先').selectOption({ index: 1 })
    })
  await window.getByLabel('発行日').fill('2026-10-02')
  await window.getByLabel('品名1').fill('デザイン・コーディング')
  await window.getByLabel('数量1').fill('1')
  await window.getByLabel('単価1').fill('300000')
  await expect(window.getByLabel('案件').locator('option')).toHaveCount(2)
  await window.getByLabel('案件').selectOption({ label: 'コーポレートサイト制作' })
  await shot(window, 'TC-123', '2) 見積書作成画面で「案件」に案件を選択')
  await window.getByRole('button', { name: 'PDFとして保存' }).click()
  await expect(window.getByText('PDFとして保存しました')).toBeVisible()
  await expect(window.getByRole('button', { name: 'コーポレートサイト制作' })).toBeVisible() // 詳細の案件欄

  // 3) 請求書へ変換(案件が引き継がれる)→PDF保存→入金済み
  await window.getByRole('button', { name: '請求書に変換' }).click()
  await expect(window.getByRole('button', { name: 'コーポレートサイト制作' })).toBeVisible()
  await window.getByRole('button', { name: '編集' }).click()
  await expect(window.getByLabel('案件').locator('option:checked')).toHaveText(
    'コーポレートサイト制作'
  )
  await window.getByLabel('発行日').fill('2026-10-05')
  await window.getByLabel('支払期限').fill('2026-11-30')
  await window.getByRole('button', { name: 'PDFとして保存' }).click()
  await expect(window.getByText('PDFとして保存しました')).toBeVisible()
  await window.getByRole('button', { name: '入金済みにする' }).click()
  await window.getByLabel('入金日').fill('2026-10-20')
  await window.getByRole('button', { name: '確定' }).click()
  await expect(window.getByText('入金済みにしました')).toBeVisible()
  await shot(window, 'TC-123', '3) 請求書をPDF保存し入金済みにした詳細(案件欄・紐づく入金記録)')

  // 4) 自動作成された入金記録を、画面で同じ案件へ紐づける(入金記録は案件を引き継がない)
  await window.getByRole('button', { name: '入出金・経費' }).click()
  await window.getByRole('cell', { name: /請求書 .* の入金/ }).click()
  await expect(window.getByText('案件なし').first()).toBeVisible()
  await window.getByRole('button', { name: '案件を変更' }).click()
  await window.getByLabel('変更先の案件').selectOption({ label: 'コーポレートサイト制作' })
  await window.getByRole('button', { name: '変更する' }).click()
  await expect(window.getByRole('button', { name: 'コーポレートサイト制作' })).toBeVisible()

  // 5) 経費を、案件を指定して登録(画面)
  await window.getByRole('button', { name: '入出金・経費' }).click()
  await window.getByRole('button', { name: '+ 経費を登録' }).click()
  await window.getByLabel(/金額/).fill('44000')
  await window.getByLabel(/勘定科目/).selectOption({ label: '外注費' })
  await window.getByLabel(/摘要・メモ/).fill('外注の撮影費')
  await window.getByLabel('税区分').selectOption('standard_10')
  await window.getByLabel('案件').selectOption({ label: 'コーポレートサイト制作' })
  await window.getByRole('button', { name: '登録', exact: true }).click()
  await expect(window.getByText('記録を登録しました')).toBeVisible()

  // 6) 案件別収支
  await window.getByRole('button', { name: '案件管理' }).click()
  await window.getByRole('cell', { name: 'コーポレートサイト制作' }).click()
  const cards = window.locator('.summary-card .value')
  await expect(cards.nth(0)).toHaveText('¥330,000') // 請求書の合計金額(税込・源泉徴収前)。入金額ではない
  await expect(cards.nth(1)).toHaveText('¥44,000')
  await expect(cards.nth(2)).toHaveText('¥286,000')
  await expect(window.getByText('紐づく見積書・請求書')).toBeVisible()
  await expect(window.getByText('紐づく入出金・経費')).toBeVisible()
  await shot(
    window,
    'TC-123',
    '6) 案件別収支(売上330,000円・経費44,000円・差引286,000円)・紐づく書類と記録・付け替え履歴'
  )
  const id = Number(dbQuery(dataDir, "select id from projects where name='コーポレートサイト制作'"))
  const detail = await getProjectApi(window, id)
  expect(detail.summary).toMatchObject({ sales: 330000, expense: 44000, balance: 286000 })
  expect(detail.summary.counts).toEqual({
    quotes: 1,
    invoicesIssued: 1,
    invoicesDraft: 0,
    incomes: 1,
    expenses: 1
  })
  expect(detail.history.map((h) => h.kind).sort()).toEqual(['assign', 'assign', 'assign', 'assign'])
  const sourceDump = dumpI3(dataDir)

  // 7) エクスポート(画面)
  await window.getByRole('button', { name: 'ホーム' }).click()
  await window.getByRole('button', { name: 'データをエクスポート' }).click()
  await window.getByRole('button', { name: 'エクスポート実行' }).click()
  await expect(window.getByText(/保存しました/)).toBeVisible()
  await window.getByLabel('閉じる').click()
  await closeApp(src)
  launched = undefined

  // 8) 別の(空の)データ保存先へ復元し、案件・紐づけ・収支・履歴が一致する
  const dst = await launchApp({ JIMUHUB_E2E_IMPORT_PATH: zip })
  launched = dst
  const w2 = dst.window
  await w2.getByRole('button', { name: 'データを復元' }).click()
  await w2.getByRole('button', { name: 'ファイルを選択して復元' }).click()
  await w2.getByRole('button', { name: '続行' }).click()
  await expect(w2.locator('.modal .message-success')).toContainText('復元が完了しました')
  await expect(w2.locator('.modal .message-success')).not.toContainText('案件への紐づけ')
  await w2.getByLabel('閉じる').click()
  expect(dumpI3(dst.dataDir)).toBe(sourceDump)
  await w2.getByRole('button', { name: '案件管理' }).click()
  await w2.getByRole('cell', { name: 'コーポレートサイト制作' }).click()
  const cards2 = w2.locator('.summary-card .value')
  await expect(cards2.nth(0)).toHaveText('¥330,000')
  await expect(cards2.nth(1)).toHaveText('¥44,000')
  await expect(cards2.nth(2)).toHaveText('¥286,000')
  await shot(w2, 'TC-123', '8) 別のデータ保存先へ復元した後の案件詳細(収支・紐づき・履歴が一致)')
  expect(listFilesRecursive(join(dst.dataDir, 'documents')).length).toBe(2) // 見積書・請求書のPDF
  // 復元後の見積書・請求書・入金記録の詳細にも案件が表示される
  await w2.getByRole('button', { name: '入出金・経費' }).click()
  await w2.getByRole('cell', { name: /外注の撮影費/ }).click()
  await expect(w2.getByRole('button', { name: 'コーポレートサイト制作' })).toBeVisible()
  // 復元後に、案件の完了→候補から外れる→再開
  const done = answerNextConfirm(w2, true)
  await mustApi(w2, 'completeProject', id)
  void done
  const selectable = await mustApi<Array<{ id: number }>>(w2, 'listSelectableProjects')
  expect(selectable.map((x) => x.id)).not.toContain(id)
  await mustApi(w2, 'reopenProject', id)
  noteEvidence(
    'TC-123',
    '通しシナリオの照合結果',
    `案件別収支: 売上330000(請求書の合計金額・税込・源泉徴収前)・経費44000・差引286000、件数内訳=${JSON.stringify(detail.summary.counts)}\n付け替え履歴=${detail.history.length}件(assign)\n復元先のダンプ(案件・付け替え履歴・全テーブル)は元のデータと一致(${sourceDump.split('\n').length}行)`
  )
})

test('TC-124: [画面遷移] 案件の画面のタイトルバー・サイドバー・離脱確認・準備中メニュー・一覧と詳細の行き来・レイアウトの一貫性', async () => {
  launched = await launchApp()
  const { window } = launched
  await setupCompany(window)
  const client = await createClientApi(window, 'レイアウト確認商事')
  const pid = await createProjectApi(window, {
    name: 'レイアウト確認の案件',
    clientId: client,
    startDate: '2026-10-01',
    endDate: '2026-10-31',
    memo: 'メモ'
  })
  const log: string[] = []
  const check = async (label: string, title: string, active: string): Promise<void> => {
    await expect(window.locator('.titlebar-title')).toHaveText(title)
    await expect(window.locator('.sidebar-item.active')).toHaveText(active)
    log.push(`${label}: タイトルバー「${title}」、サイドバーの選択「${active}」`)
  }
  await window.getByRole('button', { name: '案件管理' }).click()
  await check('案件一覧', '事務HUB - 案件一覧', '案件管理')
  await shot(window, 'TC-124', '案件一覧画面')
  await window.getByRole('cell', { name: 'レイアウト確認の案件' }).click()
  await check('案件詳細', '事務HUB - 案件詳細', '案件管理')
  await shot(window, 'TC-124', '案件詳細画面')
  await window.getByRole('button', { name: '編集' }).click()
  await check('案件編集', '事務HUB - 案件を編集', '案件管理')
  await shot(window, 'TC-124', '案件編集画面')
  // 離脱確認: 入力画面でサイドバーを押すと確認が出る(入力内容の有無にかかわらず)。「いいえ」で留まる
  const stay = answerNextConfirm(window, false)
  await window.getByRole('button', { name: '取引先管理' }).click()
  expect(await stay).toBe('入力中の内容は保存されません。この画面を離れてよろしいですか')
  await check('離脱確認で「いいえ」', '事務HUB - 案件を編集', '案件管理')
  const leave = answerNextConfirm(window, true)
  await window.getByRole('button', { name: '取引先管理' }).click()
  await leave
  await check('離脱確認で「はい」', '事務HUB - 取引先一覧', '取引先管理')
  // 準備中のメニューは案内のみで遷移しない
  await window.getByRole('button', { name: 'タスク・期限' }).click()
  await expect(
    window.getByText('「タスク・期限」は以降のイテレーションで実装予定です。')
  ).toBeVisible()
  await check('準備中メニュー', '事務HUB - 取引先一覧', '取引先管理')
  // 見積書・請求書の詳細→案件詳細のリンク→戻る
  const q = await mustApi<{ id: number; quoteNumber: string }>(window, 'finalizeQuote', {
    clientId: client,
    issueDate: '2026-10-02',
    validUntil: '',
    remarks: '',
    lineItems: [{ name: '設計', quantity: 1, unit: '式', unitPrice: 1000, taxRate: 10 }],
    projectId: pid
  })
  await window.getByRole('button', { name: '見積書・請求書' }).click()
  await window.getByRole('cell', { name: q.quoteNumber }).click()
  await check('見積書詳細', '事務HUB - 見積書詳細', '見積書・請求書')
  await window.getByRole('button', { name: 'レイアウト確認の案件' }).click()
  await check('見積書詳細の案件リンクから案件詳細', '事務HUB - 案件詳細', '案件管理')
  await shot(window, 'TC-124', '見積書詳細の案件リンクから開いた案件詳細(紐づく見積書が表示される)')
  await window.getByRole('cell', { name: q.quoteNumber }).click()
  await check('案件詳細の紐づく見積書から見積書詳細', '事務HUB - 見積書詳細', '見積書・請求書')
  // 案件の登録画面でも離脱確認(入力内容の有無にかかわらず)
  await window.getByRole('button', { name: '案件管理' }).click()
  await window.getByRole('button', { name: '+ 案件を登録' }).click()
  await check('案件登録', '事務HUB - 案件を登録', '案件管理')
  const stay2 = answerNextConfirm(window, false)
  await window.getByRole('button', { name: 'ホーム' }).click()
  await stay2
  await check('登録画面の離脱確認で「いいえ」', '事務HUB - 案件を登録', '案件管理')
  await window.getByRole('button', { name: 'キャンセル' }).click()
  await check('キャンセルで一覧へ戻る', '事務HUB - 案件一覧', '案件管理')
  noteEvidence('TC-124', '画面遷移の確認結果', log.join('\n'))
})
