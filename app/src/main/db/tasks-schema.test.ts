import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import SqliteDatabase from 'better-sqlite3'
import { createWorkDir } from '@test-support/work-dir.mjs'
import { Database, CURRENT_SCHEMA_VERSION } from './db'
import { createV5Database } from './test-helpers'
import { initializeStartup } from '../startup'
import { DB_MIGRATION_MESSAGES } from '@shared/messages/messages'
import { MigrationService } from '../services/migration.service'
import { DbPreMigrationBackup } from '../services/db-pre-migration-backup'

/**
 * T-80-1: tasksテーブルとDBスキーマv6への移行(F-34〜F-39の基盤)。
 * 参照元: 詳細設計書6.19・6.20章、4.1章手順0-3・2
 */
const version = (sqlite: SqliteDatabase.Database): string =>
  (
    sqlite.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as {
      value: string
    }
  ).value

const tableNames = (sqlite: SqliteDatabase.Database): string[] =>
  (
    sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string
    }[]
  ).map((r) => r.name)

describe('tasksテーブル(新規作成。詳細設計書6.19章)', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.initialize()
  })
  afterEach(() => db.close())

  it('新規作成のデータベースは、schema_versionが6で、tasksが空で作成される', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(6)
    expect(version(db.sqlite)).toBe('6')
    expect(tableNames(db.sqlite)).toContain('tasks')
    expect((db.sqlite.prepare('SELECT COUNT(*) AS c FROM tasks').get() as { c: number }).c).toBe(0)
  })

  it('カラムと3つのインデックスが設計どおりに作成される', () => {
    const cols = (db.sqlite.prepare('PRAGMA table_info(tasks)').all() as { name: string }[]).map(
      (c) => c.name
    )
    expect(cols).toEqual([
      'id',
      'name',
      'memo',
      'due_date',
      'project_id',
      'status',
      'completed_at',
      'created_at',
      'updated_at'
    ])
    const indexes = (
      db.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'tasks'")
        .all() as {
        name: string
      }[]
    ).map((r) => r.name)
    for (const name of ['idx_tasks_status_due', 'idx_tasks_project', 'idx_tasks_due']) {
      expect(indexes).toContain(name)
    }
  })

  it('新規のタスクは未完了(open)で、登録日時・更新日時が入る', () => {
    db.sqlite.prepare("INSERT INTO tasks (name) VALUES ('見積書を送る')").run()
    const row = db.sqlite.prepare('SELECT * FROM tasks').get() as Record<string, unknown>
    expect(row.status).toBe('open')
    expect(row.completed_at).toBeNull()
    expect(row.project_id).toBeNull()
    expect(String(row.created_at)).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(String(row.updated_at)).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('状態と完了日時の組み合わせが不正な場合、CHECK制約で拒否する', () => {
    const insert = (status: string, completedAt: string | null): unknown =>
      db.sqlite
        .prepare('INSERT INTO tasks (name, status, completed_at) VALUES (?, ?, ?)')
        .run('t', status, completedAt)
    expect(() => insert('open', '2026-10-01T00:00:00.000Z')).toThrow()
    expect(() => insert('done', null)).toThrow()
    expect(() => insert('other', null)).toThrow()
    expect(() => insert('done', '2026-10-01T00:00:00.000Z')).not.toThrow()
  })

  it('案件への外部キーを持ち、存在しない案件は指定できない。案件を直接削除するとNULLに戻る', () => {
    expect(() =>
      db.sqlite.prepare("INSERT INTO tasks (name, project_id) VALUES ('t', 999)").run()
    ).toThrow()
    db.sqlite.prepare("INSERT INTO projects (id, name) VALUES (1, '案件A')").run()
    db.sqlite.prepare("INSERT INTO tasks (name, project_id) VALUES ('t', 1)").run()
    db.sqlite.prepare('DELETE FROM projects WHERE id = 1').run()
    const row = db.sqlite.prepare('SELECT project_id FROM tasks').get() as { project_id: unknown }
    expect(row.project_id).toBeNull()
  })

  it('更新・削除を拒否するトリガーはない(編集・削除できる)', () => {
    db.sqlite.prepare("INSERT INTO tasks (name) VALUES ('t')").run()
    db.sqlite.prepare("UPDATE tasks SET name = 'u'").run()
    db.sqlite.prepare('DELETE FROM tasks').run()
    const triggers = db.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'tasks'")
      .all()
    expect(triggers).toEqual([])
  })

  it('initialize()を繰り返しても同じ結果になる(冪等)', () => {
    db.sqlite.prepare("INSERT INTO tasks (name) VALUES ('残る')").run()
    db.initialize()
    db.initialize()
    expect((db.sqlite.prepare('SELECT COUNT(*) AS c FROM tasks').get() as { c: number }).c).toBe(1)
    expect(version(db.sqlite)).toBe('6')
  })
})

describe('DBスキーマv5→v6の移行(詳細設計書6.20章)', () => {
  let dir: string

  beforeEach(() => {
    dir = createWorkDir('unit', 'jimuhub-tasks-migrate')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function seedV5(path: string): void {
    createV5Database(path)
    const legacy = new SqliteDatabase(path)
    legacy.exec(`INSERT INTO clients (id, name, honorific) VALUES (1, '既存の取引先', '御中')`)
    legacy.exec(`INSERT INTO projects (id, name) VALUES (1, '既存の案件')`)
    legacy.close()
  }

  it('v5のデータベースを起動すると、退避してからv6へ移行し、既存のデータは変わらず、tasksは空', () => {
    const dbFilePath = join(dir, 'data.sqlite')
    seedV5(dbFilePath)
    const result = initializeStartup(dbFilePath)

    expect(result.status).toEqual({ ok: true })
    const sqlite = result.database!.sqlite
    expect(version(sqlite)).toBe('6')
    expect((sqlite.prepare('SELECT COUNT(*) AS c FROM tasks').get() as { c: number }).c).toBe(0)
    expect((sqlite.prepare('SELECT COUNT(*) AS c FROM clients').get() as { c: number }).c).toBe(1)
    expect((sqlite.prepare('SELECT COUNT(*) AS c FROM projects').get() as { c: number }).c).toBe(1)
    result.database?.close()

    const backups = readdirSync(join(dir, 'backups')).filter((n) =>
      n.startsWith('pre-migration_v5_')
    )
    expect(backups).toHaveLength(1)
    const backup = new SqliteDatabase(join(dir, 'backups', backups[0]!), { readonly: true })
    expect(version(backup)).toBe('5')
    expect(tableNames(backup)).not.toContain('tasks')
    expect((backup.prepare('SELECT COUNT(*) AS c FROM clients').get() as { c: number }).c).toBe(1)
    backup.close()
  })

  it('すでにv6のデータベースは、退避しない', () => {
    const dbFilePath = join(dir, 'data.sqlite')
    initializeStartup(dbFilePath).database?.close()
    const again = initializeStartup(dbFilePath)
    expect(again.status.ok).toBe(true)
    expect(existsSync(join(dir, 'backups'))).toBe(false)
    again.database?.close()
  })

  it('移行を2回続けて行っても同じ結果になり、2回目以降はタスクを消さない(冪等)', () => {
    const dbFilePath = join(dir, 'data.sqlite')
    seedV5(dbFilePath)
    const db = new Database(dbFilePath)
    db.initialize()
    new MigrationService().applyMigrations(db, 5)
    db.sqlite.prepare("INSERT INTO tasks (name) VALUES ('残る')").run()
    db.initialize()
    new MigrationService().applyMigrations(db, 5)
    expect(version(db.sqlite)).toBe('6')
    expect((db.sqlite.prepare('SELECT COUNT(*) AS c FROM tasks').get() as { c: number }).c).toBe(1)
    db.close()
  })

  it('途中で失敗した場合は、tasksを作らず、schema_versionは5のままで、退避ファイルが残り、起動エラーを返す', () => {
    const dbFilePath = join(dir, 'data.sqlite')
    seedV5(dbFilePath)
    // tasksのインデックス名と衝突するテーブルを作り、DDLの途中で失敗させる
    const legacy = new SqliteDatabase(dbFilePath)
    legacy.exec('CREATE TABLE idx_tasks_due (x INTEGER)')
    legacy.close()

    const result = initializeStartup(dbFilePath)
    expect(result.status.ok).toBe(false)
    expect(result.database).toBeNull()

    const after = new SqliteDatabase(dbFilePath, { readonly: true })
    expect(version(after)).toBe('5')
    expect(tableNames(after)).not.toContain('tasks')
    after.close()
    expect(
      readdirSync(join(dir, 'backups')).filter((n) => n.startsWith('pre-migration_v5_'))
    ).toHaveLength(1)
  })

  it('移行前の退避に失敗した場合は、移行せず、データベースを変更しない', () => {
    const dbFilePath = join(dir, 'data.sqlite')
    seedV5(dbFilePath)
    // backupsの位置にファイルを置き、フォルダを作れないようにして退避を失敗させる
    writeFileSync(join(dir, 'backups'), 'not a directory')

    const result = initializeStartup(dbFilePath)
    expect(result.status).toEqual({ ok: false, message: DB_MIGRATION_MESSAGES.preBackupFailure })
    const after = new SqliteDatabase(dbFilePath, { readonly: true })
    expect(version(after)).toBe('5')
    expect(tableNames(after)).not.toContain('tasks')
    after.close()
  })
})

describe('移行前の退避の世代(v4・v5を同じ「直近3世代」で扱う)', () => {
  let dir: string

  beforeEach(() => {
    dir = createWorkDir('unit', 'jimuhub-tasks-gen')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('版数によらず、新しいものから3つを残す', () => {
    const backups = join(dir, 'backups')
    const db = new Database(join(dir, 'data.sqlite'))
    db.initialize()
    const names = [
      'pre-migration_v4_2026-10-01T00-00-00-000Z.sqlite',
      'pre-migration_v5_2026-10-05T00-00-00-000Z.sqlite',
      'pre-migration_v4_2026-10-03T00-00-00-000Z.sqlite'
    ]
    const create = new DbPreMigrationBackup(backups, () => new Date('2026-10-14T00:00:00.000Z'))
    create.create(db, 5) // フォルダを作る
    for (const n of names) {
      writeFileSync(join(backups, n), '')
      utimesSync(join(backups, n), new Date(), new Date())
    }
    new DbPreMigrationBackup(backups, () => new Date('2026-10-15T00:00:00.000Z')).create(db, 5)
    const left = readdirSync(backups).sort()
    expect(left).toHaveLength(3)
    expect(left.some((n) => n.includes('2026-10-01'))).toBe(false)
    expect(left.some((n) => n.includes('2026-10-15'))).toBe(true)
    db.close()
  })
})
