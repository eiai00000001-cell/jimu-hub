import { CURRENT_SCHEMA_VERSION, type BackupFile } from '@shared/backup/backup-file'
import { CURRENT_SCHEMA_VERSION as CURRENT_DB_SCHEMA_VERSION } from '../db/db'
import type { Database } from '../db/db'

/**
 * データベース・エクスポートデータのスキーマバージョン差異を吸収するApplication Service層。
 * 参照元: 詳細設計書 4.1章手順2、4.3章手順4、5章(クラス設計 `MigrationService`)、6章
 *
 * `migrateExportData()`はエクスポートファイル(JSON)のマイグレーションを、`applyMigrations()`は
 * データベース自体のマイグレーション(既存インストールへの`ALTER TABLE`適用)を担う。
 */
export class MigrationService {
  /**
   * エクスポートファイルのデータを、現行スキーマバージョンの構造へ変換する(詳細設計書4.3章手順4)。
   * 省略可能なテーブル(自社情報・見積書・請求書等)はスキーマ検証時に空/なしで補われているため、
   * ここでは旧バージョンに存在しない項目(schemaVersion 2以前のpdfHashMismatch)を既定値で補う。
   * schemaVersion 1のファイルは取引先のみを持ち、furiganaは省略(null扱い)される。
   */
  migrateExportData(data: BackupFile, fromVersion: number): BackupFile {
    if (fromVersion >= CURRENT_SCHEMA_VERSION) {
      return data
    }
    const withMismatchDefault = (
      rows: BackupFile['data']['quotes']
    ): BackupFile['data']['quotes'] => rows.map((row) => ({ pdfHashMismatch: false, ...row }))
    return {
      ...data,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      data: {
        ...data.data,
        quotes: withMismatchDefault(data.data.quotes),
        invoices: withMismatchDefault(data.data.invoices)
      }
    }
  }

  /**
   * 既存インストールのデータベースを、現行のスキーマバージョン(`CURRENT_SCHEMA_VERSION`)まで移行する。
   * 新規テーブルは`Database.initialize()`が`CREATE TABLE IF NOT EXISTS`で作成済みである前提のもと、
   * 既存テーブルへの列追加(`ALTER TABLE`)のみを本メソッドで行う(詳細設計書4.1章手順2)。
   */
  applyMigrations(database: Database, fromVersion: number): void {
    if (fromVersion < 2) {
      // schema_version 1→2: clients.furigana列の追加(詳細設計書6.1章)。
      // Database.initialize()は列がまだ無い時点ではインデックスを作成しないため、
      // 列追加後にあらためてインデックスを作成する(db.ts参照)。
      this.addColumnIfMissing(database, 'clients', 'furigana', 'TEXT')
      database.sqlite.exec('CREATE INDEX IF NOT EXISTS idx_clients_furigana ON clients (furigana)')
    }
    if (fromVersion < 3) {
      // schema_version 2→3: quotes・invoices.pdf_hash_mismatch列の追加(詳細設計書6.5・6.7章)。
      // quotes/invoicesが本イテレーションでの新規テーブルの場合はDatabase.initialize()で
      // 列込みで作成済みのため、本処理は実質的に何もしない(冪等な安全策)。
      this.addColumnIfMissing(database, 'quotes', 'pdf_hash_mismatch', 'INTEGER NOT NULL DEFAULT 0')
      this.addColumnIfMissing(
        database,
        'invoices',
        'pdf_hash_mismatch',
        'INTEGER NOT NULL DEFAULT 0'
      )
    }

    database.sqlite
      .prepare(
        "INSERT INTO app_meta (key, value) VALUES ('schema_version', ?) " +
          'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      )
      .run(String(CURRENT_DB_SCHEMA_VERSION))
  }

  private addColumnIfMissing(
    database: Database,
    table: string,
    column: string,
    definition: string
  ): void {
    if (!database.hasColumn(table, column)) {
      database.sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    }
  }
}
