import { createHash } from 'node:crypto'
import type { CashRecord, ReceiptRecord } from '@shared/types/cash-record'

/** 記録ハッシュの算出方式のバージョン(詳細設計書4.22章) */
export const RECORD_HASH_VERSION = 1

/**
 * 記録ハッシュ(SHA-256・16進数64桁)を算出する純粋関数。
 * `updated_at`・`created_at`・`record_hash`自体は入力に含めない。欠損値はnullで表す。
 * 参照元: 詳細設計書4.22章(`RecordHashService.compute`)
 */
export function computeRecordHash(
  record: Omit<CashRecord, 'recordHash' | 'createdAt' | 'updatedAt'>,
  receipts: Array<Pick<ReceiptRecord, 'id' | 'sha256' | 'removedAt'>>
): string {
  const canonical = JSON.stringify([
    RECORD_HASH_VERSION,
    record.id,
    record.recordDate,
    record.kind,
    record.amount,
    record.withholdingTaxAmount,
    record.accountId,
    record.description,
    record.clientId,
    record.paymentMethod,
    record.taxCategory,
    record.taxAmount,
    record.invoiceId,
    record.status,
    record.isDeleted ? 1 : 0,
    receipts
      .slice()
      .sort((a, b) => a.id - b.id)
      .map((r) => [r.id, r.sha256, r.removedAt ? 1 : 0])
  ])
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}
