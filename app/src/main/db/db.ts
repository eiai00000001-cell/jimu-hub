import SqliteDatabase from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

export const CURRENT_SCHEMA_VERSION = 1

const CREATE_CLIENTS_TABLE = `
CREATE TABLE IF NOT EXISTS clients (
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
`

const CREATE_CLIENTS_NAME_INDEX = `
CREATE INDEX IF NOT EXISTS idx_clients_name ON clients (name);
`

const CREATE_CLIENTS_STATUS_INDEX = `
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients (status);
`

const CREATE_APP_META_TABLE = `
CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

/**
 * SQLite接続の初期化・テーブル作成・トランザクション管理を担うインフラ層クラス。
 * 参照元: 詳細設計書 4.1章(アプリ起動)、5章(クラス設計 `Database`)、6章(データベース詳細設計)
 */
export class Database {
  sqlite: SqliteDatabase.Database
  orm: BetterSQLite3Database<typeof schema>
  private readonly filePath: string

  constructor(filePath: string) {
    this.filePath = filePath
    this.sqlite = Database.openConnection(filePath)
    this.orm = drizzle(this.sqlite, { schema })
  }

  private static openConnection(filePath: string): SqliteDatabase.Database {
    const connection = new SqliteDatabase(filePath)
    connection.pragma('journal_mode = WAL')
    connection.pragma('foreign_keys = ON')
    return connection
  }

  /**
   * 接続を閉じて同じファイルへ再接続する。
   * 復元処理(4.3章)で、退避コピーからDBファイルを復旧した後に呼び出し、
   * 復旧後のファイル内容を確実に読み直すために使用する。
   */
  reopen(): void {
    this.sqlite.close()
    this.sqlite = Database.openConnection(this.filePath)
    this.orm = drizzle(this.sqlite, { schema })
  }

  /** データベースファイルが存在しない場合の新規作成・テーブル作成を行う(詳細設計書4.1章手順1〜2) */
  initialize(): void {
    this.sqlite.exec(CREATE_CLIENTS_TABLE)
    this.sqlite.exec(CREATE_CLIENTS_NAME_INDEX)
    this.sqlite.exec(CREATE_CLIENTS_STATUS_INDEX)
    this.sqlite.exec(CREATE_APP_META_TABLE)

    const existing = this.sqlite
      .prepare("SELECT value FROM app_meta WHERE key = 'schema_version'")
      .get()
    if (!existing) {
      this.sqlite
        .prepare("INSERT INTO app_meta (key, value) VALUES ('schema_version', ?)")
        .run(String(CURRENT_SCHEMA_VERSION))
    }
  }

  /** トランザクション内で処理を実行する。例外発生時は自動的にロールバックする */
  transaction<T>(fn: () => T): T {
    return this.sqlite.transaction(fn)()
  }

  close(): void {
    this.sqlite.close()
  }
}
