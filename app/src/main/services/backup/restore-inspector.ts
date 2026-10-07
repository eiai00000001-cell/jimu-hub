import { basename } from 'node:path'
import { statSync, openSync, readSync, closeSync, readFileSync } from 'node:fs'
import { BackupFileSchema, CURRENT_SCHEMA_VERSION } from '@shared/backup/backup-file'
import type { BackupInspection } from '@shared/ipc/api'
import type { Database } from '../../db/db'
import { BackupArchiveReader, LEGACY_DATA_ENTRY, MANIFEST_ENTRY } from './archive-reader'
import { BackupParseError, BackupSizeLimitError, BackupVersionTooNewError } from './errors'
import { ManifestSchema } from './record-source'
import type { RestoreSessionStore } from './restore-session-store'

/** 事前確認で読み込む`manifest.json`・`data.json`・JSON単体の大きさの上限(256MiB。基本設計書8.1章★31) */
const MAX_INSPECT_BYTES = 256 * 1024 * 1024

export interface RestoreInspectorDeps {
  /** 現在のデータの件数を数えるDB(読めない場合は件数0として扱う) */
  database: Database | null
  store: RestoreSessionStore
  maxFileBytes: number
  maxEntries: number
  maxTotalUncompressedBytes: number
}

/**
 * 復元ファイルの事前確認(現在のデータは変更しない。ファイル全体の展開も行わない)。
 * 参照元: 詳細設計書4.33章、5章(`RestoreInspector`)
 */
export class RestoreInspector {
  constructor(private readonly deps: RestoreInspectorDeps) {}

  /**
   * @throws BackupSizeLimitError 読み込み上限の超過
   * @throws BackupVersionTooNewError 新しい版のファイル
   * @throws BackupParseError 形式不正
   */
  async inspect(filePath: string): Promise<BackupInspection> {
    if (statSync(filePath).size > this.deps.maxFileBytes) {
      throw new BackupSizeLimitError('file too large')
    }
    const found = this.isZip(filePath)
      ? await this.inspectZip(filePath)
      : this.inspectLegacyJson(readTextWithin(filePath))
    if (found.schemaVersion > CURRENT_SCHEMA_VERSION) throw new BackupVersionTooNewError()

    const currentReceiptCount = this.count(
      'SELECT COUNT(*) AS c FROM receipts WHERE removed_at IS NULL'
    )
    const currentProjectCount = this.count('SELECT COUNT(*) AS c FROM projects')
    return {
      token: this.deps.store.register(filePath),
      fileName: basename(filePath),
      schemaVersion: found.schemaVersion,
      hasReceipts: found.hasReceipts,
      hasProjects: found.hasProjects,
      currentReceiptCount,
      currentProjectCount,
      needsConfirmation:
        (!found.hasReceipts && currentReceiptCount >= 1) ||
        (!found.hasProjects && currentProjectCount >= 1)
    }
  }

  private isZip(filePath: string): boolean {
    const fd = openSync(filePath, 'r')
    try {
      const header = Buffer.alloc(2)
      const read = readSync(fd, header, 0, 2, 0)
      return read === 2 && header[0] === 0x50 && header[1] === 0x4b
    } finally {
      closeSync(fd)
    }
  }

  private async inspectZip(
    filePath: string
  ): Promise<{ schemaVersion: number; hasReceipts: boolean; hasProjects: boolean }> {
    const reader = new BackupArchiveReader(filePath, this.deps)
    try {
      const scan = await reader.scan()
      if (scan.hasManifest) {
        let manifest
        try {
          manifest = ManifestSchema.parse(
            JSON.parse(await reader.readText(MANIFEST_ENTRY, MAX_INSPECT_BYTES))
          )
        } catch (error) {
          if (error instanceof BackupSizeLimitError) throw error
          throw new BackupParseError('invalid manifest')
        }
        return {
          schemaVersion: manifest.schemaVersion,
          hasReceipts: (manifest.tables.receipts?.count ?? 0) >= 1,
          hasProjects: (manifest.tables.projects?.count ?? 0) >= 1
        }
      }
      return this.inspectLegacyJson(await reader.readText(LEGACY_DATA_ENTRY, MAX_INSPECT_BYTES))
    } finally {
      reader.close()
    }
  }

  /** 従来形式(`data.json`・JSON単体)。領収書はスキーマバージョン4のみ、案件は常に含まれない */
  private inspectLegacyJson(text: string): {
    schemaVersion: number
    hasReceipts: boolean
    hasProjects: boolean
  } {
    let parsed: ReturnType<typeof BackupFileSchema.safeParse>
    try {
      parsed = BackupFileSchema.safeParse(JSON.parse(text))
    } catch {
      throw new BackupParseError('invalid json')
    }
    if (!parsed.success) throw new BackupParseError('invalid backup file')
    return {
      schemaVersion: parsed.data.schemaVersion,
      hasReceipts: parsed.data.schemaVersion >= 4 && parsed.data.data.receipts.length >= 1,
      hasProjects: false
    }
  }

  private count(sql: string): number {
    try {
      const row = this.deps.database?.sqlite.prepare(sql).get() as { c: number } | undefined
      return row?.c ?? 0
    } catch {
      // 読めない場合(データベースを開けない・テーブルが無い)は、現在の件数を0として扱う
      return 0
    }
  }
}

function readTextWithin(path: string): string {
  if (statSync(path).size > MAX_INSPECT_BYTES) throw new BackupSizeLimitError('file too large')
  return readFileSync(path, 'utf-8')
}
