import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { Database } from '../db/db'
import { ClientRepository } from '../repositories/client.repository'
import { MigrationService } from './migration.service'
import { BackupService, type ExportDataResult, type ImportDataResult } from './backup.service'
import { BACKUP_MESSAGES } from '@shared/messages/messages'

export interface StartupRecoveryDeps {
  dbFilePath: string
  backupsDir: string
  documentsDir: string
  appVersion: string
}

const DB_SIDE_FILES = ['', '-wal', '-shm']

/**
 * 起動エラー画面(データベースを開けない状態)からのデータ復元を担うService層。
 * 参照元: 詳細設計書 4.9章(F-09)、4.3章(F-03)
 *
 * 破損したDBファイルは削除せず`backups/`へ退避した上で、新しいDBを初期化し、通常の復元処理
 * (`BackupService.importData`。ZIP形式・旧JSON形式の双方に対応)を実行する。
 * 復元に失敗した場合は、退避した元のDBファイルを元の場所へ戻し、再度ファイルを選び直せる状態を維持する。
 * 復元成功後は、アプリの再起動(新しいDBでの通常起動)が必要。
 */
export class StartupRecoveryService {
  constructor(private readonly deps: StartupRecoveryDeps) {}

  /** 起動エラー画面ではエクスポート(書き出し)は行えない */
  exportData(): ExportDataResult {
    return { success: false, error: BACKUP_MESSAGES.exportFailure }
  }

  importData(filePath: string): ImportDataResult {
    const { dbFilePath, backupsDir } = this.deps
    mkdirSync(backupsDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const movedAside = DB_SIDE_FILES.map((suffix) => ({
      original: `${dbFilePath}${suffix}`,
      aside: join(backupsDir, `corrupt_data_${stamp}.sqlite${suffix}`)
    })).filter((entry) => existsSync(entry.original))

    try {
      for (const entry of movedAside) {
        renameSync(entry.original, entry.aside)
      }
    } catch {
      this.putBack(movedAside)
      return { success: false, error: BACKUP_MESSAGES.importTransactionFailure }
    }

    let database: Database | null = null
    try {
      database = new Database(dbFilePath)
      database.initialize()
      const service = new BackupService({
        database,
        clientRepository: new ClientRepository(database),
        migrationService: new MigrationService(),
        dbFilePath,
        backupsDir,
        documentsDir: this.deps.documentsDir,
        appVersion: this.deps.appVersion
      })
      const result = service.importData(filePath)
      database.close()
      database = null
      if (!result.success) {
        this.putBack(movedAside)
      }
      return result
    } catch {
      database?.close()
      this.putBack(movedAside)
      return { success: false, error: BACKUP_MESSAGES.importTransactionFailure }
    }
  }

  /** 退避した元のDBファイルを元の場所へ戻す(新しく作成したDBファイルは上書きされる) */
  private putBack(entries: Array<{ original: string; aside: string }>): void {
    for (const entry of entries) {
      try {
        if (existsSync(entry.aside)) {
          renameSync(entry.aside, entry.original)
        }
      } catch {
        // 戻せなかった場合も退避先(backups/)にファイルは残る
      }
    }
  }
}
