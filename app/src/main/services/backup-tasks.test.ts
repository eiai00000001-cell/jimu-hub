import { rmSync, writeFileSync } from 'node:fs'
import { createWorkDir } from '@test-support/work-dir.mjs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BACKUP_MESSAGES } from '@shared/messages/messages'
import { Database } from '../db/db'
import { ClientRepository } from '../repositories/client.repository'
import { ProjectRepository } from '../repositories/project.repository'
import { ProjectSummaryRepository } from '../repositories/project-summary.repository'
import { TaskRepository } from '../repositories/task.repository'
import { BackupService } from './backup.service'
import { buildZip, exportToLegacyJson, mapExportTable, readExport } from './backup/test-helpers'
import { MigrationService } from './migration.service'
import { ProjectService } from './project.service'
import { createRecordServices } from './record-services'
import { TaskService } from './task.service'

interface Env {
  dir: string
  db: Database
  service: BackupService
  records: ReturnType<typeof createRecordServices>
  projects: ProjectService
  tasks: TaskService
  taskRepo: TaskRepository
  clients: ClientRepository
}

function createEnv(name: string): Env {
  const dir = createWorkDir('unit', `jimuhub-bkt-${name}`)
  const dbFile = join(dir, 'data.sqlite')
  const documentsDir = join(dir, 'documents')
  const db = new Database(dbFile)
  db.initialize()
  const clients = new ClientRepository(db)
  const projectRepo = new ProjectRepository(db)
  const taskRepo = new TaskRepository(db)
  return {
    dir,
    db,
    clients,
    taskRepo,
    service: new BackupService({
      database: db,
      clientRepository: clients,
      migrationService: new MigrationService(),
      dbFilePath: dbFile,
      backupsDir: join(dir, 'backups'),
      documentsDir,
      appVersion: '0.4.0'
    }),
    records: createRecordServices(db, documentsDir),
    projects: new ProjectService(db, projectRepo, new ProjectSummaryRepository(db), taskRepo),
    tasks: new TaskService(db, taskRepo, projectRepo)
  }
}

const taskRows = (env: Env): Array<Record<string, unknown>> =>
  env.db.sqlite
    .prepare(
      `SELECT id, name, memo, due_date AS dueDate, project_id AS projectId, status,
              completed_at AS completedAt, created_at AS createdAt, updated_at AS updatedAt
       FROM tasks ORDER BY id`
    )
    .all() as Array<Record<string, unknown>>

describe('BackupService: タスクのエクスポート・復元(F-39。詳細設計書4.2・4.3章、4.39章)', () => {
  let src: Env
  let dst: Env
  let zipPath: string

  beforeEach(() => {
    src = createEnv('src')
    dst = createEnv('dst')
    zipPath = join(src.dir, 'export.zip')
  })
  afterEach(() => {
    src.db.close()
    dst.db.close()
    rmSync(src.dir, { recursive: true, force: true })
    rmSync(dst.dir, { recursive: true, force: true })
  })

  /** 案件1件と、案件に紐づく未完了・完了のタスク、案件なしのタスクを作る */
  function seed(): { projectId: number } {
    const projectId = src.projects.createProject({
      name: '案件A',
      clientId: null,
      startDate: '',
      endDate: '',
      memo: ''
    }).id
    const a = src.tasks.createTask({
      name: '案件のタスク',
      memo: 'メモ',
      dueDate: '2026-11-30',
      projectId
    })
    src.tasks.createTask({ name: '案件なし', dueDate: '', memo: '', projectId: null })
    src.tasks.completeTask(a.id)
    return { projectId }
  }

  it('エクスポート: スキーマバージョン6で、manifestとJSON Linesにタスクを含める', async () => {
    const { projectId } = seed()
    expect((await src.service.exportData(zipPath)).success).toBe(true)

    const exported = readExport(zipPath)
    expect(exported.manifest.schemaVersion).toBe(6)
    expect(exported.manifest.tables.tasks).toEqual({ file: 'data/tasks.jsonl', count: 2 })
    const rows = exported.records('tasks')
    expect(rows[0]).toEqual({
      id: 1,
      name: '案件のタスク',
      memo: 'メモ',
      dueDate: '2026-11-30',
      projectId,
      status: 'done',
      completedAt: expect.any(String),
      createdAt: expect.any(String),
      updatedAt: expect.any(String)
    })
    expect(rows[1]).toMatchObject({
      name: '案件なし',
      projectId: null,
      status: 'open',
      completedAt: null
    })
  })

  it('往復: タスク(案件との紐づけ・完了日時を含む)がIDを保ったまま同じ内容で戻る', async () => {
    seed()
    const before = taskRows(src)
    await src.service.exportData(zipPath)

    const result = await dst.service.importData(zipPath)

    expect(result).toMatchObject({ success: true, projectLinkFixCount: 0 })
    expect(taskRows(dst)).toEqual(before)
    // 復元後に、復元前と同じ案件の紐づけが有効(外部キー)で、採番も続けられる
    const created = dst.tasks.createTask({ name: '復元後', memo: '', dueDate: '', projectId: null })
    expect(created.id).toBe(before.length + 1)
  })

  it('復元で、現在のタスクはすべて置き換わる', async () => {
    seed()
    await src.service.exportData(zipPath)
    dst.tasks.createTask({ name: '消えるタスク', memo: '', dueDate: '', projectId: null })

    await dst.service.importData(zipPath)

    expect(taskRows(dst).map((r) => r.name)).toEqual(['案件のタスク', '案件なし'])
  })

  it('大量のタスク(500件のページをまたぐ件数)も、欠けずに往復できる', async () => {
    for (let i = 0; i < 1203; i += 1) {
      src.taskRepo.insert(
        { name: `タスク${i}`, memo: null, dueDate: null, projectId: null },
        '2026-10-01T00:00:00.000Z'
      )
    }
    await src.service.exportData(zipPath)
    expect(readExport(zipPath).manifest.tables.tasks?.count).toBe(1203)

    expect((await dst.service.importData(zipPath)).success).toBe(true)
    expect(taskRows(dst)).toHaveLength(1203)
    expect(taskRows(dst)[1202]).toMatchObject({ id: 1203, name: 'タスク1202' })
  })

  it('存在しない案件を指すタスクは「案件なし」に補正し、件数を完了メッセージの件数に含める', async () => {
    const { projectId } = seed()
    await src.service.exportData(zipPath)
    mapExportTable(zipPath, 'tasks', (row) =>
      row.projectId === projectId ? { ...row, projectId: 999 } : row
    )

    const result = await dst.service.importData(zipPath)

    expect(result).toMatchObject({ success: true, projectLinkFixCount: 1 })
    expect(taskRows(dst).map((r) => r.projectId)).toEqual([null, null])
    expect(BACKUP_MESSAGES.importSuccess(2, 0, 0, 0, 1)).toContain('案件への紐づけ1件')
  })

  it('statusとcompletedAtが整合しない行は、statusを正として補正する', async () => {
    seed()
    await src.service.exportData(zipPath)
    mapExportTable(
      zipPath,
      'tasks',
      (row) =>
        row.status === 'done'
          ? { ...row, completedAt: null } // 完了なのに完了日時が無い → updatedAtを設定
          : { ...row, completedAt: '2026-10-05T00:00:00.000Z' } // 未完了なのに完了日時がある → null
    )

    const result = await dst.service.importData(zipPath)

    expect(result.success).toBe(true)
    const rows = taskRows(dst)
    expect(rows[0]).toMatchObject({ status: 'done', completedAt: rows[0]?.updatedAt })
    expect(rows[1]).toMatchObject({ status: 'open', completedAt: null })
  })

  it('statusがopen・done以外の行は復元を中断し、現在のデータ(タスク含む)は変わらない', async () => {
    seed()
    await src.service.exportData(zipPath)
    mapExportTable(zipPath, 'tasks', (row) => ({ ...row, status: 'archived' }))
    dst.tasks.createTask({ name: '現在のタスク', memo: '', dueDate: '', projectId: null })

    const result = await dst.service.importData(zipPath)

    expect(result.success).toBe(false)
    expect(result.error).toBe(BACKUP_MESSAGES.importInvalidTask)
    expect(taskRows(dst).map((r) => r.name)).toEqual(['現在のタスク'])
  })

  describe('不正なタスクの行は、復元を中止する(I4-04・★R6。現在のデータは変わらない)', () => {
    const tamper = async (
      map: (row: Record<string, unknown>) => Record<string, unknown>
    ): Promise<ReturnType<typeof dst.service.importData>> => {
      seed()
      await src.service.exportData(zipPath)
      mapExportTable(zipPath, 'tasks', map)
      dst.tasks.createTask({ name: '現在のタスク', memo: '', dueDate: '', projectId: null })
      return dst.service.importData(zipPath)
    }
    const expectAborted = (result: { success: boolean; error?: string }): void => {
      expect(result.success).toBe(false)
      expect(result.error).toBe(BACKUP_MESSAGES.importInvalidTask)
      expect(taskRows(dst).map((r) => r.name)).toEqual(['現在のタスク'])
    }

    const cases: Array<[string, (row: Record<string, unknown>) => Record<string, unknown>]> = [
      ['nameが空', (row) => ({ ...row, name: '' })],
      ['nameが空白のみ', (row) => ({ ...row, name: '   ' })],
      ['nameが101文字', (row) => ({ ...row, name: 'あ'.repeat(101) })],
      ['nameが数値', (row) => ({ ...row, name: 123 })],
      ['nameがnull', (row) => ({ ...row, name: null })],
      [
        'nameが欠落',
        (row) => {
          const copy = { ...row }
          delete copy.name
          return copy
        }
      ],
      ['memoが1001文字', (row) => ({ ...row, memo: 'あ'.repeat(1001) })],
      ['dueDateが日付でない文字列', (row) => ({ ...row, dueDate: 'そのうち' })],
      ['dueDateが存在しない日付', (row) => ({ ...row, dueDate: '2026-02-30' })]
    ]
    for (const [label, map] of cases) {
      it(`${label}の場合は復元を中止し、専用の文言を表示する`, async () => {
        expectAborted(await tamper(map))
      })
    }

    it('境界の値(nameが100文字・memoが1000文字・dueDateがnullまたは実在日)は復元できる', async () => {
      seed()
      await src.service.exportData(zipPath)
      mapExportTable(zipPath, 'tasks', (row, i) =>
        i === 0
          ? { ...row, name: 'あ'.repeat(100), memo: 'あ'.repeat(1000), dueDate: '2026-12-31' }
          : { ...row, dueDate: null, memo: null }
      )
      expect((await dst.service.importData(zipPath)).success).toBe(true)
      const rows = taskRows(dst)
      expect(rows[0]).toMatchObject({ dueDate: '2026-12-31' })
      expect(rows[1]).toMatchObject({ dueDate: null, memo: null })
    })
  })

  it('スキーマバージョン5のバックアップ(tasksなし)を復元すると、タスクは空になる', async () => {
    seed()
    await src.service.exportData(zipPath)
    // manifestをスキーマバージョン5・tasksなしの形に書き換える(旧版が作ったファイルの再現)
    const exported = readExport(zipPath)
    const manifest = { ...exported.manifest, schemaVersion: 5 }
    delete manifest.tables.tasks
    const entries: Record<string, Buffer | string> = {}
    for (const [name, content] of exported.entries) {
      if (name === 'manifest.json' || name === 'data/tasks.jsonl') continue
      entries[name] = content
    }
    entries['manifest.json'] = JSON.stringify(manifest)
    const v5Path = join(src.dir, 'v5.zip')
    buildZip(v5Path, entries)
    dst.tasks.createTask({ name: '現在のタスク', memo: '', dueDate: '', projectId: null })

    const result = await dst.service.importData(v5Path)

    expect(result.success).toBe(true)
    expect(taskRows(dst)).toEqual([])
  })

  it('従来形式(data.json。スキーマバージョン4)・旧形式のJSON単体の復元でも、タスクは空になる', async () => {
    seed()
    await src.service.exportData(zipPath)
    const legacy = exportToLegacyJson(zipPath, 4) as { data: Record<string, unknown> }
    delete legacy.data.tasks
    const legacyPath = join(dst.dir, 'legacy.json')
    writeFileSync(legacyPath, JSON.stringify(legacy))
    dst.tasks.createTask({ name: '現在のタスク', memo: '', dueDate: '', projectId: null })

    expect((await dst.service.importData(legacyPath)).success).toBe(true)
    expect(taskRows(dst)).toEqual([])
  })

  it('スキーマバージョン7(より新しい版)は復元できない(現在のタスクは変わらない)', async () => {
    seed()
    await src.service.exportData(zipPath)
    const exported = readExport(zipPath)
    const entries: Record<string, Buffer | string> = {}
    for (const [name, content] of exported.entries) entries[name] = content
    entries['manifest.json'] = JSON.stringify({ ...exported.manifest, schemaVersion: 7 })
    const path = join(src.dir, 'v7.zip')
    buildZip(path, entries)
    dst.tasks.createTask({ name: '現在のタスク', memo: '', dueDate: '', projectId: null })

    expect((await dst.service.importData(path)).success).toBe(false)
    expect(taskRows(dst).map((r) => r.name)).toEqual(['現在のタスク'])
  })

  it('タスクは書類のPDFハッシュ・記録ハッシュに影響しない(復元後の照合が不一致にならない)', async () => {
    const { projectId } = seed()
    const accountId = (
      src.db.sqlite.prepare('SELECT id FROM accounts LIMIT 1').get() as { id: number }
    ).id
    src.records.cashRecordService.createRecord({
      kind: 'expense',
      recordDate: '2026-09-28',
      amount: 1000,
      accountId,
      description: '交通費',
      clientId: null,
      paymentMethod: null,
      taxCategory: null,
      projectId
    })
    const hashes = (env: Env): unknown =>
      env.db.sqlite.prepare('SELECT id, record_hash FROM cash_records ORDER BY id').all()
    const before = hashes(src)
    // タスクの追加・変更・削除の前後でハッシュが変わらない
    const extra = src.tasks.createTask({ name: '追加', memo: '', dueDate: '', projectId })
    src.tasks.updateTask(extra.id, { name: '変更', memo: '', dueDate: '', projectId })
    src.tasks.deleteTask(extra.id)
    expect(hashes(src)).toEqual(before)

    await src.service.exportData(zipPath)
    const result = await dst.service.importData(zipPath)

    expect(result).toMatchObject({ success: true, recordHashMismatchCount: 0 })
    expect(hashes(dst)).toEqual(before)
  })
})
