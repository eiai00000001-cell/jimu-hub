import { describe, expect, it, afterEach, vi } from 'vitest'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import SqliteDatabase from 'better-sqlite3'
import { initializeStartup } from './startup'
import { STARTUP_MESSAGES } from '@shared/messages/messages'
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
