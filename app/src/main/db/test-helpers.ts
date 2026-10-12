import SqliteDatabase from 'better-sqlite3'
import { Database } from './db'

/**
 * テスト用: スキーマv4(案件の追加前)のデータベースファイルを作る。
 * 現行のテーブル定義から、案件のテーブル・`project_id`列・案件のインデックスを除いて作成し、
 * `schema_version`を`4`にする(既存インストールからの移行の再現)。
 */
export function createV4Database(path: string): void {
  const fresh = new Database(':memory:')
  fresh.initialize()
  const objects = fresh.sqlite
    .prepare(
      `SELECT sql FROM sqlite_master
       WHERE sql IS NOT NULL
         AND name NOT LIKE 'sqlite_%'
         AND tbl_name NOT IN ('projects', 'project_link_history')
         AND name NOT IN ('idx_quotes_project', 'idx_invoices_project', 'idx_cash_records_project')
       ORDER BY rowid`
    )
    .all() as Array<{ sql: string }>
  fresh.close()

  const legacy = new SqliteDatabase(path)
  for (const { sql } of objects) {
    legacy.exec(sql.replace(/\n?\s*project_id INTEGER REFERENCES projects \(id\),/g, ''))
  }
  legacy.prepare("DELETE FROM app_meta WHERE key = 'schema_version'").run()
  legacy.prepare("INSERT INTO app_meta (key, value) VALUES ('schema_version', '4')").run()
  legacy.close()
}
