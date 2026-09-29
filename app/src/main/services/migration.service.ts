import { CURRENT_SCHEMA_VERSION, type BackupFile } from '@shared/backup/backup-file'
import { CURRENT_SCHEMA_VERSION as CURRENT_DB_SCHEMA_VERSION } from '../db/db'
import type { Database } from '../db/db'

/**
 * データベース・エクスポートデータのスキーマバージョン差異を吸収するApplication Service層。
 * 参照元: 詳細設計書 4.1章手順2、4.3章手順4、5章(クラス設計 `MigrationService`)、6章
 *
 * `migrate()`はエクスポートファイル(JSON)のマイグレーションを、`applyMigrations()`は
 * データベース自体のマイグレーション(既存インストールへの`ALTER TABLE`適用)を担う。
 * 現時点ではエクスポートファイル側のスキーマバージョンは1のみ存在するため`migrate()`は恒等関数だが、
 * DB側は本イテレーションでバージョン3まで進んでいるため`applyMigrations()`を新設した
 * (T-34でエクスポートファイル側もバージョン3に対応する際、`migrate()`にも変換処理を追加する)。
 */
export class MigrationService {
  migrate(data: BackupFile, fromVersion: number): BackupFile {
    if (fromVersion === CURRENT_SCHEMA_VERSION) {
      return data
    }
    // 将来的にfromVersion < CURRENT_SCHEMA_VERSIONの変換ステップをここに追加する。
    return data
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
