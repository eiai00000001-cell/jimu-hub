import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import {
  BackupFileSchema,
  CURRENT_SCHEMA_VERSION,
  type BackupFile
} from '@shared/backup/backup-file'
import { BACKUP_MESSAGES } from '@shared/messages/messages'
import type { Database } from '../db/db'
import type { ClientRepository } from '../repositories/client.repository'
import type { MigrationService } from './migration.service'

const MAX_BACKUP_GENERATIONS = 3
const BACKUP_FILE_PREFIX = 'data_'
const BACKUP_FILE_SUFFIX = '.sqlite'

export interface ExportDataResult {
  success: boolean
  filePath?: string
  error?: string
}

export interface ImportDataResult {
  success: boolean
  importedCount?: number
  error?: string
}

export interface BackupServiceDeps {
  database: Database
  clientRepository: ClientRepository
  migrationService: MigrationService
  /** 復元前の退避コピー元とする、現行DBファイルの実パス */
  dbFilePath: string
  /** 退避コピーの保存先ディレクトリ */
  backupsDir: string
  /** エクスポートファイルに記録するアプリバージョン */
  appVersion: string
}

/**
 * エクスポート・復元の一連の処理を統括するApplication Service層。
 * 参照元: 詳細設計書 4.2章(エクスポート)・4.3章(復元)、5章(クラス設計 `BackupService`)
 */
export class BackupService {
  constructor(private readonly deps: BackupServiceDeps) {}

  exportData(filePath: string): ExportDataResult {
    try {
      const records = this.deps.clientRepository.findAllForBackup()
      const payload: BackupFile = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        appVersion: this.deps.appVersion,
        exportedAt: new Date().toISOString(),
        data: { clients: records }
      }
      writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8')
      return { success: true, filePath }
    } catch {
      return { success: false, error: BACKUP_MESSAGES.exportFailure }
    }
  }

  importData(filePath: string): ImportDataResult {
    let rawText: string
    try {
      rawText = readFileSync(filePath, 'utf-8')
    } catch {
      return { success: false, error: BACKUP_MESSAGES.importParseFailure }
    }

    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(rawText)
    } catch {
      return { success: false, error: BACKUP_MESSAGES.importParseFailure }
    }

    const validated = BackupFileSchema.safeParse(parsedJson)
    if (!validated.success) {
      return { success: false, error: BACKUP_MESSAGES.importParseFailure }
    }

    if (validated.data.schemaVersion > CURRENT_SCHEMA_VERSION) {
      return { success: false, error: BACKUP_MESSAGES.importVersionTooNew }
    }

    const backupFile =
      validated.data.schemaVersion < CURRENT_SCHEMA_VERSION
        ? this.deps.migrationService.migrate(validated.data, validated.data.schemaVersion)
        : validated.data

    this.createSafeguardCopy()

    try {
      this.deps.database.transaction(() => {
        this.deps.clientRepository.deleteAll()
        for (const record of backupFile.data.clients) {
          this.deps.clientRepository.insertWithId(record)
        }
      })
      return { success: true, importedCount: backupFile.data.clients.length }
    } catch {
      this.restoreFromLatestSafeguardCopy()
      return { success: false, error: BACKUP_MESSAGES.importTransactionFailure }
    }
  }

  /** 復元実行前に、現行DBファイルをタイムスタンプ付きで退避コピーする(詳細設計書4.3章手順5) */
  private createSafeguardCopy(): void {
    mkdirSync(this.deps.backupsDir, { recursive: true })
    // WAL上の未反映データを本体ファイルへ書き戻してからコピーする
    this.deps.database.sqlite.pragma('wal_checkpoint(FULL)')

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const uniqueSuffix = randomBytes(3).toString('hex')
    const backupPath = join(
      this.deps.backupsDir,
      `${BACKUP_FILE_PREFIX}${timestamp}-${uniqueSuffix}${BACKUP_FILE_SUFFIX}`
    )
    copyFileSync(this.deps.dbFilePath, backupPath)
    this.pruneOldBackups()
  }

  /** 直近3世代のみを保持し、それより古い世代は自動削除する(基本設計書7章) */
  private pruneOldBackups(): void {
    const files = this.listBackupFiles()
    const excess = files.length - MAX_BACKUP_GENERATIONS
    if (excess > 0) {
      for (const file of files.slice(0, excess)) {
        unlinkSync(join(this.deps.backupsDir, file))
      }
    }
  }

  private listBackupFiles(): string[] {
    if (!existsSync(this.deps.backupsDir)) {
      return []
    }
    return readdirSync(this.deps.backupsDir)
      .filter((name) => name.startsWith(BACKUP_FILE_PREFIX) && name.endsWith(BACKUP_FILE_SUFFIX))
      .sort()
  }

  /** 復元処理が失敗した場合、直近の退避コピーからDBファイルを復旧する(詳細設計書4.3章手順8) */
  private restoreFromLatestSafeguardCopy(): void {
    const files = this.listBackupFiles()
    const latest = files.at(-1)
    if (!latest) {
      return
    }
    copyFileSync(join(this.deps.backupsDir, latest), this.deps.dbFilePath)
    this.deps.database.reopen()
  }
}
