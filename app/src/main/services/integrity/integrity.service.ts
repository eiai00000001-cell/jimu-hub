import type { RecordIntegrity } from '@shared/types/cash-record'
import type { CashRecordHistoryRepository } from '../../repositories/cash-record-history.repository'
import type { CashRecordRepository } from '../../repositories/cash-record.repository'
import type { ReceiptRepository } from '../../repositories/receipt.repository'
import { computeRecordHash } from './record-hash'

/**
 * 記録ハッシュの照合(改変検知)を担う。領収書ファイルのSHA-256照合は、領収書の添付(T-46)・
 * 改変検知の表示(T-49)の実装時に追加する。
 * 参照元: 詳細設計書4.22章(`IntegrityService.checkRecord`)
 */
export class IntegrityService {
  constructor(
    private readonly records: CashRecordRepository,
    private readonly receipts: ReceiptRepository,
    private readonly history: CashRecordHistoryRepository
  ) {}

  checkRecord(recordId: number): RecordIntegrity {
    const record = this.records.findById(recordId)
    if (!record) return { recordHashOk: false, historyHashOk: false }
    const recomputed = computeRecordHash(record, this.receipts.findByRecordId(recordId))
    const latest = this.history.findLatestByRecordId(recordId)
    return {
      recordHashOk: recomputed === record.recordHash,
      historyHashOk: latest !== null && latest.recordHashAfter === record.recordHash
    }
  }
}
