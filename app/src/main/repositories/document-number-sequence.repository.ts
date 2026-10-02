import { and, eq } from 'drizzle-orm'
import type { Database } from '../db/db'
import { documentNumberSequences } from '../db/schema'

export type DocumentType = 'quote' | 'invoice'

/**
 * document_number_sequencesテーブル(見積書・請求書番号の採番管理)へのアクセスを担うRepository層。
 * 参照元: 詳細設計書 4.12・4.14章、5章(クラス設計 `DocumentNumberSequenceRepository`)、6.4章
 */
export class DocumentNumberSequenceRepository {
  constructor(private readonly database: Database) {}

  /** 指定した年・書類種別の連番をインクリメントし、払い出した番号を返す */
  nextNumber(docType: DocumentType, year: number): number {
    const existing = this.database.orm
      .select()
      .from(documentNumberSequences)
      .where(
        and(eq(documentNumberSequences.year, year), eq(documentNumberSequences.docType, docType))
      )
      .get()

    const next = (existing?.lastNumber ?? 0) + 1

    if (existing) {
      this.database.orm
        .update(documentNumberSequences)
        .set({ lastNumber: next })
        .where(
          and(eq(documentNumberSequences.year, year), eq(documentNumberSequences.docType, docType))
        )
        .run()
    } else {
      this.database.orm
        .insert(documentNumberSequences)
        .values({ year, docType, lastNumber: next })
        .run()
    }

    return next
  }
}
