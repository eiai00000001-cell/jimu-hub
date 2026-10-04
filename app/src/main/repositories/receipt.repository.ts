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

/** 保存した領収書ファイルの情報(`ReceiptService.storeFromTokens`の結果) */
export interface ReceiptInsert {
  recordId: number
  originalName: string
  filePath: string
  mimeType: string
  fileSize: number
  sha256: string
}

/**
 * receiptsテーブルへのアクセスを担うRepository層。
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

  findById(id: number): ReceiptRecord | null {
    const row = this.database.sqlite.prepare('SELECT * FROM receipts WHERE id = ?').get(id) as
      ReceiptRow | undefined
    return row ? this.map(row) : null
  }

  insert(receipt: ReceiptInsert): { id: number } {
    const result = this.database.sqlite
      .prepare(
        `INSERT INTO receipts (record_id, original_name, file_path, mime_type, file_size, sha256, attached_at)
         VALUES (@recordId, @originalName, @filePath, @mimeType, @fileSize, @sha256, @attachedAt)`
      )
      .run({ ...receipt, attachedAt: new Date().toISOString() })
    return { id: Number(result.lastInsertRowid) }
  }

  /** 記録から外す(`removed_at`を設定するだけで、ファイルは削除しない。基本設計書8.1章★E13) */
  markRemoved(id: number, removedAt: string): void {
    this.database.sqlite
      .prepare('UPDATE receipts SET removed_at = ? WHERE id = ?')
      .run(removedAt, id)
  }

  private map(row: ReceiptRow): ReceiptRecord {
    return {
      id: row.id,
      recordId: row.record_id,
      originalName: row.original_name,
      filePath: row.file_path,
      mimeType: row.mime_type,
      fileSize: row.file_size,
      sha256: row.sha256,
      attachedAt: row.attached_at,
      removedAt: row.removed_at
    }
  }
}
