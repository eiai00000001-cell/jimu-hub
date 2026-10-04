import type { Database } from '../db/db'
import type { ReceiptRecord } from '@shared/types/cash-record'

interface ReceiptRow {
  id: number
  record_id: number
  original_name: string
  file_path: string
  mime_type: string
  file_size: number
  sha256: string
  attached_at: string
  removed_at: string | null
}

/**
 * receiptsテーブルへのアクセスを担うRepository層。領収書の追加・外す操作(`insert`・`markRemoved`)は
 * 領収書の添付機能(F-22)の実装時に追加する。
 * 参照元: 詳細設計書5章(`ReceiptRepository`)、6.12章
 */
export class ReceiptRepository {
  constructor(private readonly database: Database) {}

  /** 外した領収書を含め、idの昇順で返す */
  findByRecordId(recordId: number): ReceiptRecord[] {
    const rows = this.database.sqlite
      .prepare('SELECT * FROM receipts WHERE record_id = ? ORDER BY id')
      .all(recordId) as ReceiptRow[]
    return rows.map((row) => ({
      id: row.id,
      recordId: row.record_id,
      originalName: row.original_name,
      filePath: row.file_path,
      mimeType: row.mime_type,
      fileSize: row.file_size,
      sha256: row.sha256,
      attachedAt: row.attached_at,
      removedAt: row.removed_at
    }))
  }
}
