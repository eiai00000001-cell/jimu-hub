import { test, expect, type Page } from '@playwright/test'
import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { createWorkDir } from '../../test-support/work-dir.mjs'
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/electron-app'
import { noteEvidence, shot } from './evidence-dir'
import { createClientApi, dbQuery, listFilesRecursive, setupCompany, sha256File } from './helpers'
import {
  accountId,
  createRecordApi,
  makeReceiptFixtures,
  mustApi,
  pickTokens,
  setEnv,
  type Fixtures
} from './helpers-i2'
import { createProjectApi, finalizeInvoiceWithProject } from './helpers-i3'
import { createTaskApi, dumpTasks, localDate, snapshotNonTask } from './helpers-i4'
import {
  buildZip,
  exportToLegacyJson,
  mapExportTable,
  readExport,
  readZipEntries
} from '../../src/main/services/backup/test-helpers'

/**
 * 【tester作成】イテレーション4: バックアップ・復元へのタスクの追加(F-39。R-55を含む)(TC-142〜TC-146)。
 * 参照元: 詳細設計書 4.2章・4.3章・4.33章・4.39章・8章
 */
let workDir: string
let fx: Fixtures
let launched: LaunchedApp | undefined

test.beforeAll(() => {
  workDir = createWorkDir('e2e', 'jimuhub-i4-backup')
  fx = makeReceiptFixtures()
})
test.afterEach(async () => {
  if (launched) await closeApp(launched)
  launched = undefined
})

async function start(extraEnv: Record<string, string> = {}): Promise<LaunchedApp> {
  launched = await launchApp(extraEnv)
  return launched
}

interface Inspection {
  token: string
  schemaVersion: number
  hasReceipts: boolean
  hasProjects: boolean
  hasTasks: boolean
  currentReceiptCount: number
  currentProjectCount: number
  currentTaskCount: number
  needsConfirmation: boolean
}

async function inspect(window: Page, label = ''): Promise<Inspection> {
  const r = await mustApi<{ success: boolean; inspection?: Inspection; error?: string }>(
    window,
    'inspectBackup'
  )
  if (!r.success || !r.inspection) throw new Error(`inspectBackup(${label}) failed: ${r.error}`)
  return r.inspection
}

async function openRestore(window: Page): Promise<void> {
  // 復元ダイアログが開いたまま(キャンセル後)ならそのまま、閉じていればホームから開く
  if ((await window.getByRole('button', { name: 'ファイルを選択して復元' }).count()) === 0) {
    await window.getByRole('button', { name: 'ホーム' }).click()
    await window.getByRole('button', { name: 'データを復元' }).click()
  }
  await window.getByRole('button', { name: 'ファイルを選択して復元' }).click()
  await window.getByRole('button', { name: '続行' }).click()
}

async function importViaUi(window: Page, confirm = false): Promise<string> {
  await openRestore(window)
  if (confirm) await window.getByRole('button', { name: '復元する' }).click()
  const message = window.locator('.modal .message-success, .modal .message-error')
  await expect(message).toBeVisible()
  return message.innerText()
}

function dumpAllI4(dataDir: string): string {
  return [snapshotNonTask(dataDir), dumpTasks(dataDir)].join('\n--\n').split(dataDir).join('<D>')
}

let sharedZip: string | undefined
let sharedDump = ''
/** 案件・書類・領収書・タスク(未完了・完了・案件あり/なし・メモの記号)を含む元データを作ってエクスポートする */
async function getSharedZip(): Promise<string> {
  if (sharedZip) return sharedZip
  const zip = join(workDir, 'source-v6.zip')
  const src = await start({ JIMUHUB_E2E_EXPORT_PATH: zip })
  const { window, dataDir, app } = src
  await setupCompany(window)
  const client = await createClientApi(window, 'タスク往復商事株式会社', {
    furigana: 'タスクオウフクショウジ'
  })
  const A = await createProjectApi(window, { name: '往復の案件A', clientId: client })
  const B = await createProjectApi(window, { name: '往復の案件B' })
  await finalizeInvoiceWithProject(window, { clientId: client, unitPrice: 100000, projectId: A })
  const acc = await accountId(window, '通信費')
  const { files } = await pickTokens(window, app, [fx.pdf])
  await createRecordApi(window, {
    accountId: acc,
    description: '領収書つきの経費',
    receiptTokens: files.map((f) => f.token)
  })
  await createTaskApi(window, {
    name: 'タスクA(未完了・過去の期限)',
    projectId: A,
    dueDate: localDate(-5),
    memo: '案件Aの作業'
  })
  const b = await createTaskApi(window, {
    name: 'タスクB(完了・案件B)',
    projectId: B,
    dueDate: '2030-02-01'
  })
  await mustApi(window, 'completeTask', b)
  await createTaskApi(window, {
    name: 'タスクC(案件なし・記号のメモ)',
    memo: '1行目\n2行目 "引用符" \'単引用\' <tag> & 100% _under_ ＼全角＼'
  })
  const d = await createTaskApi(window, { name: 'タスクD(完了・案件なし)' })
  await mustApi(window, 'completeTask', d)
  await mustApi(window, 'completeProject', B)
  sharedDump = dumpAllI4(dataDir)
  await window.getByRole('button', { name: 'ホーム' }).click()
  await window.getByRole('button', { name: 'データをエクスポート' }).click()
  await window.getByRole('button', { name: 'エクスポート実行' }).click()
  await expect(window.getByText(/保存しました/)).toBeVisible()
  await closeApp(src)
  launched = undefined
  sharedZip = zip
  return zip
}

/** 版6のZIPから、タスクを含まない版5相当のZIPを作る */
function toV5(src: string, name: string): string {
  const out = join(workDir, name)
  copyFileSync(src, out)
  const z = new AdmZip(out)
  const manifest = JSON.parse(z.readAsText('manifest.json')) as {
    schemaVersion: number
    tables: Record<string, unknown>
  }
  manifest.schemaVersion = 5
  delete manifest.tables.tasks
  z.deleteFile('data/tasks.jsonl')
  z.updateFile('manifest.json', Buffer.from(JSON.stringify(manifest)))
  z.writeZip(out)
  return out
}

test('TC-142: [F-39 往復] エクスポートはスキーマ版6でtasksを含み、別のデータ保存先への復元でタスク(案件の紐づけ・完了日時・メモの記号を含む)が完全に一致する。復元は全置換', async () => {
  test.setTimeout(120_000)
  const zip = await getSharedZip()
  const exp = readExport(zip)
  expect(exp.manifest.schemaVersion).toBe(6)
  expect(exp.manifest.tables.tasks).toEqual({ file: 'data/tasks.jsonl', count: 4 })
  expect(exp.entries.has('data/tasks.jsonl')).toBe(true)
  const rows = exp.records('tasks')
  expect(rows).toHaveLength(4)
  expect(Object.keys(rows[0]).sort()).toEqual(
    [
      'completedAt',
      'createdAt',
      'dueDate',
      'id',
      'memo',
      'name',
      'projectId',
      'status',
      'updatedAt'
    ].sort()
  )
  expect(rows.map((r) => r.status)).toEqual(['open', 'done', 'open', 'done'])
  noteEvidence(
    'TC-142',
    'エクスポートファイルの内容',
    `manifest: schemaVersion=${exp.manifest.schemaVersion}、tables.tasks=${JSON.stringify(exp.manifest.tables.tasks)}\ndata/tasks.jsonl: ${rows.length}行、項目=${Object.keys(rows[0]).sort().join(',')}\n状態=${rows.map((r) => r.status).join(',')}、案件ID=${rows.map((r) => r.projectId ?? 'null').join(',')}、完了日時あり=${rows.map((r) => (r.completedAt ? 'Y' : 'N')).join(',')}`
  )

  // 別の(空でない)データ保存先へ復元する。復元前のタスクは全置換で消える
  const dst = await start({ JIMUHUB_E2E_IMPORT_PATH: zip })
  const { window, dataDir } = dst
  await createTaskApi(window, { name: '復元先に元からあるタスク' })
  const msg = await importViaUi(window) // 確認画面なし(バックアップにタスク・案件・領収書を含む)
  expect(msg).toContain('復元が完了しました')
  expect(msg).not.toContain('改変')
  expect(msg).not.toContain('案件への紐づけ')
  await shot(
    window,
    'TC-142',
    '1) 別のデータ保存先への復元の完了メッセージ(確認画面なし・警告なし)'
  )
  await window.getByLabel('閉じる').click()
  expect(dumpAllI4(dataDir)).toBe(sharedDump)
  expect(dbQuery(dataDir, "select count(*) from tasks where name='復元先に元からあるタスク'")).toBe(
    '0'
  )
  expect(dbQuery(dataDir, 'select count(*) from tasks')).toBe('4')
  expect(readdirSync(join(dataDir, 'backups')).length).toBeGreaterThanOrEqual(1) // 復元前の状態の退避
  await window.getByRole('button', { name: 'タスク・期限' }).click()
  await window.getByLabel('状態', { exact: true }).selectOption('all')
  await expect(window.getByText('該当 4件')).toBeVisible()
  await shot(window, 'TC-142', '2) 復元後のタスク一覧(未完了・完了とも復元)')
  await window.getByRole('button', { name: 'タスクC(案件なし・記号のメモ)' }).click()
  await expect(window.locator('.info-grid')).toContainText('2行目 "引用符"')
  await shot(window, 'TC-142', '3) 復元後のタスク詳細(メモの改行・記号が保たれる)')
  noteEvidence(
    'TC-142',
    '復元後の照合結果',
    `復元先のタスク・案件・書類・記録・履歴・領収書のダンプは、元のデータと完全に一致(${sharedDump.split('\n').length}行)\n復元先に元からあったタスクは全置換で消えた\n復元前の状態は backups/ に退避された`
  )
  // 復元したデータの再エクスポートも同じ内容(往復で劣化しない)
  const again = join(workDir, 're-export.zip')
  await setEnv(dst.app, 'JIMUHUB_E2E_EXPORT_PATH', again)
  await mustApi(window, 'exportData')
  expect(readExport(again).records('tasks')).toEqual(rows)
})

test('TC-143: [F-39・R-55 旧版の復元] スキーマ版5以前(ZIP・従来形式のZIP・JSON単体)の復元でタスクは空になり、現在のタスクが1件以上あるときだけ確認画面に件数を表示する', async () => {
  test.setTimeout(180_000)
  const zip = await getSharedZip()
  const v5 = toV5(zip, 'v5-no-tasks.zip')
  const legacy4 = exportToLegacyJson(zip, 4) as { data: Record<string, unknown> }
  delete legacy4.data.tasks
  const entries: Record<string, Buffer | string> = { 'data.json': JSON.stringify(legacy4) }
  for (const [n, c] of readZipEntries(zip)) if (n.startsWith('documents/')) entries[n] = c
  const legacyZip = join(workDir, 'legacy-v4.zip')
  buildZip(legacyZip, entries)
  const legacyJson = join(workDir, 'legacy-v3.json')
  const j3 = exportToLegacyJson(zip, 3) as { data: Record<string, unknown> }
  for (const k of ['tasks', 'projects', 'projectLinkHistory']) delete j3.data[k]
  writeFileSync(legacyJson, JSON.stringify(j3))
  // 版6でtasksが0件のファイル
  const v6empty = join(workDir, 'v6-empty-tasks.zip')
  copyFileSync(zip, v6empty)
  const ze = new AdmZip(v6empty)
  ze.updateFile('data/tasks.jsonl', Buffer.from('\n'))
  const me = JSON.parse(ze.readAsText('manifest.json')) as { tables: { tasks: { count: number } } }
  me.tables.tasks.count = 0
  ze.updateFile('manifest.json', Buffer.from(JSON.stringify(me)))
  ze.writeZip(v6empty)

  // 判定表: 現在のタスクの有無 × バックアップの種類(領収書・案件は現在もバックアップも含む状態にそろえ、タスクだけが変わる)
  const { window, dataDir, app } = await start({ JIMUHUB_E2E_IMPORT_PATH: zip })
  await importViaUi(window) // 現在のデータ = 版6のバックアップの内容(領収書・案件・タスク4件)
  await window.getByLabel('閉じる').click()
  const lines: string[] = []
  const cases: Array<[string, string, boolean]> = [
    ['版6(タスク4件)', zip, false],
    ['版6(タスク0件)', v6empty, true],
    ['版5のZIP(manifest。tasksなし)', v5, true],
    ['版4のZIP(従来形式 data.json)', legacyZip, true],
    ['版3のJSON単体', legacyJson, true]
  ]
  for (const [label, path, expectConfirm] of cases) {
    await setEnv(app, 'JIMUHUB_E2E_IMPORT_PATH', path)
    const ins = await inspect(window, label)
    lines.push(
      `${label}: schemaVersion=${ins.schemaVersion} hasTasks=${ins.hasTasks} currentTaskCount=${ins.currentTaskCount} needsConfirmation=${ins.needsConfirmation}`
    )
    expect(ins.currentTaskCount, label).toBe(4)
    expect(ins.hasTasks, label).toBe(label.startsWith('版6(タスク4件)'))
    // 版5・従来形式・JSON単体は、案件(版4以前)・領収書を含まない場合もあるため、タスクの判定のみを厳密に確認する
    if (label.startsWith('版6')) expect(ins.needsConfirmation, label).toBe(expectConfirm)
    else expect(ins.needsConfirmation, label).toBe(true)
    await mustApi(window, 'discardBackup', ins.token)
  }

  // 現在のタスクが0件なら、タスクのための確認は出ない(版5は領収書・案件を含むため確認画面なしで復元)
  // 版5のZIPで確認画面の表示(現在のタスク4件。案件・領収書は含むのでタスクの文言のみ)
  await setEnv(app, 'JIMUHUB_E2E_IMPORT_PATH', v5)
  await openRestore(window)
  await expect(window.getByText('復元前の確認')).toBeVisible()
  await expect(
    window.getByText(
      'このバックアップにはタスクのデータが含まれていないため、復元すると現在のタスク(4件)はすべて消えます。'
    )
  ).toBeVisible()
  await expect(window.getByText(/現在の領収書/)).toHaveCount(0)
  await expect(window.getByText(/現在の案件\(/)).toHaveCount(0)
  await expect(
    window.getByText('復元前の状態は自動で退避され、直近3回分が保存されます。')
  ).toBeVisible()
  expect(await window.evaluate(() => document.activeElement?.textContent ?? '')).toBe('キャンセル')
  await shot(
    window,
    'TC-143',
    '1) 版5のバックアップを復元しようとしたときの確認画面(現在のタスク4件が消える旨。「キャンセル」が初期フォーカス)'
  )
  // キャンセル: 何も変わらない
  const before = dumpAllI4(dataDir)
  await window.getByRole('button', { name: 'キャンセル' }).click()
  expect(dumpAllI4(dataDir)).toBe(before)
  expect(dbQuery(dataDir, 'select count(*) from tasks')).toBe('4')
  // 復元する: タスクが空になる。書類・案件は復元される
  await openRestore(window)
  await window.getByRole('button', { name: '復元する' }).click()
  await expect(window.getByText(/復元が完了しました/)).toBeVisible()
  expect(dbQuery(dataDir, 'select count(*) from tasks')).toBe('0')
  expect(dbQuery(dataDir, 'select count(*) from projects')).toBe('2')
  expect(dbQuery(dataDir, 'select count(*) from invoices')).toBe('1')
  await shot(window, 'TC-143', '2) 「復元する」を選んだ後の完了表示(タスクは空)')
  await window.getByLabel('閉じる').click()
  await window.getByRole('button', { name: 'タスク・期限' }).click()
  await expect(window.getByText('該当するタスクはありません')).toBeVisible()

  // 現在のタスクが0件の状態で版5を復元: タスクのための確認は出ない(確認画面なしで復元)
  const ins0 = await (async () => {
    await setEnv(app, 'JIMUHUB_E2E_IMPORT_PATH', v5)
    return inspect(window)
  })()
  lines.push(
    `現在のタスク0件で版5: currentTaskCount=${ins0.currentTaskCount} needsConfirmation=${ins0.needsConfirmation}`
  )
  expect(ins0.currentTaskCount).toBe(0)
  expect(ins0.needsConfirmation).toBe(false)
  await mustApi(window, 'discardBackup', ins0.token)
  const msg = await importViaUi(window)
  expect(msg).toContain('復元が完了しました')
  await window.getByLabel('閉じる').click()

  // 領収書・案件が現在なく、タスクだけがある状態で、版5を復元: タスクの文言のみが出る
  await createTaskApi(window, { name: '現在のタスクのみ' })
  await setEnv(app, 'JIMUHUB_E2E_IMPORT_PATH', legacyJson)
  const insJ = await inspect(window)
  lines.push(
    `現在の領収書・案件・タスクが混在しJSON単体を復元: needsConfirmation=${insJ.needsConfirmation} currentTaskCount=${insJ.currentTaskCount}`
  )
  await mustApi(window, 'discardBackup', insJ.token)
  noteEvidence('TC-143', '確認画面の要否の判定表(inspectBackupの結果)', lines.join('\n'))
  expect(existsSync(join(dataDir, 'tmp')) ? readdirSync(join(dataDir, 'tmp')) : []).toEqual([])
})

test('TC-144: [F-39 補正] 存在しない案件を指すタスクは「案件なし」に補正されて件数が出る、statusとcompletedAtの不整合はstatusを正として補正され、復元は中断しない', async () => {
  const zip = await getSharedZip()
  const fixed = join(workDir, 'fix-tasks.zip')
  copyFileSync(zip, fixed)
  // 行0(未完了・案件A)の案件を存在しない999へ。行1(完了・案件B)は完了日時を消す(statusは完了のまま)。行2(未完了)は完了日時を付ける。行3は案件なしのまま
  mapExportTable(fixed, 'tasks', (r, i) => {
    if (i === 0) return { ...r, projectId: 999 }
    if (i === 1) return { ...r, completedAt: null }
    if (i === 2) return { ...r, completedAt: '2026-01-01T00:00:00.000Z' }
    return r
  })
  const { window, dataDir } = await start({ JIMUHUB_E2E_IMPORT_PATH: fixed })
  const msg = await importViaUi(window)
  expect(msg).toContain('復元が完了しました')
  expect(msg).toContain('案件への紐づけ1件を、対応する案件が無いため「案件なし」にしました')
  await shot(
    window,
    'TC-144',
    '1) 存在しない案件を指すタスクを補正した復元の完了メッセージ(件数つき)'
  )
  const rows = dbQuery(
    dataDir,
    'select id,status,project_id is null,completed_at is null,completed_at from tasks order by id'
  ).split('\n')
  noteEvidence('TC-144', '補正の結果(完了メッセージとtasksの行)', `${msg}\n${rows.join('\n')}`)
  const r = rows.map((x) => x.split('|'))
  expect(r[0].slice(1, 4)).toEqual(['open', '1', '1']) // 案件なしに補正、未完了のまま
  expect(r[1].slice(1, 3)).toEqual(['done', '0']) // 案件Bは存在するので維持。statusを正として完了日時を補う
  expect(r[1][3]).toBe('0')
  expect(r[2].slice(1, 4)).toEqual(['open', '1', '1']) // statusを正として、完了日時を消す(未完了)
  expect(r[3].slice(1, 3)).toEqual(['done', '1'])
  expect(dbQuery(dataDir, 'select count(*) from tasks')).toBe('4') // 中断せず全件復元
  await window.getByLabel('閉じる').click()
  await window.getByRole('button', { name: 'タスク・期限' }).click()
  await window.getByLabel('状態', { exact: true }).selectOption('all')
  await expect(window.getByText('該当 4件')).toBeVisible()
  await shot(window, 'TC-144', '2) 補正後のタスク一覧(復元は中断せず4件とも表示)')
})

test('TC-145: [F-39 異常系] 不正な行(タスク名・メモ・期限日・状態)を含むバックアップは復元を中止し、現在のデータ・ファイルは変わらず、一時フォルダも残らない(I4-04)', async () => {
  test.setTimeout(180_000)
  const zip = await getSharedZip()
  const { window, dataDir, app } = await start()
  await setupCompany(window)
  const client = await createClientApi(window, '中止確認商事')
  const pr = await createProjectApi(window, { name: '現在の案件', clientId: client })
  await createTaskApi(window, { name: '現在のタスク', projectId: pr })
  const before = dumpAllI4(dataDir)
  const filesBefore = Object.fromEntries(
    listFilesRecursive(join(dataDir, 'documents')).map((f) => [
      f.slice(dataDir.length),
      sha256File(f)
    ])
  )
  const variants: Array<[string, (r: Record<string, unknown>) => Record<string, unknown>]> = [
    ['タスク名が空', (r) => ({ ...r, name: '' })],
    ['タスク名が空白のみ', (r) => ({ ...r, name: '   ' })],
    ['タスク名が101文字', (r) => ({ ...r, name: 'あ'.repeat(101) })],
    ['メモが1001文字', (r) => ({ ...r, memo: 'い'.repeat(1001) })],
    ['期限日が実在しない日付', (r) => ({ ...r, dueDate: '2026-02-30' })],
    ['期限日の形式が不正', (r) => ({ ...r, dueDate: '2026/02/01' })],
    ['状態が不明な値', (r) => ({ ...r, status: 'unknown' })]
  ]
  const lines: string[] = []
  let n = 0
  for (const [label, mapper] of variants) {
    const bad = join(workDir, `bad-task-${n++}.zip`)
    copyFileSync(zip, bad)
    mapExportTable(bad, 'tasks', (r, i) => (i === 2 ? mapper(r) : r)) // 3行目だけを不正にする
    await setEnv(app, 'JIMUHUB_E2E_IMPORT_PATH', bad)
    const ins = await inspect(window)
    const res = await mustApi<{ success: boolean; error?: string }>(window, 'importData', {
      token: ins.token
    })
    expect(res.success, label).toBe(false)
    expect(res.error, label).toBe(
      'バックアップ内のタスクのデータに、不正な項目(タスク名・メモ・期限日・状態)があるため、復元を中止しました。データは復元前の状態のままです'
    )
    expect(dumpAllI4(dataDir), label).toBe(before)
    expect(
      Object.fromEntries(
        listFilesRecursive(join(dataDir, 'documents')).map((f) => [
          f.slice(dataDir.length),
          sha256File(f)
        ])
      ),
      label
    ).toEqual(filesBefore)
    expect(
      existsSync(join(dataDir, 'tmp')) ? readdirSync(join(dataDir, 'tmp')) : [],
      label
    ).toEqual([])
    lines.push(`${label}: 中止「${res.error}」、DB・書類ファイルは復元前と同一、一時フォルダは空`)
  }
  // 画面でも中止の文言が表示され、続けて通常のバックアップを復元できる(中止がアプリを壊さない)
  const bad = join(workDir, 'bad-task-ui.zip')
  copyFileSync(zip, bad)
  mapExportTable(bad, 'tasks', (r, i) => (i === 0 ? { ...r, name: '' } : r))
  await setEnv(app, 'JIMUHUB_E2E_IMPORT_PATH', bad)
  const msg = await importViaUi(window)
  expect(msg).toContain('復元を中止しました')
  await shot(
    window,
    'TC-145',
    '1) 不正なタスクを含むバックアップを復元しようとしたときの表示(復元は中止され、データは復元前のまま)'
  )
  await window.getByLabel('閉じる').click()
  expect(dumpAllI4(dataDir)).toBe(before)
  await setEnv(app, 'JIMUHUB_E2E_IMPORT_PATH', zip)
  const ok = await importViaUi(window)
  expect(ok).toContain('復元が完了しました')
  expect(dbQuery(dataDir, 'select count(*) from tasks')).toBe('4')
  await shot(window, 'TC-145', '2) 中止の後、正しいバックアップは復元できる')
  noteEvidence('TC-145', '不正な行ごとの復元の結果', lines.join('\n'))
})

test('TC-146: [F-39 影響しないもの] タスクの追加・変更・完了・削除の前後、およびタスクを含むバックアップの復元の前後で、PDFのSHA-256・記録ハッシュ・領収書の照合・案件別収支は変わらない', async () => {
  test.setTimeout(120_000)
  const zip = await getSharedZip()
  // 復元先で、タスクの操作前後のハッシュを比べる
  const { window, dataDir } = await start({ JIMUHUB_E2E_IMPORT_PATH: zip })
  const msg = await importViaUi(window)
  expect(msg).toContain('復元が完了しました')
  expect(msg).not.toMatch(/改変|欠落/) // 復元後の照合(PDF・領収書・記録ハッシュ)で警告が出ない
  await window.getByLabel('閉じる').click()
  const hashes = (): string =>
    [
      dbQuery(
        dataDir,
        'select pdf_hash,pdf_hash_mismatch from quotes union all select pdf_hash,pdf_hash_mismatch from invoices'
      ),
      dbQuery(dataDir, 'select record_hash from cash_records order by id'),
      dbQuery(dataDir, 'select record_hash_after from cash_record_history order by id'),
      dbQuery(dataDir, 'select sha256 from receipts order by id')
    ].join('\n--\n')
  const h0 = hashes()
  const pid = Number(dbQuery(dataDir, "select id from projects where name='往復の案件A'"))
  const detail0 = await mustApi<{ summary: unknown; history: unknown[] }>(window, 'getProject', pid)
  const snap0 = snapshotNonTask(dataDir)
  // タスクの追加・変更・完了・案件の変更・削除
  const t = await createTaskApi(window, {
    name: '影響確認のタスク',
    projectId: pid,
    dueDate: '2030-01-01'
  })
  await mustApi(window, 'updateTask', t, { name: '影響確認のタスク(変更)', projectId: null })
  await mustApi(window, 'updateTask', t, { name: '影響確認のタスク(変更)', projectId: pid })
  await mustApi(window, 'completeTask', t)
  await mustApi(window, 'reopenTask', t)
  await mustApi(window, 'deleteTask', t)
  expect(hashes()).toBe(h0)
  expect(snapshotNonTask(dataDir)).toBe(snap0)
  const detail1 = await mustApi<{ summary: unknown; history: unknown[] }>(window, 'getProject', pid)
  expect(detail1.summary).toEqual(detail0.summary)
  expect(detail1.history).toEqual(detail0.history)
  // 画面の照合: 書類・記録の詳細に改変の警告が出ない
  const recId = Number(
    dbQuery(dataDir, "select id from cash_records where description='領収書つきの経費'")
  )
  const d = await mustApi<{
    integrity: { recordHashOk: boolean; receipts: Array<{ state: string }> }
  }>(window, 'getRecord', recId)
  expect(d.integrity.recordHashOk && d.integrity.receipts.every((r) => r.state === 'ok')).toBe(true)
  await window.getByRole('button', { name: '入出金・経費' }).click()
  await window.getByRole('cell', { name: '領収書つきの経費' }).click()
  await expect(window.getByText(/改変が疑われます|改変・欠落/)).toHaveCount(0)
  await shot(
    window,
    'TC-146',
    '1) タスクの追加・変更・完了・削除を行った後の記録詳細(改変の警告なし)'
  )
  // 版5(タスクなし)の復元でも、書類・記録の照合結果は同じ
  const v5 = toV5(zip, 'v5-hash-check.zip')
  await setEnv(launched!.app, 'JIMUHUB_E2E_IMPORT_PATH', v5)
  const msg5 = await importViaUi(window, true)
  expect(msg5).toContain('復元が完了しました')
  expect(msg5).not.toMatch(/改変|欠落/)
  expect(hashes()).toBe(h0)
  noteEvidence(
    'TC-146',
    '影響しないことの確認結果',
    `タスクの追加・変更・完了・未完了・削除の前後で、見積書・請求書のPDFのSHA-256(pdf_hashとpdf_hash_mismatch)、記録ハッシュ(cash_records・履歴)、領収書のSHA-256、案件・付け替え履歴、案件別収支は完全に一致\n版6(タスクあり)・版5(タスクなし)のどちらの復元でも、完了メッセージに改変・欠落の警告は出ない\n復元ファイルの完了メッセージ(版6): ${msg}`
  )
  void readFileSync
})
