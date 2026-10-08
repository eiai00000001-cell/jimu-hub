import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Database, CURRENT_SCHEMA_VERSION } from './db/db'
import { DbPreMigrationBackup } from './services/db-pre-migration-backup'
import { AppMetaRepository } from './repositories/app-meta.repository'
import { MigrationService } from './services/migration.service'
import { DB_MIGRATION_MESSAGES, STARTUP_MESSAGES } from '@shared/messages/messages'
import type { StartupStatus } from '@shared/ipc/api'

export interface StartupResult {
  status: StartupStatus
  /** 初期化に成功した場合のみDatabaseインスタンスを返す。失敗時はnull(呼び出し元はclients:*・data:*のIPCハンドラを登録しない) */
  database: Database | null
}

/**
 * データベース接続の初期化・テーブル作成を行い、起動処理の結果を返す。
 *
 * `new Database(dbFilePath)`のコンストラクタ内(`db.ts`の`openConnection()`が同期的に呼ぶ`pragma()`等)で
 * 例外が発生するケース(データベースファイル破損・読み込み権限なし等)を含めて、この関数の中でtry/catchする。
 * 例外を外へ投げず、常に`StartupResult`を返すことで、呼び出し元(main/index.ts)が
 * データベース接続失敗時にもウィンドウ生成処理まで確実に到達できるようにする
 * (BUG-01修正: 従来は`new Database()`がtry/catchの外側にあり、例外発生時に
 * `app.whenReady().then()`のコールバック全体が中断し、ウィンドウが一度も表示されなかった)。
 *
 * `new Database()`(コンストラクタ)自体は成功したが、続く`database.initialize()`
 * (`CREATE TABLE`等)が失敗するケースもあり得るため、その場合は開いたSQLite接続を
 * `close()`してからエラー状態を返す(レビュー結果報告書 v0.2 No.13: ハンドルリーク修正)。
 *
 * 既存のデータベースの`schema_version`が現行より小さい場合は、移行の前に`backupsDir`へ退避する。
 * 退避に失敗した場合は、データベースを変更せず(移行せず)、起動エラーを返す(詳細設計書4.1章手順0-3)。
 *
 * 参照元: 詳細設計書4.1章手順0-3・1・2・5、8章(エラーハンドリング設計)
 */
export function initializeStartup(
  dbFilePath: string,
  backupsDir: string = join(dirname(dbFilePath), 'backups')
): StartupResult {
  let database: Database | null = null
  try {
    const existed = existsSync(dbFilePath)
    database = new Database(dbFilePath)
    const storedBefore = existed ? readSchemaVersion(database) : null
    if (storedBefore !== null && storedBefore < CURRENT_SCHEMA_VERSION) {
      try {
        new DbPreMigrationBackup(backupsDir).create(database, storedBefore)
      } catch (error) {
        console.error('移行前の退避に失敗しました', error)
        database.close()
        return {
          status: { ok: false, message: DB_MIGRATION_MESSAGES.preBackupFailure },
          database: null
        }
      }
    }
    database.initialize()

    // schema_versionが現行バージョンより小さい場合(既存インストールからの起動)は、
    // MigrationService.applyMigrations()で不足しているカラムを追加し、schema_versionを更新する
    // (詳細設計書4.1章手順2)。
    const appMetaRepository = new AppMetaRepository(database)
    const storedVersion = appMetaRepository.get('schema_version')
    const fromVersion = storedVersion ? Number(storedVersion) : CURRENT_SCHEMA_VERSION
    if (fromVersion < CURRENT_SCHEMA_VERSION) {
      new MigrationService().applyMigrations(database, fromVersion)
    }

    return { status: { ok: true }, database }
  } catch (error) {
    console.error('データベース初期化に失敗しました', error)
    database?.close()
    return { status: { ok: false, message: STARTUP_MESSAGES.databaseError }, database: null }
  }
}

/** 既存のデータベースの`schema_version`を取得する(`app_meta`が無い場合はnull) */
function readSchemaVersion(database: Database): number | null {
  try {
    const row = database.sqlite
      .prepare("SELECT value FROM app_meta WHERE key = 'schema_version'")
      .get() as { value: string } | undefined
    return row ? Number(row.value) : null
  } catch {
    return null
  }
}
