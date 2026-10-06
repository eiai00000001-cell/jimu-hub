import type { BackupFile, BackupRow } from '@shared/backup/backup-file'

/**
 * 従来形式(`data.json`1本。スキーマバージョン4以前)のレコードを、JSON Linesと同じ形(テーブル名→レコード)で供給する。
 * 参照元: 詳細設計書4.3章手順3・6
 */
export class LegacyJsonRecordSource {
  constructor(private readonly backup: BackupFile) {}

  /** @param tableName manifestの`tables`と同じキー(`clients`・`companyProfile`等) */
  records(tableName: string): readonly BackupRow[] {
    const data = this.backup.data as Record<string, unknown>
    const value = data[tableName]
    if (tableName === 'companyProfile') {
      return value ? [value as BackupRow] : []
    }
    return Array.isArray(value) ? (value as BackupRow[]) : []
  }
}
