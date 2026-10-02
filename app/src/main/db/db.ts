import SqliteDatabase from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

/**
 * データベース・エクスポートファイルのスキーマバージョン(app_meta.schema_version)。
 * イテレーション1(v1.3)時点の最新値。参照元: 詳細設計書6章冒頭、4.1章手順2。
 *
 * `@shared/backup/backup-file`にも同名の`CURRENT_SCHEMA_VERSION`(エクスポートファイルの対応バージョン)が
 * あり、両者は同じ値(現在3)に保つこと。
 */
export const CURRENT_SCHEMA_VERSION = 3

const CREATE_CLIENTS_TABLE = `
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  furigana TEXT,
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

const CREATE_CLIENTS_FURIGANA_INDEX = `
CREATE INDEX IF NOT EXISTS idx_clients_furigana ON clients (furigana);
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

const CREATE_COMPANY_PROFILE_TABLE = `
CREATE TABLE IF NOT EXISTS company_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  invoice_registration_number TEXT,
  bank_name TEXT,
  bank_branch TEXT,
  account_type TEXT CHECK (account_type IN ('普通', '当座')),
  account_number TEXT,
  account_holder TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
`

const CREATE_DOCUMENT_NUMBER_SEQUENCES_TABLE = `
CREATE TABLE IF NOT EXISTS document_number_sequences (
  year INTEGER NOT NULL,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('quote', 'invoice')),
  last_number INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (year, doc_type)
);
`

const CREATE_QUOTES_TABLE = `
CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_number TEXT UNIQUE,
  client_id INTEGER NOT NULL REFERENCES clients (id),
  issue_date TEXT NOT NULL,
  valid_until TEXT,
  remarks TEXT,
  subtotal_10 INTEGER NOT NULL DEFAULT 0,
  tax_amount_10 INTEGER NOT NULL DEFAULT 0,
  subtotal_8 INTEGER NOT NULL DEFAULT 0,
  tax_amount_8 INTEGER NOT NULL DEFAULT 0,
  total_amount INTEGER NOT NULL DEFAULT 0,
  invoice_format TEXT CHECK (invoice_format IN ('qualified', 'classified')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized')),
  pdf_path TEXT,
  pdf_hash TEXT,
  pdf_hash_mismatch INTEGER NOT NULL DEFAULT 0 CHECK (pdf_hash_mismatch IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
`

const CREATE_QUOTES_CLIENT_INDEX = `
CREATE INDEX IF NOT EXISTS idx_quotes_client ON quotes (client_id);
`

const CREATE_QUOTES_ISSUE_DATE_INDEX = `
CREATE INDEX IF NOT EXISTS idx_quotes_issue_date ON quotes (issue_date);
`

const CREATE_QUOTES_STATUS_INDEX = `
CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes (status);
`

const CREATE_QUOTE_LINE_ITEMS_TABLE = `
CREATE TABLE IF NOT EXISTS quote_line_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id INTEGER NOT NULL REFERENCES quotes (id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  name TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit TEXT,
  unit_price INTEGER NOT NULL DEFAULT 0,
  tax_rate INTEGER NOT NULL CHECK (tax_rate IN (10, 8)),
  amount INTEGER NOT NULL DEFAULT 0
);
`

const CREATE_QUOTE_LINE_ITEMS_QUOTE_INDEX = `
CREATE INDEX IF NOT EXISTS idx_quote_line_items_quote ON quote_line_items (quote_id);
`

const CREATE_INVOICES_TABLE = `
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_number TEXT UNIQUE,
  client_id INTEGER NOT NULL REFERENCES clients (id),
  source_quote_id INTEGER REFERENCES quotes (id),
  issue_date TEXT NOT NULL,
  due_date TEXT,
  remarks TEXT,
  subtotal_10 INTEGER NOT NULL DEFAULT 0,
  tax_amount_10 INTEGER NOT NULL DEFAULT 0,
  subtotal_8 INTEGER NOT NULL DEFAULT 0,
  tax_amount_8 INTEGER NOT NULL DEFAULT 0,
  total_amount INTEGER NOT NULL DEFAULT 0,
  withholding_tax_amount INTEGER NOT NULL DEFAULT 0,
  billing_amount INTEGER NOT NULL DEFAULT 0,
  invoice_format TEXT CHECK (invoice_format IN ('qualified', 'classified')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid')),
  payment_date TEXT,
  pdf_path TEXT,
  pdf_hash TEXT,
  pdf_hash_mismatch INTEGER NOT NULL DEFAULT 0 CHECK (pdf_hash_mismatch IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
`

const CREATE_INVOICES_CLIENT_INDEX = `
CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices (client_id);
`

const CREATE_INVOICES_ISSUE_DATE_INDEX = `
CREATE INDEX IF NOT EXISTS idx_invoices_issue_date ON invoices (issue_date);
`

const CREATE_INVOICES_STATUS_INDEX = `
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices (status);
`

const CREATE_INVOICES_PAYMENT_STATUS_INDEX = `
CREATE INDEX IF NOT EXISTS idx_invoices_payment_status ON invoices (payment_status);
`

const CREATE_INVOICE_LINE_ITEMS_TABLE = `
CREATE TABLE IF NOT EXISTS invoice_line_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  name TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit TEXT,
  unit_price INTEGER NOT NULL DEFAULT 0,
  tax_rate INTEGER NOT NULL CHECK (tax_rate IN (10, 8)),
  amount INTEGER NOT NULL DEFAULT 0,
  withholding_target INTEGER NOT NULL DEFAULT 0 CHECK (withholding_target IN (0, 1)),
  withholding_amount INTEGER NOT NULL DEFAULT 0
);
`

const CREATE_INVOICE_LINE_ITEMS_INVOICE_INDEX = `
CREATE INDEX IF NOT EXISTS idx_invoice_line_items_invoice ON invoice_line_items (invoice_id);
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

  /**
   * データベースファイルが存在しない場合の新規作成・テーブル作成を行う(詳細設計書4.1章手順1〜2、6章)。
   * 全テーブルを最新の定義(`CREATE TABLE IF NOT EXISTS`)で作成するため、既存テーブルには影響しない。
   * 既存インストール(iteration0以前)で不足しているカラム(`clients.furigana`等)の追加は、
   * 本メソッドではなく`MigrationService.applyMigrations()`が担う(startup.ts参照)。
   * `idx_clients_furigana`インデックスのみ、`furigana`列が存在する場合に限り作成する
   * (既存インストールでは本メソッドが`applyMigrations()`より先に実行されるため、
   * 列がまだ存在しない状態でインデックスを作成しようとしてエラーになるのを避ける。
   * `applyMigrations()`側で列追加後にあらためてインデックスを作成する)。
   */
  initialize(): void {
    this.sqlite.exec(CREATE_CLIENTS_TABLE)
    this.sqlite.exec(CREATE_CLIENTS_NAME_INDEX)
    if (this.hasColumn('clients', 'furigana')) {
      this.sqlite.exec(CREATE_CLIENTS_FURIGANA_INDEX)
    }
    this.sqlite.exec(CREATE_CLIENTS_STATUS_INDEX)
    this.sqlite.exec(CREATE_APP_META_TABLE)
    this.sqlite.exec(CREATE_COMPANY_PROFILE_TABLE)
    this.sqlite.exec(CREATE_DOCUMENT_NUMBER_SEQUENCES_TABLE)
    this.sqlite.exec(CREATE_QUOTES_TABLE)
    this.sqlite.exec(CREATE_QUOTES_CLIENT_INDEX)
    this.sqlite.exec(CREATE_QUOTES_ISSUE_DATE_INDEX)
    this.sqlite.exec(CREATE_QUOTES_STATUS_INDEX)
    this.sqlite.exec(CREATE_QUOTE_LINE_ITEMS_TABLE)
    this.sqlite.exec(CREATE_QUOTE_LINE_ITEMS_QUOTE_INDEX)
    this.sqlite.exec(CREATE_INVOICES_TABLE)
    this.sqlite.exec(CREATE_INVOICES_CLIENT_INDEX)
    this.sqlite.exec(CREATE_INVOICES_ISSUE_DATE_INDEX)
    this.sqlite.exec(CREATE_INVOICES_STATUS_INDEX)
    this.sqlite.exec(CREATE_INVOICES_PAYMENT_STATUS_INDEX)
    this.sqlite.exec(CREATE_INVOICE_LINE_ITEMS_TABLE)
    this.sqlite.exec(CREATE_INVOICE_LINE_ITEMS_INVOICE_INDEX)

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

  /** 指定したテーブルに指定した列が存在するかどうかを調べる(`MigrationService`からも利用) */
  hasColumn(table: string, column: string): boolean {
    const columns = this.sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string
    }>
    return columns.some((c) => c.name === column)
  }

  close(): void {
    this.sqlite.close()
  }
}
