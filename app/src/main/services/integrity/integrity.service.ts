import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { RecordIntegrity } from '@shared/types/cash-record'
import type { ReceiptCheckState } from '@shared/types/receipt'
import type { CashRecordHistoryRepository } from '../../repositories/cash-record-history.repository'
import type { CashRecordRepository } from '../../repositories/cash-record.repository'
import type { ReceiptRepository } from '../../repositories/receipt.repository'
import { resolveReceiptPath } from '../receipts/receipt-path'
import { computeRecordHash } from './record-hash'

/**
 * 記録ハッシュ・領収書ファイルのSHA-256の照合(改変検知)を担う。
 * 領収書は、外した領収書を含む全件を、`documents/receipts/`配下であることを確認した上で照合する。
 * 参照元: 詳細設計書4.22章(`IntegrityService.checkRecord`)
 */
export class IntegrityService {
  constructor(
    private readonly records: CashRecordRepository,
    private readonly receipts: ReceiptRepository,
    private readonly history: CashRecordHistoryRepository,
    private readonly documentsDir: string
  ) {}

  checkRecord(recordId: number): RecordIntegrity {
    const record = this.records.findById(recordId)
    if (!record) return { recordHashOk: false, historyHashOk: false, receipts: [] }
    const receipts = this.receipts.findByRecordId(recordId)
    const recomputed = computeRecordHash(record, receipts)
    const latest = this.history.findLatestByRecordId(recordId)
    return {
      recordHashOk: recomputed === record.recordHash,
      historyHashOk: latest !== null && latest.recordHashAfter === record.recordHash,
      receipts: receipts.map((r) => ({ id: r.id, state: this.checkFile(r.filePath, r.sha256) }))
    }
  }

  private checkFile(filePath: string, sha256: string): ReceiptCheckState {
    const absolute = resolveReceiptPath(this.documentsDir, filePath)
    if (!absolute) return 'missing'
    try {
      const actual = createHash('sha256').update(readFileSync(absolute)).digest('hex')
      return actual === sha256 ? 'ok' : 'mismatch'
    } catch {
      return 'missing'
    }
  }
}
