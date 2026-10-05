import type { Database } from '../db/db'
import { RECORD_PAGE_SIZE } from '@shared/constants/cash-record'
import type { HistoryListFilter, HistoryOperation, Paged } from '@shared/types/cash-record'

export interface HistoryRow {
  id: number
  recordId: number
  operation: HistoryOperation
  operatedAt: string
  reason: string | null
  snapshotBefore: string | null
  snapshotAfter: string
  recordHashAfter: string
}

interface RawHistoryRow {
  id: number
  record_id: number
  operation: HistoryOperation
  operated_at: string
  reason: string | null
  snapshot_before: string | null
  snapshot_after: string
  record_hash_after: string
}

function mapRow(row: RawHistoryRow): HistoryRow {
  return {
    id: row.id,
    recordId: row.record_id,
    operation: row.operation,
    operatedAt: row.operated_at,
    reason: row.reason,
    snapshotBefore: row.snapshot_before,
    snapshotAfter: row.snapshot_after,
    recordHashAfter: row.record_hash_after
  }
}

export interface HistoryInsert {
  recordId: number
  operation: HistoryOperation
  reason: string | null
  snapshotBefore: string | null
  snapshotAfter: string
  recordHashAfter: string
}

/**
 * cash_record_historyテーブルへのアクセス。追記と参照のみで、更新・削除のメソッドは設けない
 * (詳細設計書4.20章。DBのトリガーでも拒否される)。
 * 参照元: 詳細設計書5章(`CashRecordHistoryRepository`)、6.13章
 */
export class CashRecordHistoryRepository {
  constructor(private readonly database: Database) {}

  insert(entry: HistoryInsert): { id: number } {
    const result = this.database.sqlite
      .prepare(
        `INSERT INTO cash_record_history (record_id, operation, operated_at, reason, snapshot_before,
           snapshot_after, record_hash_after)
         VALUES (@recordId, @operation, @operatedAt, @reason, @snapshotBefore, @snapshotAfter, @recordHashAfter)`
      )
      .run({ ...entry, operatedAt: new Date().toISOString() })
    return { id: Number(result.lastInsertRowid) }
  }

  /** idの降順 */
  findByRecordId(recordId: number): HistoryRow[] {
    return (
      this.database.sqlite
        .prepare('SELECT * FROM cash_record_history WHERE record_id = ? ORDER BY id DESC')
        .all(recordId) as RawHistoryRow[]
    ).map(mapRow)
  }

  findLatestByRecordId(recordId: number): HistoryRow | null {
    const row = this.database.sqlite
      .prepare('SELECT * FROM cash_record_history WHERE record_id = ? ORDER BY id DESC LIMIT 1')
      .get(recordId) as RawHistoryRow | undefined
    return row ? mapRow(row) : null
  }

  /** 全記録の履歴を新しい順に返す。操作日は`operated_at`の日付部分で絞り込む */
  search(filter: HistoryListFilter): Paged<HistoryRow> {
    const conditions: string[] = []
    const params: Record<string, string | number> = {}
    if (filter.operation) {
      conditions.push('operation = @operation')
      params.operation = filter.operation
    }
    if (filter.dateFrom) {
      conditions.push("date(operated_at, 'localtime') >= @dateFrom")
      params.dateFrom = filter.dateFrom
    }
    if (filter.dateTo) {
      conditions.push("date(operated_at, 'localtime') <= @dateTo")
      params.dateTo = filter.dateTo
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const page = filter.page ?? 1
    const total = this.database.sqlite
      .prepare(`SELECT COUNT(*) AS c FROM cash_record_history ${where}`)
      .get(params) as { c: number }
    const rows = this.database.sqlite
      .prepare(
        `SELECT * FROM cash_record_history ${where}
         ORDER BY operated_at DESC, id DESC LIMIT @limit OFFSET @offset`
      )
      .all({
        ...params,
        limit: RECORD_PAGE_SIZE,
        offset: (page - 1) * RECORD_PAGE_SIZE
      }) as RawHistoryRow[]
    return {
      items: rows.map(mapRow),
      totalCount: total.c,
      page,
      pageSize: RECORD_PAGE_SIZE
    }
  }
}
