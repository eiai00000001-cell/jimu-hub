import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { RecordIntegrity } from '@shared/types/cash-record'
import type { ReceiptCheckState } from '@shared/types/receipt'
import type { CashRecordHistoryRepository } from '../../repositories/cash-record-history.repository'
import type { CashRecordRepository } from '../../repositories/cash-record.repository'
import type { ReceiptRepository } from '../../repositories/receipt.repository'
import { validateReceiptFile } from '../receipts/receipt-file-validator'
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

  /** @param verifyContent trueの場合、ハッシュの一致に加えて、領収書の中身(マジックナンバー)が拡張子と合うかも確認する */
  checkRecord(recordId: number, verifyContent = false): RecordIntegrity {
    const record = this.records.findById(recordId)
    if (!record) return { recordHashOk: false, historyHashOk: false, receipts: [] }
    const receipts = this.receipts.findByRecordId(recordId)
    const recomputed = computeRecordHash(record, receipts)
    const latest = this.history.findLatestByRecordId(recordId)
    return {
      recordHashOk: recomputed === record.recordHash,
      historyHashOk: latest !== null && latest.recordHashAfter === record.recordHash,
      receipts: receipts.map((r) => ({
        id: r.id,
        state: this.checkFile(r.filePath, r.sha256, verifyContent)
      }))
    }
  }

  /**
   * 復元後に、全記録の記録ハッシュ・履歴ハッシュ、全領収書(外した領収書を含む)のファイルを照合し、
   * 不一致(領収書は欠落・`file_path`が空文字・中身が拡張子と合わないものを含む)の件数を返す。復元は中断しない(詳細設計書4.3章手順7-2-2・2-3)。
   */
  verifyAllAfterRestore(): { receiptHashMismatchCount: number; recordHashMismatchCount: number } {
    let receiptHashMismatchCount = 0
    let recordHashMismatchCount = 0
    for (const id of this.records.listIds()) {
      const result = this.checkRecord(id, true)
      receiptHashMismatchCount += result.receipts.filter((r) => r.state !== 'ok').length
      if (!result.recordHashOk || !result.historyHashOk) recordHashMismatchCount += 1
    }
    return { receiptHashMismatchCount, recordHashMismatchCount }
  }

  private checkFile(filePath: string, sha256: string, verifyContent: boolean): ReceiptCheckState {
    const absolute = resolveReceiptPath(this.documentsDir, filePath)
    if (!absolute) return 'missing'
    let buffer: Buffer
    try {
      buffer = readFileSync(absolute)
    } catch {
      return 'missing'
    }
    if (createHash('sha256').update(buffer).digest('hex') !== sha256) return 'mismatch'
    if (verifyContent) {
      try {
        validateReceiptFile(buffer, absolute)
      } catch {
        return 'mismatch'
      }
    }
    return 'ok'
  }
}
