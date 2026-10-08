import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest'
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import SqliteDatabase from 'better-sqlite3'
import { initializeStartup } from './startup'
import { DB_MIGRATION_MESSAGES, STARTUP_MESSAGES } from '@shared/messages/messages'
import { createV4Database } from './db/test-helpers'
import { Database, CURRENT_SCHEMA_VERSION } from './db/db'

/**
 * BUG-01(テスト結果報告書.md TC-02)の修正確認。
 * `new Database(dbFilePath)`(コンストラクタ時点の同期例外を含む)がtry/catchの外側にあったため、
 * データベースファイル破損時に起動エラー画面(app:startup-status経由)が表示されず、
 * ウィンドウ自体が表示されないまま無反応になっていた。
 * 参照元: 詳細設計書4.1章手順5・8章(エラーハンドリング設計)
 */
describe('initializeStartup', () => {
  let dir: string | undefined

  afterEach(() => {
    if (dir) {
      // chmodで読み取り不可にしたテストがあるため、削除前に権限を戻す
      chmodSync(dir, 0o700)
      rmSync(dir, { recursive: true, force: true })
      dir = undefined
    }
  })

  it('正常なデータベースファイル(新規作成)の場合、ok:trueとDatabaseインスタンスを返す', () => {
    dir = mkdtempSync(join(tmpdir(), 'jimuhub-startup-test-'))
    const dbFilePath = join(dir, 'data.sqlite')

    const result = initializeStartup(dbFilePath)

    expect(result.status).toEqual({ ok: true })
    expect(result.database).not.toBeNull()
    result.database?.close()
  })

  it('壊れたデータベースファイル(有効なSQLiteファイルではない内容)の場合、例外を投げずok:falseを返す', () => {
    dir = mkdtempSync(join(tmpdir(), 'jimuhub-startup-test-'))
    const dbFilePath = join(dir, 'data.sqlite')
    writeFileSync(dbFilePath, 'これは正しいSQLiteファイルではありません', 'utf-8')

    const result = initializeStartup(dbFilePath)

    expect(result.status).toEqual({ ok: false, message: STARTUP_MESSAGES.databaseError })
    expect(result.database).toBeNull()
  })

  it('読み込めないデータベースファイル(権限なし)の場合、例外を投げずok:falseを返す', () => {
    dir = mkdtempSync(join(tmpdir(), 'jimuhub-startup-test-'))
    const dbFilePath = join(dir, 'data.sqlite')
    writeFileSync(dbFilePath, '', 'utf-8')
    chmodSync(dbFilePath, 0o000)

    const result = initializeStartup(dbFilePath)

    expect(result.status).toEqual({ ok: false, message: STARTUP_MESSAGES.databaseError })
    expect(result.database).toBeNull()

    chmodSync(dbFilePath, 0o600)
  })

  it('iteration0(schema_version=1)の既存データベースファイルを起動すると、furigana列が追加されschema_versionが最新に更新される(詳細設計書4.1章手順2)', () => {
    dir = mkdtempSync(join(tmpdir(), 'jimuhub-startup-test-'))
    const dbFilePath = join(dir, 'data.sqlite')

    const legacyDb = new SqliteDatabase(dbFilePath)
    legacyDb.exec(`
      CREATE TABLE clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        honorific TEXT NOT NULL DEFAULT '(なし)' CHECK (honorific IN ('御中', '様', '(なし)')),
        contact_person TEXT,
        postal_code TEXT,
        address TEXT,
        phone TEXT,
        email TEXT,
        invoice_registration_number TEXT,
        memo TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE TABLE app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT INTO app_meta (key, value) VALUES ('schema_version', '1');
      INSERT INTO clients (name) VALUES ('既存の取引先');
    `)
    legacyDb.close()

    const result = initializeStartup(dbFilePath)

    expect(result.status).toEqual({ ok: true })
    const columns = result
      .database!.sqlite.prepare('PRAGMA table_info(clients)')
      .all()
      .map((row) => (row as { name: string }).name)
    expect(columns).toContain('furigana')

    const version = result
      .database!.sqlite.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'")
      .get() as { value: string }
    expect(version.value).toBe(String(CURRENT_SCHEMA_VERSION))

    const existingClient = result
      .database!.sqlite.prepare('SELECT name FROM clients WHERE name = ?')
      .get('既存の取引先')
    expect(existingClient).toBeTruthy()

    result.database?.close()
  })

  it('コンストラクタは成功したがinitialize()のみ失敗した場合、開いた接続をcloseする(レビュー結果報告書 v0.2 No.13)', () => {
    dir = mkdtempSync(join(tmpdir(), 'jimuhub-startup-test-'))
    const dbFilePath = join(dir, 'data.sqlite')

    const closeSpy = vi.spyOn(Database.prototype, 'close')
    const initializeSpy = vi.spyOn(Database.prototype, 'initialize').mockImplementation(() => {
      throw new Error('テスト用の初期化失敗(テーブル作成のみ失敗するケースを模擬)')
    })

    try {
      const result = initializeStartup(dbFilePath)

      expect(result.status).toEqual({ ok: false, message: STARTUP_MESSAGES.databaseError })
      expect(result.database).toBeNull()
      expect(closeSpy).toHaveBeenCalledTimes(1)
    } finally {
      initializeSpy.mockRestore()
      closeSpy.mockRestore()
    }
  })
})

describe('initializeStartup: スキーマv5への移行(T-63-1。詳細設計書4.1章手順0-3・6.17章)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jimuhub-migrate-test-'))
  })
  afterEach(() => {
    chmodSync(dir, 0o700)
    rmSync(dir, { recursive: true, force: true })
  })

  function seedV4(path: string): void {
    createV4Database(path)
    const legacy = new SqliteDatabase(path)
    legacy.exec(`INSERT INTO clients (id, name, honorific) VALUES (1, '既存の取引先', '御中')`)
    legacy.close()
  }

  it('v4のデータベースを起動すると、退避してからv5へ移行し、既存のデータは「案件なし」のまま残る', () => {
    const dbFilePath = join(dir, 'data.sqlite')
    seedV4(dbFilePath)

    const result = initializeStartup(dbFilePath)

    expect(result.status).toEqual({ ok: true })
    const sqlite = result.database!.sqlite
    expect(
      (
        sqlite.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as {
          value: string
        }
      ).value
    ).toBe('5')
    for (const table of ['quotes', 'invoices', 'cash_records']) {
      expect(result.database!.hasColumn(table, 'project_id')).toBe(true)
    }
    expect((sqlite.prepare('SELECT COUNT(*) AS c FROM projects').get() as { c: number }).c).toBe(0)
    expect((sqlite.prepare('SELECT COUNT(*) AS c FROM clients').get() as { c: number }).c).toBe(1)
    result.database?.close()

    // 退避ファイルは、移行前(v4)の内容
    const backups = readdirSync(join(dir, 'backups')).filter((n) =>
      n.startsWith('pre-migration_v4_')
    )
    expect(backups).toHaveLength(1)
    const backup = new SqliteDatabase(join(dir, 'backups', backups[0]!), { readonly: true })
    expect(
      (
        backup.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as {
          value: string
        }
      ).value
    ).toBe('4')
    expect(() => backup.prepare('SELECT * FROM projects').get()).toThrow()
    backup.close()
  })

  it('付け替え履歴は、更新・削除をDBのトリガーが拒否する', () => {
    const result = initializeStartup(join(dir, 'data.sqlite'))
    const sqlite = result.database!.sqlite
    sqlite.exec(
      `INSERT INTO project_link_history (target_type, target_id, target_label, kind)
       VALUES ('quote', 1, '下書き', 'assign')`
    )
    expect(() => sqlite.exec("UPDATE project_link_history SET target_label = 'x'")).toThrow(
      '付け替え履歴は変更できません'
    )
    expect(() => sqlite.exec('DELETE FROM project_link_history')).toThrow(
      '付け替え履歴は削除できません'
    )
    result.database?.close()
  })

  it('新規作成のデータベースは、退避せずにv5で作成する', () => {
    const result = initializeStartup(join(dir, 'data.sqlite'))
    expect(result.status.ok).toBe(true)
    expect(existsSync(join(dir, 'backups'))).toBe(false)
    result.database?.close()
  })

  it('すでにv5のデータベースは、退避しない', () => {
    const dbFilePath = join(dir, 'data.sqlite')
    initializeStartup(dbFilePath).database?.close()
    const again = initializeStartup(dbFilePath)
    expect(again.status.ok).toBe(true)
    expect(existsSync(join(dir, 'backups'))).toBe(false)
    again.database?.close()
  })

  it('移行前の退避に失敗した場合は、移行せず、データベースを変更せずに起動エラーを返す', () => {
    const dbFilePath = join(dir, 'data.sqlite')
    seedV4(dbFilePath)
    // backupsDirの位置に通常のファイルを置き、フォルダを作れないようにする
    writeFileSync(join(dir, 'backups'), 'not a directory')

    const result = initializeStartup(dbFilePath)

    expect(result.status).toEqual({ ok: false, message: DB_MIGRATION_MESSAGES.preBackupFailure })
    expect(result.database).toBeNull()
    const sqlite = new SqliteDatabase(dbFilePath)
    expect(
      (
        sqlite.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as {
          value: string
        }
      ).value
    ).toBe('4')
    expect(() => sqlite.prepare('SELECT * FROM projects').get()).toThrow()
    sqlite.close()
  })

  it('移行は冪等で、途中で終了した後(列の追加済み・版数は4のまま)でも再実行できる', () => {
    const dbFilePath = join(dir, 'data.sqlite')
    seedV4(dbFilePath)
    const partial = new SqliteDatabase(dbFilePath)
    partial.exec(
      'CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, client_id INTEGER, start_date TEXT, end_date TEXT, memo TEXT, status TEXT NOT NULL DEFAULT "active", created_at TEXT, updated_at TEXT)'
    )
    partial.exec('ALTER TABLE quotes ADD COLUMN project_id INTEGER REFERENCES projects (id)')
    partial.close()

    const result = initializeStartup(dbFilePath)

    expect(result.status.ok).toBe(true)
    expect(result.database!.hasColumn('invoices', 'project_id')).toBe(true)
    result.database?.close()
  })

  it('退避ファイルは直近3世代のみ保持する', () => {
    const dbFilePath = join(dir, 'data.sqlite')
    for (let i = 0; i < 5; i += 1) {
      seedV4Fresh(dbFilePath)
      initializeStartup(dbFilePath).database?.close()
    }
    const backups = readdirSync(join(dir, 'backups')).filter((n) => n.startsWith('pre-migration_'))
    expect(backups).toHaveLength(3)
  })

  function seedV4Fresh(path: string): void {
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true })
    seedV4(path)
  }
})
