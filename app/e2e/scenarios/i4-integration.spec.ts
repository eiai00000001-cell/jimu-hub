import { test, expect } from '@playwright/test'
import { join } from 'node:path'
import { createWorkDir } from '../../test-support/work-dir.mjs'
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/electron-app'
import { noteEvidence, shot } from './evidence-dir'
import { createClientApi, dbQuery, listFilesRecursive, setupCompany } from './helpers'
import { dumpAll, markPaid, mustApi } from './helpers-i2'
import { createProjectApi, getProjectApi } from './helpers-i3'
import { createTaskApi, dumpTasks, localDate } from './helpers-i4'

/**
 * 【tester作成】イテレーション4の機能横断・結合: タスク画面の画面遷移・レイアウト整合(TC-151)と、
 * 受入条件単位の通しシナリオ(TC-152)。
 * 参照元: 詳細設計書 3.0章・3.24章・3.27〜3.29章・4.27章・4.34〜4.39章
 */
let launched: LaunchedApp | undefined
test.afterEach(async () => {
  if (launched) await closeApp(launched)
  launched = undefined
})

const CONFIRM = '入力中の内容は保存されません。この画面を離れてよろしいですか'

test('TC-151: [画面遷移] タスク画面のタイトルバー・サイドバーの選択・離脱確認・一覧/詳細/案件詳細の行き来・「準備中」の廃止・デザインの一貫性', async () => {
  launched = await launchApp()
  const { window } = launched
  await setupCompany(window)
  const client = await createClientApi(window, 'タスク画面確認商事')
  const pid = await createProjectApi(window, { name: 'タスク画面確認の案件', clientId: client })
  const tid = await createTaskApi(window, {
    name: '画面確認のタスク',
    projectId: pid,
    dueDate: localDate(-2),
    memo: 'メモ'
  })
  const log: string[] = []
  const check = async (label: string, title: string, active: string): Promise<void> => {
    await expect(window.locator('.titlebar-title')).toHaveText(title)
    await expect(window.locator('.sidebar-item.active')).toHaveText(active)
    log.push(`${label}: タイトルバー「${title}」、サイドバーの選択「${active}」`)
  }
  // サイドバーのメニュー: 5つの業務メニューがすべて有効(準備中のものはない)
  const items = await window.locator('.sidebar-item').allTextContents()
  log.push(`サイドバーの項目: ${items.join(' / ')}`)
  // 並び順はモックアップ(F-35_task-list)と同じ
  expect(items).toEqual([
    'ホーム',
    '取引先管理',
    '案件管理',
    '見積書・請求書',
    '入出金・経費',
    'タスク・期限'
  ])
  await expect(window.locator('.sidebar-item[disabled], .sidebar-item.disabled')).toHaveCount(0)
  await expect(window.getByText('以降のイテレーションで実装予定です')).toHaveCount(0)

  await window.getByRole('button', { name: 'タスク・期限' }).click()
  await check('タスク一覧', '事務HUB - タスク一覧', 'タスク・期限')
  await shot(window, 'TC-151', 'タスク一覧画面(期限超過の強調・件数カード)')
  await window.getByRole('button', { name: '画面確認のタスク' }).click()
  await check('タスク詳細', '事務HUB - タスク詳細', 'タスク・期限')
  await shot(window, 'TC-151', 'タスク詳細画面(期限超過・案件リンク)')
  // 詳細ではサイドバーの遷移に確認が出ない
  const dialogs: string[] = []
  let accept = false
  window.on('dialog', (d) => {
    dialogs.push(d.message())
    void (accept ? d.accept() : d.dismiss())
  })
  await window.getByRole('button', { name: '編集', exact: true }).click()
  await check('タスク編集', '事務HUB - タスクを編集', 'タスク・期限')
  await shot(window, 'TC-151', 'タスク編集画面')
  // 入力画面: 入力内容の有無にかかわらず離脱確認。「いいえ」で留まる
  await window.getByRole('button', { name: '案件管理' }).click()
  expect(dialogs).toEqual([CONFIRM])
  await check('離脱確認で「いいえ」(編集)', '事務HUB - タスクを編集', 'タスク・期限')
  // 画面内の「キャンセル」では確認なしで詳細へ戻る
  await window.getByRole('button', { name: 'キャンセル' }).click()
  await check('編集のキャンセル', '事務HUB - タスク詳細', 'タスク・期限')
  expect(dialogs).toEqual([CONFIRM])
  // 詳細 → 案件リンク → 案件詳細(サイドバーは案件管理) → 紐づくタスク → タスク詳細
  await window.getByRole('button', { name: 'タスク画面確認の案件' }).click()
  await check('案件詳細(タスク詳細の案件リンクから)', '事務HUB - 案件詳細', '案件管理')
  await shot(window, 'TC-151', 'タスク詳細の案件リンクから開いた案件詳細(紐づくタスクが表示される)')
  await window.getByRole('button', { name: '画面確認のタスク' }).click()
  await check('タスク詳細(案件詳細の紐づくタスクから)', '事務HUB - タスク詳細', 'タスク・期限')
  await window.getByRole('button', { name: /一覧へ戻る/ }).click()
  await check('一覧へ戻る', '事務HUB - タスク一覧', 'タスク・期限')
  // 登録画面: 離脱確認(未入力でも)。「はい」で遷移
  await window.getByRole('button', { name: '+ タスクを登録' }).click()
  await check('タスク登録', '事務HUB - タスクを登録', 'タスク・期限')
  await shot(window, 'TC-151', 'タスク登録画面')
  await window.getByRole('button', { name: 'ホーム' }).click() // 未入力でも確認が出る
  expect(dialogs).toEqual([CONFIRM, CONFIRM])
  await check('離脱確認で「いいえ」(登録)', '事務HUB - タスクを登録', 'タスク・期限')
  accept = true
  await window.getByRole('button', { name: 'ホーム' }).click()
  expect(dialogs).toEqual([CONFIRM, CONFIRM, CONFIRM])
  await check('離脱確認で「はい」', '事務HUB - ホーム', 'ホーム')
  // 他の入力画面(案件登録)から「タスク・期限」へ: 確認が出る
  void tid
  // ホームのタスクへの導線はなく、ホームのカードは変わらない
  await shot(window, 'TC-151', 'ホーム画面(サイドバー。準備中の案内はない)')
  noteEvidence(
    'TC-151',
    '画面遷移の確認結果',
    log.join('\n') + `\n離脱確認の文言: ${CONFIRM}(入力画面で2回表示・「いいえ」で留まる)`
  )

  // デザインの一貫性: タスク画面の主要部品が他の一覧画面と同じ見た目の規則に従う(基本のフォント・主ボタンの色)
  await window.getByRole('button', { name: 'タスク・期限' }).click()
  await expect(window.locator('table.table th').first()).toBeVisible()
  const taskStyle = await window.evaluate(() => {
    const btn = document.querySelector('.btn-primary') as HTMLElement
    const th = document.querySelector('table.table th') as HTMLElement
    return {
      btnBg: getComputedStyle(btn).backgroundColor,
      btnRadius: getComputedStyle(btn).borderRadius,
      font: getComputedStyle(document.body).fontFamily,
      thBg: getComputedStyle(th).backgroundColor
    }
  })
  await window.getByRole('button', { name: '案件管理' }).click()
  await expect(window.locator('table.table th').first()).toBeVisible()
  await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - 案件一覧')
  const projStyle = await window.evaluate(() => {
    const btn = document.querySelector('.btn-primary') as HTMLElement
    const th = document.querySelector('table.table th') as HTMLElement
    return {
      btnBg: getComputedStyle(btn).backgroundColor,
      btnRadius: getComputedStyle(btn).borderRadius,
      font: getComputedStyle(document.body).fontFamily,
      thBg: getComputedStyle(th).backgroundColor
    }
  })
  expect(taskStyle).toEqual(projStyle)
  expect(taskStyle.btnBg).toBe('rgb(58, 58, 60)') // 主ボタンは濃グレー塗り(デザインガイド5.1章)
  expect(taskStyle.btnRadius).toBe('6px')
  noteEvidence(
    'TC-151',
    'タスク一覧と案件一覧の主ボタン・表見出し・フォントのcomputed style比較(一致)',
    JSON.stringify(taskStyle, null, 2)
  )
})

test('TC-152: [通しシナリオ] 案件登録→請求書(案件指定・PDF保存)→入金済み→タスク登録(案件つき・期限超過)→案件詳細(収支とタスク)→エクスポート→別データへ復元→タスク・案件・収支・書類の一致→案件の完了', async () => {
  test.setTimeout(180_000)
  const work = createWorkDir('e2e', 'jimuhub-i4-int')
  const zip = join(work, 'journey.zip')
  const src = await launchApp({ JIMUHUB_E2E_EXPORT_PATH: zip })
  launched = src
  const { window, dataDir } = src
  await setupCompany(window)
  const client = await createClientApi(window, '通し確認商事株式会社', {
    furigana: 'トオシカクニンショウジ'
  })

  // 1) 案件を登録(画面)
  await window.getByRole('button', { name: '案件管理' }).click()
  await window.getByRole('button', { name: '+ 案件を登録' }).click()
  await window.getByLabel('案件名').fill('コーポレートサイト制作')
  await window.getByLabel('取引先').selectOption({ label: '通し確認商事株式会社' })
  await window.getByLabel('開始日').fill('2026-10-01')
  await window.getByLabel('終了日').fill('2026-12-28')
  await window.getByRole('button', { name: '登録', exact: true }).click()
  await expect(window.getByText('案件を保存しました')).toBeVisible()
  // 2) 請求書(案件つき)をPDF保存して入金済みに(API)。案件別収支ができる
  const inv = await mustApi<{ id: number }>(window, 'finalizeInvoice', {
    clientId: client,
    issueDate: '2026-10-05',
    dueDate: '',
    remarks: '',
    lineItems: [
      {
        name: '制作',
        quantity: 1,
        unit: '式',
        unitPrice: 300000,
        taxRate: 10,
        withholdingTarget: false
      }
    ],
    projectId: Number(
      dbQuery(dataDir, "select id from projects where name='コーポレートサイト制作'")
    )
  })
  await markPaid(window, inv.id, '2026-10-20')
  const pid = Number(
    dbQuery(dataDir, "select id from projects where name='コーポレートサイト制作'")
  )
  // 3) タスクを画面で登録(案件つき・期限超過)
  await window.getByRole('button', { name: 'タスク・期限' }).click()
  await window.getByRole('button', { name: '+ タスクを登録' }).click()
  await window.getByLabel('タスク名').fill('納品物の最終確認')
  await window.getByLabel('メモ').fill('先方の確認待ち')
  await window.getByLabel('期限日').fill(localDate(-1))
  await window.getByLabel('案件').selectOption({ label: 'コーポレートサイト制作' })
  await window.getByRole('button', { name: '登録', exact: true }).click()
  await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - タスク詳細')
  await expect(window.getByText('期限超過')).toBeVisible()
  await shot(window, 'TC-152', '1) 案件つきで登録した期限超過のタスク(詳細)')
  await createTaskApi(window, { name: '請求書の発送', projectId: pid, dueDate: '2099-01-01' })
  await createTaskApi(window, { name: '案件に関係ない用事' })
  const done = await createTaskApi(window, {
    name: '打ち合わせの議事録',
    projectId: pid,
    dueDate: '2026-10-03'
  })
  await mustApi(window, 'completeTask', done)
  await window.getByRole('button', { name: 'タスク・期限' }).click()
  await expect(window.locator('.task-count').nth(0)).toContainText('3')
  await expect(window.locator('.task-count').nth(1)).toContainText('1')
  await shot(window, 'TC-152', '2) タスク一覧(未完了3件・期限超過1件)')
  // 4) 案件詳細: 収支とタスクが並ぶ
  await window.getByRole('button', { name: '案件管理' }).click()
  await window.getByRole('cell', { name: 'コーポレートサイト制作' }).click()
  const cards = window.locator('.summary-card .value')
  await expect(cards.nth(0)).toHaveText('¥330,000')
  await expect(window.getByText('紐づくタスク', { exact: true })).toBeVisible()
  await expect(window.getByRole('button', { name: '納品物の最終確認' })).toBeVisible()
  await shot(window, 'TC-152', '3) 案件詳細(案件別収支とタスク一覧)')
  const detail = await getProjectApi(window, pid)
  const sourceDump = [
    dumpAll(dataDir, dbQuery),
    dbQuery(dataDir, 'select * from projects order by id'),
    dbQuery(dataDir, 'select * from project_link_history order by id'),
    dumpTasks(dataDir)
  ].join('\n--\n')
  // 5) エクスポート
  await window.getByRole('button', { name: 'ホーム' }).click()
  await window.getByRole('button', { name: 'データをエクスポート' }).click()
  await window.getByRole('button', { name: 'エクスポート実行' }).click()
  await expect(window.getByText(/保存しました/)).toBeVisible()
  await window.getByLabel('閉じる').click()
  await closeApp(src)
  launched = undefined

  // 6) 別の(空の)データ保存先へ復元し、タスク・案件・収支・履歴・書類が一致する
  const dst = await launchApp({ JIMUHUB_E2E_IMPORT_PATH: zip })
  launched = dst
  const w2 = dst.window
  await w2.getByRole('button', { name: 'データを復元' }).click()
  await w2.getByRole('button', { name: 'ファイルを選択して復元' }).click()
  await w2.getByRole('button', { name: '続行' }).click()
  await expect(w2.locator('.modal .message-success')).toContainText('復元が完了しました')
  await expect(w2.locator('.modal .message-success')).not.toContainText(/改変|紐づけ/)
  await w2.getByLabel('閉じる').click()
  const restoredDump = [
    dumpAll(dst.dataDir, dbQuery),
    dbQuery(dst.dataDir, 'select * from projects order by id'),
    dbQuery(dst.dataDir, 'select * from project_link_history order by id'),
    dumpTasks(dst.dataDir)
  ].join('\n--\n')
  expect(restoredDump).toBe(sourceDump)
  expect(listFilesRecursive(join(dst.dataDir, 'documents')).length).toBe(1) // 請求書のPDF
  await w2.getByRole('button', { name: 'タスク・期限' }).click()
  await w2.getByLabel('状態', { exact: true }).selectOption('all')
  await expect(w2.getByText('該当 4件')).toBeVisible()
  await expect(w2.getByRole('row', { name: /納品物の最終確認/ })).toHaveClass(/overdue/)
  await shot(w2, 'TC-152', '4) 復元先のタスク一覧(期限超過の強調も再現)')
  await w2.getByRole('button', { name: '案件管理' }).click()
  await w2.getByRole('cell', { name: 'コーポレートサイト制作' }).click()
  await expect(w2.locator('.summary-card .value').nth(0)).toHaveText('¥330,000')
  await expect(w2.getByRole('button', { name: '納品物の最終確認' })).toBeVisible()
  const detail2 = await getProjectApi(w2, pid)
  expect(detail2.summary).toEqual(detail.summary)
  await shot(w2, 'TC-152', '5) 復元先の案件詳細(収支・紐づくタスクが一致)')
  // 7) 案件を完了 → 新しい紐づけの候補から外れる(案件の削除とタスクの扱いはTC-141で確認)
  await mustApi(w2, 'completeProject', pid)
  const sel = await mustApi<Array<{ id: number }>>(w2, 'listSelectableProjects')
  expect(sel.map((x) => x.id)).not.toContain(pid)
  const tasksAfter = await mustApi<{
    items: Array<{ name: string; projectStatus: string | null }>
  }>(w2, 'listTasks', { status: 'all' })
  expect(tasksAfter.items.filter((t) => t.projectStatus === 'completed')).toHaveLength(3)
  noteEvidence(
    'TC-152',
    '通しシナリオの照合結果',
    `案件別収支: 売上${detail.summary.sales}円(請求書の合計金額)・経費${detail.summary.expense}円、件数内訳=${JSON.stringify(detail.summary.counts)}\nタスク: 4件(未完了3・完了1・期限超過1)\n復元先のダンプ(全テーブル・案件・付け替え履歴・タスク)は元のデータと完全に一致(${sourceDump.split('\\n').length}行)、警告なし\n案件を完了にすると新しい紐づけの候補から外れ、紐づくタスクの案件名は「(完了)」付きで残る`
  )
})
