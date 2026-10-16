import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createWorkDir } from '../../test-support/work-dir.mjs'
import { noteEvidence, shot } from './evidence-dir'
import { dbQuery, listFilesRecursive, sha256File } from './helpers'
import { dbExec, mustApi, relaunchOnDir } from './helpers-i2'
import { getProjectApi } from './helpers-i3'
import { createTaskApi } from './helpers-i4'

/**
 * 【tester作成】イテレーション4: データベースの移行(スキーマ版5→6。タスクのテーブルの追加)(TC-147・TC-148)。
 * 旧版(イテレーション3の配布物。タグ v0.4.0)のスキーマ定義で作った実データ構造から移行する。
 * 参照元: 詳細設計書 4.1章手順0-3・1、6.19章、6.20章、8章
 */
const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..')

function makeV5DataDir(): string {
  const dir = createWorkDir('e2e', 'jimuhub-i4-v5')
  execFileSync('node', [join(root, 'docs', '07_test', 'tools', 'make-v5-fixture.mjs'), root, dir], {
    stdio: 'pipe'
  })
  return dir
}

function dbRead(dataDir: string, sql: string): string {
  return execFileSync('sqlite3', ['-separator', '|', join(dataDir, 'data.sqlite'), sql], {
    encoding: 'utf8'
  }).trim()
}

const V5_TABLES = [
  'clients',
  'company_profile',
  'document_number_sequences',
  'quotes',
  'quote_line_items',
  'invoices',
  'invoice_line_items',
  'accounts',
  'cash_records',
  'receipts',
  'cash_record_history',
  'projects',
  'project_link_history'
]

function dumpAllV5(dataDir: string, read: (d: string, s: string) => string): string {
  return V5_TABLES.map((t) => read(dataDir, `select * from ${t} order by 1,2`))
    .join('\n--\n')
    .split(dataDir)
    .join('<D>')
}

test('TC-147: [移行] スキーマ版5(イテレーション3の旧版が作ったデータ)から版6への移行。移行前の自動退避、既存データ・PDF・領収書・案件の保持、tasksの追加、再起動で冪等、移行後のタスク機能と改変検知', async () => {
  test.setTimeout(120_000)
  const dataDir = makeV5DataDir()
  expect(dbQuery(dataDir, "select value from app_meta where key='schema_version'")).toBe('5')
  expect(dbQuery(dataDir, "select count(*) from sqlite_master where name='tasks'")).toBe('0')
  const pre = dumpAllV5(dataDir, dbQuery)
  const files = Object.fromEntries(
    listFilesRecursive(join(dataDir, 'documents')).map((f) => [
      f.slice(dataDir.length),
      sha256File(f)
    ])
  )
  expect(Object.keys(files)).toHaveLength(3)
  noteEvidence(
    'TC-147',
    '移行前(スキーマ版5。旧版 v0.4.0 の定義で作成)のDBの状態',
    `schema_version=5\nテーブル: ${dbQuery(dataDir, "select group_concat(name) from (select name from sqlite_master where type='table' order by name)")}\n件数: clients=${dbQuery(dataDir, 'select count(*) from clients')} projects=${dbQuery(dataDir, 'select count(*) from projects')} quotes=${dbQuery(dataDir, 'select count(*) from quotes')} invoices=${dbQuery(dataDir, 'select count(*) from invoices')} cash_records=${dbQuery(dataDir, 'select count(*) from cash_records')} receipts=${dbQuery(dataDir, 'select count(*) from receipts')}\nファイル数: ${Object.keys(files).length}`
  )

  const re = await relaunchOnDir(dataDir)
  await expect(re.window.locator('.titlebar-title')).toHaveText('事務HUB - ホーム')
  expect(dbQuery(dataDir, "select value from app_meta where key='schema_version'")).toBe('6')
  // 移行前の退避(版5のまま)
  const backups = readdirSync(join(dataDir, 'backups')).filter((n) =>
    n.startsWith('pre-migration_v5_')
  )
  expect(backups).toHaveLength(1)
  const backupPath = join(dataDir, 'backups', backups[0])
  const bk = (sql: string): string =>
    execFileSync('sqlite3', ['-readonly', backupPath, sql], { encoding: 'utf8' }).trim()
  expect(bk("select value from app_meta where key='schema_version'")).toBe('5')
  expect(bk("select count(*) from sqlite_master where name='tasks'")).toBe('0')
  expect(bk('select count(*) from projects')).toBe('2')
  // tasksと索引3つ。tasksは空
  expect(
    dbQuery(dataDir, "select count(*) from sqlite_master where type='table' and name='tasks'")
  ).toBe('1')
  expect(
    dbQuery(
      dataDir,
      "select group_concat(name) from (select name from sqlite_master where type='index' and tbl_name='tasks' and name like 'idx_tasks_%' order by name)"
    )
  ).toBe('idx_tasks_due,idx_tasks_project,idx_tasks_status_due')
  expect(dbQuery(dataDir, 'select count(*) from tasks')).toBe('0')
  expect(
    dbQuery(
      dataDir,
      "select group_concat(name||':'||type||':'||\"notnull\") from pragma_table_info('tasks')"
    )
  ).toBe(
    'id:INTEGER:0,name:TEXT:1,memo:TEXT:0,due_date:TEXT:0,project_id:INTEGER:0,status:TEXT:1,completed_at:TEXT:0,created_at:TEXT:1,updated_at:TEXT:1'
  )
  // 既存データは変わらない
  expect(dumpAllV5(dataDir, dbQuery)).toBe(pre)
  expect(
    Object.fromEntries(
      listFilesRecursive(join(dataDir, 'documents')).map((f) => [
        f.slice(dataDir.length),
        sha256File(f)
      ])
    )
  ).toEqual(files)
  await shot(
    re.window,
    'TC-147',
    '版5のデータから起動した直後のホーム(既存の取引先・見積書・請求書が保持)'
  )

  // 画面: 案件に紐づく既存データが見え、改変の誤検知がない
  const recId = Number(
    dbQuery(dataDir, "select id from cash_records where description='版5の通信費(領収書あり)'")
  )
  const d = await mustApi<{
    integrity: { recordHashOk: boolean; historyHashOk: boolean; receipts: Array<{ state: string }> }
  }>(re.window, 'getRecord', recId)
  expect(
    d.integrity.recordHashOk &&
      d.integrity.historyHashOk &&
      d.integrity.receipts.every((r) => r.state === 'ok')
  ).toBe(true)
  expect(
    dbQuery(dataDir, 'select sum(pdf_hash_mismatch) from quotes') +
      dbQuery(dataDir, 'select sum(pdf_hash_mismatch) from invoices')
  ).toBe('00')
  await re.window.getByRole('button', { name: '案件管理' }).click()
  await expect(re.window.getByRole('cell', { name: '版5の進行中案件' })).toBeVisible()
  await re.window.getByRole('cell', { name: '版5の進行中案件' }).click()
  await expect(re.window.getByText('この案件に紐づくタスクはありません')).toBeVisible()
  const pid = Number(dbQuery(dataDir, "select id from projects where name='版5の進行中案件'"))
  const detail = await getProjectApi(re.window, pid)
  expect(detail.summary.sales).toBe(55000)
  expect(detail.summary.expense).toBe(5500)
  await shot(re.window, 'TC-147', '移行後の案件詳細(収支は移行前と同じ。紐づくタスクは0件)')

  // 移行後にタスクが使える。移行前のデータは変わらない
  const t = await createTaskApi(re.window, {
    name: '移行後のタスク',
    projectId: pid,
    dueDate: '2030-01-01'
  })
  await mustApi(re.window, 'completeTask', t)
  await re.window.getByRole('button', { name: 'タスク・期限' }).click()
  await re.window.getByLabel('状態', { exact: true }).selectOption('all')
  await expect(re.window.getByRole('row', { name: /移行後のタスク/ })).toBeVisible()
  expect(dumpAllV5(dataDir, dbQuery)).toBe(pre)
  await shot(re.window, 'TC-147', '移行後に登録したタスク(案件つき)の一覧')
  await re.app.close()

  // 再起動: 移行は冪等で、退避は増えず、タスクは維持される
  const re2 = await relaunchOnDir(dataDir)
  await expect(re2.window.locator('.titlebar-title')).toHaveText('事務HUB - ホーム')
  expect(dbQuery(dataDir, "select value from app_meta where key='schema_version'")).toBe('6')
  expect(
    readdirSync(join(dataDir, 'backups')).filter((n) => n.startsWith('pre-migration_')).length
  ).toBe(1)
  expect(dbQuery(dataDir, 'select count(*) from tasks')).toBe('1')
  await re2.app.close()
  noteEvidence(
    'TC-147',
    '移行後の確認結果',
    `schema_version=6、退避: ${backups.join(', ').replace(/_\d{8}.*/, '_<日時>.sqlite')}(退避内のschema_version=5、tasksなし、projects=2)\ntasksと索引3つ(idx_tasks_status_due・idx_tasks_project・idx_tasks_due)を追加。列: id,name,memo,due_date,project_id,status,completed_at,created_at,updated_at\n既存の全テーブル(取引先・見積書・請求書・入出金・領収書・履歴・案件・付け替え履歴)の内容と、PDF・領収書のSHA-256は移行前後で一致\n記録ハッシュ・領収書・PDFの改変検知: 誤検知なし\n案件別収支は移行前と同じ(売上${detail.summary.sales}円・経費${detail.summary.expense}円)\n再起動後も退避は1件、schema_version=6、移行後に登録したタスクは維持`
  )
})

test('TC-148: [移行] 移行に失敗した場合のロールバック。スキーマ版は5のまま・既存データは無傷・移行前の退避が残り、原因を取り除くと次の起動で移行できる', async () => {
  test.setTimeout(120_000)
  const dataDir = makeV5DataDir()
  const pre = dumpAllV5(dataDir, dbRead)
  // 移行を失敗させる: 同名で列の構成が異なる表 tasks を先に置く(索引の作成で失敗する)
  dbExec(dataDir, 'create table tasks (id integer primary key, note text)')
  const re = await relaunchOnDir(dataDir)
  await expect(
    re.window.getByText(/データを読み込めませんでした|起動できませんでした|読み込めません/).first()
  ).toBeVisible({ timeout: 15000 })
  await shot(re.window, 'TC-148', '移行に失敗したときの起動エラー画面')
  const body = await re.window.locator('body').innerText()
  await re.app.close()
  expect(dbRead(dataDir, "select value from app_meta where key='schema_version'")).toBe('5')
  expect(dbRead(dataDir, "select group_concat(name) from pragma_table_info('tasks')")).toBe(
    'id,note'
  )
  expect(dbRead(dataDir, "select count(*) from sqlite_master where name like 'idx_tasks_%'")).toBe(
    '0'
  )
  expect(dumpAllV5(dataDir, dbRead)).toBe(pre)
  const backups = readdirSync(join(dataDir, 'backups')).filter((n) =>
    n.startsWith('pre-migration_v5_')
  )
  expect(backups.length).toBeGreaterThanOrEqual(1)
  // 原因を取り除いて再起動すると移行できる
  dbExec(dataDir, 'drop table tasks')
  const re2 = await relaunchOnDir(dataDir)
  await expect(re2.window.locator('.titlebar-title')).toHaveText('事務HUB - ホーム')
  expect(dbRead(dataDir, "select value from app_meta where key='schema_version'")).toBe('6')
  expect(dbRead(dataDir, 'select count(*) from tasks')).toBe('0')
  expect(dumpAllV5(dataDir, dbRead)).toBe(pre)
  await re2.app.close()
  noteEvidence(
    'TC-148',
    '移行失敗時の結果',
    `失敗時の画面の文言:\n${body.replace(/\s+/g, ' ').slice(0, 400)}\nロールバック後: schema_version=5、索引(idx_tasks_*)なし、既存データは変更前と一致、退避=${backups.length}件\n原因除去後の再起動: schema_version=6、tasksは空、既存データは変更前と一致`
  )
  void existsSync
})
