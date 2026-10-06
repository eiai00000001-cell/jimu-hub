import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { BackupRow } from '@shared/backup/backup-file'
import { jsonlEntryName } from './jsonl-table-writer'
import { JsonlTableReader } from './jsonl-table-reader'
import type { LegacyJsonRecordSource } from './legacy-record-source'

/** `manifest.json`(スキーマバージョン5以降)の構造。詳細設計書4.2章 */
export const ManifestSchema = z.object({
  format: z.literal('jimuhub-backup'),
  schemaVersion: z.number().int(),
  appVersion: z.string(),
  exportedAt: z.string(),
  tables: z.record(z.string(), z.object({ file: z.string(), count: z.number().int().min(0) }))
})
export type Manifest = z.infer<typeof ManifestSchema>

/** テーブルごとのレコードを、1件ずつ同期で渡す入力(新形式=JSON Lines、従来形式=`data.json`) */
export interface RecordSource {
  /** @returns 読み込んだレコード数 */
  readSync(tableName: string, onRecord: (record: BackupRow) => void): number
}

export class JsonlRecordSource implements RecordSource {
  private readonly reader = new JsonlTableReader()

  constructor(private readonly stagingDir: string) {}

  readSync(tableName: string, onRecord: (record: BackupRow) => void): number {
    const path = join(this.stagingDir, jsonlEntryName(tableName))
    // ファイルが無いテーブルは0件として扱う(案件の無い版のバックアップ等)
    if (!existsSync(path)) return 0
    return this.reader.readSync(path, onRecord)
  }
}

export class LegacyRecordSourceAdapter implements RecordSource {
  constructor(private readonly legacy: LegacyJsonRecordSource) {}

  readSync(tableName: string, onRecord: (record: BackupRow) => void): number {
    const records = this.legacy.records(tableName)
    for (const record of records) onRecord(record)
    return records.length
  }
}
