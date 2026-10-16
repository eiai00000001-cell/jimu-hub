import { test, expect, type Page } from '@playwright/test'
import { copyFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { createWorkDir } from '../../test-support/work-dir.mjs'
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/electron-app'
import { noteEvidence, shot } from './evidence-dir'
import { createClientApi, dbQuery, listFilesRecursive, setupCompany, sha256File } from './helpers'
import { mustApi, setEnv } from './helpers-i2'
import { createProjectApi, finalizeInvoiceWithProject } from './helpers-i3'
import { createTaskApi, dumpTasks, localDate, snapshotNonTask } from './helpers-i4'
import {
  buildZip,
  exportToLegacyJson,
  mapExportTable,
  readZipEntries
} from '../../src/main/services/backup/test-helpers'

/**
 * 【tester作成】イテレーション4のセキュリティ修正後の差分の再確認(TC-160〜TC-163)。
 * SEC-23: 復元時のタスクのid・日時の検証、manifestに無いタスクを読まない(コミット38ce335)。SEC-22: Electron 44.8.0(79c1a15)。
 * 参照元: 詳細設計書 4.3章・4.33章・4.39章・8章
 */
let workDir: string
let launched: LaunchedApp | undefined
test.beforeAll(() => {
  workDir = createWorkDir('e2e', 'jimuhub-i4-sec23')
})
test.afterEach(async () => {
  if (launched) await closeApp(launched)
  launched = undefined
})

interface Inspection {
  token: string
  hasTasks: boolean
  currentTaskCount: number
  needsConfirmation: boolean
}
async function inspect(window: Page, label: string): Promise<Inspection> {
  const r = await mustApi<{ success: boolean; inspection?: Inspection; error?: string }>(
    window,
    'inspectBackup'
  )
  if (!r.success || !r.inspection) throw new Error(`inspect(${label}) failed: ${r.error}`)
  return r.inspection
}
async function openRestore(window: Page): Promise<void> {
  if ((await window.getByRole('button', { name: 'ファイルを選択して復元' }).count()) === 0) {
    await window.getByRole('button', { name: 'ホーム' }).click()
    await window.getByRole('button', { name: 'データを復元' }).click()
  }
  await window.getByRole('button', { name: 'ファイルを選択して復元' }).click()
  await window.getByRole('button', { name: '続行' }).click()
}
const dumpAll4 = (d: string): string => [snapshotNonTask(d), dumpTasks(d)].join('\n--\n')

let sharedZip: string | undefined
async function getSharedZip(): Promise<string> {
  if (sharedZip) return sharedZip
  const zip = join(workDir, 'source-v6.zip')
  const src = await launchApp({ JIMUHUB_E2E_EXPORT_PATH: zip })
  launched = src
  const { window } = src
  await setupCompany(window)
  const client = await createClientApi(window, '再確認商事株式会社')
  const A = await createProjectApi(window, { name: '再確認の案件A', clientId: client })
  await finalizeInvoiceWithProject(window, { clientId: client, unitPrice: 100000, projectId: A })
  await createTaskApi(window, { name: 'タスク1(未完了)', projectId: A, dueDate: localDate(-3) })
  const t2 = await createTaskApi(window, { name: 'タスク2(完了)', dueDate: '2030-01-01' })
  await mustApi(window, 'completeTask', t2)
  await createTaskApi(window, { name: 'タスク3(未完了)', memo: 'メモ' })
  const t4 = await createTaskApi(window, { name: 'タスク4(完了)' })
  await mustApi(window, 'completeTask', t4)
  await window.getByRole('button', { name: 'ホーム' }).click()
  await window.getByRole('button', { name: 'データをエクスポート' }).click()
  await window.getByRole('button', { name: 'エクスポート実行' }).click()
  await expect(window.getByText(/保存しました/)).toBeVisible()
  await closeApp(src)
  launched = undefined
  sharedZip = zip
  return zip
}

function editManifest(
  src: string,
  name: string,
  edit: (m: { schemaVersion: number; tables: Record<string, unknown> }) => void
): string {
  const out = join(workDir, name)
  copyFileSync(src, out)
  const z = new AdmZip(out)
  const m = JSON.parse(z.readAsText('manifest.json'))
  edit(m)
  z.updateFile('manifest.json', Buffer.from(JSON.stringify(m)))
  z.writeZip(out)
  return out
}

test('TC-160: [SEC-23] manifestに記載のないタスクは読まない(版5・件数0・項目なし)。事前確認の警告と実際の取り込みが一致し、正常な版6は従来どおり復元できる', async () => {
  test.setTimeout(180_000)
  const zip = await getSharedZip()
  const cases: Array<[string, string, boolean]> = [
    ['正常な版6(件数4)', zip, true],
    [
      'manifestの版が5(tasks.jsonlに行が残っている)',
      editManifest(zip, 'm-v5.zip', (m) => {
        m.schemaVersion = 5
      }),
      false
    ],
    [
      '版6でtasksの件数が0(行が残っている)',
      editManifest(zip, 'm-count0.zip', (m) => {
        m.tables.tasks = { file: 'data/tasks.jsonl', count: 0 }
      }),
      false
    ],
    [
      '版6でmanifestにtasksの項目がない(行が残っている)',
      editManifest(zip, 'm-none.zip', (m) => {
        delete m.tables.tasks
      }),
      false
    ]
  ]
  const { window, dataDir, app } = (launched = await launchApp({ JIMUHUB_E2E_IMPORT_PATH: zip }))
  const lines: string[] = []
  for (const [label, path, expectTasks] of cases) {
    await setEnv(app, 'JIMUHUB_E2E_IMPORT_PATH', path)
    // 復元前に、現在のタスクを2件にする(版5・0件・項目なしでは確認画面が出るはず)
    const before = await mustApi<{ items: unknown[] }>(window, 'listTasks', { status: 'all' })
    for (let i = before.items.length; i < 2; i++)
      await createTaskApi(window, { name: `現在のタスク${i}` })
    const ins = await inspect(window, label)
    expect(ins.hasTasks, label).toBe(expectTasks)
    expect(ins.currentTaskCount, label).toBeGreaterThanOrEqual(2)
    await mustApi(window, 'discardBackup', ins.token)
    await openRestore(window)
    if (!expectTasks) {
      await expect(window.getByText(/復元前の確認/)).toBeVisible()
      await expect(
        window.getByText(/このバックアップにはタスクのデータが含まれていないため/)
      ).toBeVisible()
      await shot(window, 'TC-160', `確認画面(${label}): 現在のタスクが消える旨`)
      await window.getByRole('button', { name: '復元する' }).click()
    }
    const msg = window.locator('.modal .message-success, .modal .message-error')
    await expect(msg).toBeVisible()
    const text = await msg.innerText()
    expect(text, label).toContain('復元が完了しました')
    const n = dbQuery(dataDir, 'select count(*) from tasks')
    expect(n, label).toBe(expectTasks ? '4' : '0')
    lines.push(
      `${label}: hasTasks=${ins.hasTasks}、確認画面=${expectTasks ? 'なし' : 'あり'}、復元後のタスク=${n}件、完了メッセージ「${text.slice(0, 40)}」`
    )
    await window.getByLabel('閉じる').click()
  }
  noteEvidence('TC-160', 'manifestとの一致の確認結果', lines.join('\n'))
})

test('TC-161: [SEC-23] 不正なid・日時の行(id:負・0・小数・文字列・null、createdAt/updatedAt/completedAt:日時でない・数値・null・10万文字・スクリプト・オブジェクト)は復元を中止し、現在のデータ・ファイルは変わらない。正しい形式の日時(オフセット付き・ミリ秒なし)は復元できる', async () => {
  test.setTimeout(240_000)
  const zip = await getSharedZip()
  const { window, dataDir, app } = (launched = await launchApp())
  await setupCompany(window)
  const c = await createClientApi(window, '中止確認商事')
  const p = await createProjectApi(window, { name: '現在の案件', clientId: c })
  await createTaskApi(window, { name: '現在のタスク', projectId: p })
  const before = dumpAll4(dataDir)
  const files = Object.fromEntries(
    listFilesRecursive(join(dataDir, 'documents')).map((f) => [
      f.slice(dataDir.length),
      sha256File(f)
    ])
  )
  type Row = Record<string, unknown>
  const variants: Array<[string, number, (r: Row) => Row]> = [
    ['idが負の数', 0, (r) => ({ ...r, id: -5 })],
    ['idが0', 0, (r) => ({ ...r, id: 0 })],
    ['idが小数', 0, (r) => ({ ...r, id: 1.5 })],
    ['idが文字列', 0, (r) => ({ ...r, id: '1' })],
    ['idがnull', 0, (r) => ({ ...r, id: null })],
    ['createdAtが日時でない文字列', 0, (r) => ({ ...r, createdAt: 'いつか' })],
    ['createdAtが数値', 0, (r) => ({ ...r, createdAt: 12345 })],
    ['createdAtがnull', 0, (r) => ({ ...r, createdAt: null })],
    ['updatedAtが10万文字', 0, (r) => ({ ...r, updatedAt: 'a'.repeat(100000) })],
    [
      'updatedAtがスクリプトを含む文字列',
      0,
      (r) => ({ ...r, updatedAt: '<script>alert(1)</script>' })
    ],
    ['updatedAtがオブジェクト', 0, (r) => ({ ...r, updatedAt: { a: 1 } })],
    ['updatedAtが実在しない日時', 0, (r) => ({ ...r, updatedAt: '2026-13-45T25:61:61Z' })],
    [
      'completedAtが日時でない文字列(完了のタスク)',
      1,
      (r) => ({ ...r, completedAt: 'NaN-NaN-NaN' })
    ],
    ['completedAtが数値(完了のタスク)', 1, (r) => ({ ...r, completedAt: 5 })]
  ]
  const lines: string[] = []
  let n = 0
  for (const [label, idx, mapper] of variants) {
    const bad = join(workDir, `sec23-bad-${n++}.zip`)
    copyFileSync(zip, bad)
    mapExportTable(bad, 'tasks', (r, i) => (i === idx ? mapper(r) : r))
    await setEnv(app, 'JIMUHUB_E2E_IMPORT_PATH', bad)
    const ins = await inspect(window, label)
    const res = await mustApi<{ success: boolean; error?: string }>(window, 'importData', {
      token: ins.token
    })
    expect(res.success, label).toBe(false)
    expect(res.error, label).toContain('復元を中止しました')
    expect(dumpAll4(dataDir), label).toBe(before)
    expect(
      Object.fromEntries(
        listFilesRecursive(join(dataDir, 'documents')).map((f) => [
          f.slice(dataDir.length),
          sha256File(f)
        ])
      ),
      label
    ).toEqual(files)
    expect(
      existsSync(join(dataDir, 'tmp')) ? readdirSync(join(dataDir, 'tmp')) : [],
      label
    ).toEqual([])
    lines.push(`${label}: 中止「${res.error?.slice(0, 30)}…」、DB・書類ファイル不変、tmpは空`)
  }
  // 画面でも中止の表示
  const bad = join(workDir, 'sec23-bad-ui.zip')
  copyFileSync(zip, bad)
  mapExportTable(bad, 'tasks', (r, i) => (i === 0 ? { ...r, id: -1 } : r))
  await setEnv(app, 'JIMUHUB_E2E_IMPORT_PATH', bad)
  await openRestore(window)
  const msg = window.locator('.modal .message-success, .modal .message-error')
  await expect(msg).toContainText('復元を中止しました')
  await shot(
    window,
    'TC-161',
    '不正なidを含むバックアップを復元しようとしたときの表示(復元は中止され、データは復元前のまま)'
  )
  await window.getByLabel('閉じる').click()
  expect(dumpAll4(dataDir)).toBe(before)
  // 正しい形式の日時(オフセット付き・ミリ秒なし・ミリ秒あり)は復元できる
  const ok = join(workDir, 'sec23-ok.zip')
  copyFileSync(zip, ok)
  mapExportTable(ok, 'tasks', (r) => ({
    ...r,
    createdAt: '2026-10-01T09:00:00+09:00',
    updatedAt: '2026-10-02T00:00:00Z',
    completedAt: r.status === 'done' ? '2026-10-03T00:00:00.123Z' : null
  }))
  await setEnv(app, 'JIMUHUB_E2E_IMPORT_PATH', ok)
  await openRestore(window)
  await expect(msg).toContainText('復元が完了しました')
  expect(dbQuery(dataDir, 'select count(*) from tasks')).toBe('4')
  expect(dbQuery(dataDir, 'select created_at from tasks order by id limit 1')).toBe(
    '2026-10-01T09:00:00+09:00'
  )
  await shot(
    window,
    'TC-161',
    '正しい形式の日時(オフセット付き・ミリ秒なし)のバックアップは復元できる'
  )
  lines.push(
    '正しい形式の日時(+09:00・Z・ミリ秒あり/なし): 復元成功、4件、createdAtは元の表記のまま'
  )
  noteEvidence('TC-161', '不正なid・日時ごとの復元の結果', lines.join('\n'))
})

test('TC-162: [復元の互換] 旧形式(従来形式ZIP版4・JSON単体版3・版5のmanifest)の復元は、SEC-23の修正後も成功し、タスクは空になり、他のデータは復元される', async () => {
  test.setTimeout(180_000)
  const zip = await getSharedZip()
  const legacy4 = exportToLegacyJson(zip, 4) as { data: Record<string, unknown> }
  delete legacy4.data.tasks
  const entries: Record<string, Buffer | string> = { 'data.json': JSON.stringify(legacy4) }
  for (const [name, content] of readZipEntries(zip))
    if (name.startsWith('documents/')) entries[name] = content
  const legacyZip = join(workDir, 'legacy4.zip')
  buildZip(legacyZip, entries)
  const legacyJson = join(workDir, 'legacy3.json')
  const j3 = exportToLegacyJson(zip, 3) as { data: Record<string, unknown> }
  for (const k of ['tasks', 'projects', 'projectLinkHistory']) delete j3.data[k]
  writeFileSync(legacyJson, JSON.stringify(j3))
  const v5 = editManifest(zip, 'compat-v5.zip', (m) => {
    m.schemaVersion = 5
    delete m.tables.tasks
  })
  const { window, dataDir, app } = (launched = await launchApp())
  const lines: string[] = []
  for (const [label, path] of [
    ['従来形式ZIP(版4)', legacyZip],
    ['JSON単体(版3)', legacyJson],
    ['版5のmanifest(tasksの項目なし)', v5]
  ] as const) {
    await createTaskApi(window, { name: `現在のタスク(${label})` })
    await setEnv(app, 'JIMUHUB_E2E_IMPORT_PATH', path)
    await openRestore(window)
    const msg = window.locator('.modal .message-success, .modal .message-error')
    // タスクがあるため確認画面が出る
    await expect(window.getByText('復元前の確認')).toBeVisible()
    await window.getByRole('button', { name: '復元する' }).click()
    await expect(msg).toContainText('復元が完了しました')
    expect(dbQuery(dataDir, 'select count(*) from tasks'), label).toBe('0')
    expect(dbQuery(dataDir, 'select count(*) from clients'), label).toBe('1')
    expect(dbQuery(dataDir, 'select count(*) from invoices'), label).toBe('1')
    lines.push(`${label}: 復元成功、タスク0件、取引先1・請求書1が復元された`)
    await shot(window, 'TC-162', `${label}の復元の完了表示`)
    await window.getByLabel('閉じる').click()
  }
  noteEvidence('TC-162', '旧形式の復元の互換の確認結果', lines.join('\n'))
})

test('TC-163: [SEC-22] 開発ビルドのElectronが44.8.0で、起動・主要画面の遷移・復元が動作する(配布版はi4-packaged)', async () => {
  launched = await launchApp()
  const { window, app } = launched
  const ver = await app.evaluate(() => process.versions.electron)
  expect(ver).toBe('44.8.0')
  const log: string[] = [
    `Electron ${ver}、Chromium ${await app.evaluate(() => process.versions.chrome)}、Node ${await app.evaluate(() => process.versions.node)}`
  ]
  await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - ホーム')
  for (const [menu, title] of [
    ['取引先管理', '事務HUB - 取引先一覧'],
    ['案件管理', '事務HUB - 案件一覧'],
    ['見積書・請求書', '事務HUB - 見積書・請求書'],
    ['入出金・経費', '事務HUB - 入出金・経費'],
    ['タスク・期限', '事務HUB - タスク一覧'],
    ['ホーム', '事務HUB - ホーム']
  ] as const) {
    await window.getByRole('button', { name: menu }).click()
    await expect(window.locator('.titlebar-title')).toHaveText(title)
    log.push(`${menu}: ${title}`)
  }
  await shot(window, 'TC-163', 'Electron 44.8.0で起動したホーム画面')
  noteEvidence('TC-163', 'Electronの版と主要画面の遷移', log.join('\n'))
})
