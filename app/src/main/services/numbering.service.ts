import type {
  DocumentNumberSequenceRepository,
  DocumentType
} from '../repositories/document-number-sequence.repository'

/**
 * 見積書・請求書番号の採番を担うApplication Service層。
 * 参照元: 詳細設計書 4.12章手順7-2、5章(クラス設計 `NumberingService`)、基本設計書2.2章★C4
 */
export class NumberingService {
  constructor(private readonly repository: DocumentNumberSequenceRepository) {}

  /** `西暦4桁-連番3桁`(例: `2026-001`)形式の書類番号を発番する */
  issueNumber(docType: DocumentType, year: number): string {
    const next = this.repository.nextNumber(docType, year)
    return `${year}-${String(next).padStart(3, '0')}`
  }
}
