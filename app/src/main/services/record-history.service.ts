import { diffSnapshots } from '@shared/history/history-differ'
import type {
  CashRecord,
  HistoryEntryView,
  HistoryListFilter,
  HistoryListItem,
  HistoryOperation,
  Paged,
  RecordSnapshot,
  ReceiptRecord
} from '@shared/types/cash-record'
import type {
  CashRecordHistoryRepository,
  HistoryRow
} from '../repositories/cash-record-history.repository'
import type { RecordNames } from '../repositories/cash-record.repository'

export interface HistoryRecordEntry {
  recordId: number
  operation: HistoryOperation
  reason: string | null
  before: RecordSnapshot | null
  after: RecordSnapshot
  recordHashAfter: string
}

function parseSnapshot(json: string | null): RecordSnapshot | null {
  return json === null ? null : (JSON.parse(json) as RecordSnapshot)
}

/**
 * 履歴の記録(スナップショットの作成を含む)・履歴一覧の取得・変更項目の差分の算出を担う。
 * `record`は、呼び出し元(`CashRecordService`)のトランザクション内で呼び出すこと。
 * 参照元: 詳細設計書4.20章、5章(`RecordHistoryService`)
 */
export class RecordHistoryService {
  constructor(private readonly repository: CashRecordHistoryRepository) {}

  /** キー順固定のスナップショットを作る(詳細設計書4.20章) */
  buildSnapshot(
    record: Omit<CashRecord, 'recordHash' | 'createdAt' | 'updatedAt'>,
    names: RecordNames,
    receipts: ReceiptRecord[]
  ): RecordSnapshot {
    return {
      recordDate: record.recordDate,
      kind: record.kind,
      amount: record.amount,
      withholdingTaxAmount: record.withholdingTaxAmount,
      accountId: record.accountId,
      accountName: names.accountName,
      description: record.description,
      clientId: record.clientId,
      clientName: names.clientName,
      paymentMethod: record.paymentMethod,
      taxCategory: record.taxCategory,
      taxAmount: record.taxAmount,
      invoiceId: record.invoiceId,
      invoiceNumber: names.invoiceNumber,
      status: record.status,
      isDeleted: record.isDeleted,
      receipts: receipts
        .slice()
        .sort((a, b) => a.id - b.id)
        .map((r) => ({
          id: r.id,
          originalName: r.originalName,
          sha256: r.sha256,
          removed: r.removedAt !== null
        }))
    }
  }

  record(entry: HistoryRecordEntry): void {
    this.repository.insert({
      recordId: entry.recordId,
      operation: entry.operation,
      reason: entry.reason,
      snapshotBefore: entry.before === null ? null : JSON.stringify(entry.before),
      snapshotAfter: JSON.stringify(entry.after),
      recordHashAfter: entry.recordHashAfter
    })
  }

  private toView(row: HistoryRow): HistoryEntryView {
    return {
      id: row.id,
      recordId: row.recordId,
      operation: row.operation,
      operatedAt: row.operatedAt,
      reason: row.reason,
      changes: diffSnapshots(parseSnapshot(row.snapshotBefore), parseSnapshot(row.snapshotAfter)!)
    }
  }

  /** ある記録の履歴(新しい順) */
  listByRecord(recordId: number): HistoryEntryView[] {
    return this.repository.findByRecordId(recordId).map((row) => this.toView(row))
  }

  listHistory(filter: HistoryListFilter): Paged<HistoryListItem> {
    const result = this.repository.search(filter)
    return {
      ...result,
      items: result.items.map((row) => {
        const after = parseSnapshot(row.snapshotAfter)!
        return { ...this.toView(row), recordDate: after.recordDate, description: after.description }
      })
    }
  }
}
