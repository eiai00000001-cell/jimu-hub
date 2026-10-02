import { QuoteInputSchema, type QuoteInput } from '@shared/schemas/quote.schema'
import { QUOTE_MESSAGES } from '@shared/messages/messages'
import type { Quote, QuoteListFilter, QuoteSummary, InvoiceFormat } from '@shared/types/quote'
import type { Database } from '../db/db'
import type { QuoteRepository } from '../repositories/quote.repository'
import type { CompanyProfileRepository } from '../repositories/company-profile.repository'
import type { NumberingService } from './numbering.service'
import type { PdfService } from './pdf.service'

export class QuoteNotFoundError extends Error {
  constructor() {
    super(QUOTE_MESSAGES.notFound)
    this.name = 'QuoteNotFoundError'
  }
}

export class QuoteFinalizedError extends Error {
  constructor() {
    super(QUOTE_MESSAGES.finalizedNotEditable)
    this.name = 'QuoteFinalizedError'
  }
}

export class CompanyProfileNotSetError extends Error {
  constructor() {
    super(QUOTE_MESSAGES.companyProfileNotSet)
    this.name = 'CompanyProfileNotSetError'
  }
}

export class PdfSaveError extends Error {
  constructor() {
    super(QUOTE_MESSAGES.pdfSaveFailure)
    this.name = 'PdfSaveError'
  }
}

function parseOrThrow(input: QuoteInput): QuoteInput {
  const result = QuoteInputSchema.safeParse(input)
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? 'Invalid input')
  }
  return result.data
}

export interface FinalizeQuoteResult {
  id: number
  quoteNumber: string
  pdfPath: string
}

export interface QuoteServiceDeps {
  database: Database
  repository: QuoteRepository
  companyProfileRepository: CompanyProfileRepository
  numberingService: NumberingService
  pdfService: PdfService
}

/**
 * 見積書の一覧・取得・下書き保存・確定(採番・PDF生成)を担うApplication Service層。
 * 参照元: 詳細設計書 4.12・4.13章、5章(クラス設計 `QuoteService`)
 */
export class QuoteService {
  constructor(private readonly deps: QuoteServiceDeps) {}

  listQuotes(filter: QuoteListFilter = {}): QuoteSummary[] {
    return this.deps.repository.findAll(filter)
  }

  getQuote(id: number): Quote {
    const quote = this.deps.repository.findById(id)
    if (!quote) {
      throw new QuoteNotFoundError()
    }
    return quote
  }

  saveDraft(input: QuoteInput, id?: number): { id: number } {
    const validated = parseOrThrow(input)
    if (id !== undefined) {
      this.assertEditable(id)
      this.deps.repository.update(id, validated)
      return { id }
    }
    return this.deps.repository.insert(validated)
  }

  /**
   * 見積書番号を確定採番し、PDFを生成・保存する(詳細設計書4.12章手順6〜11)。
   * 手順1〜7(下書き保存・採番・状態更新)は1つのDBトランザクションで行い、
   * その後の手順8〜9(PDF生成・保存)は非同期処理のためトランザクション外で行う。
   * PDF生成に失敗した場合は、採番・状態変更を下書きへ戻す(SQLのROLLBACKではなく、
   * 別トランザクションでの補償的な更新。詳細は`QuoteRepository.revertToDraft()`参照)。
   */
  async finalizeQuote(input: QuoteInput, id?: number): Promise<FinalizeQuoteResult> {
    const validated = parseOrThrow(input)
    const companyProfile = this.deps.companyProfileRepository.get()
    if (!companyProfile) {
      throw new CompanyProfileNotSetError()
    }

    const { id: quoteId, quoteNumber } = this.deps.database.transaction(() => {
      if (id !== undefined) {
        this.assertEditable(id)
        this.deps.repository.update(id, validated)
      }
      const targetId = id ?? this.deps.repository.insert(validated).id

      const year = Number(validated.issueDate.slice(0, 4))
      const number = this.deps.numberingService.issueNumber('quote', year)
      const invoiceFormat: InvoiceFormat = companyProfile.invoiceRegistrationNumber
        ? 'qualified'
        : 'classified'
      this.deps.repository.finalize(targetId, { quoteNumber: number, invoiceFormat })

      return { id: targetId, quoteNumber: number }
    })

    try {
      const quote = this.deps.repository.findById(quoteId)
      if (!quote) {
        throw new QuoteNotFoundError()
      }
      const { pdfPath, pdfHash } = await this.deps.pdfService.generateQuotePdf(
        quote,
        companyProfile
      )
      this.deps.repository.updatePdfInfo(quoteId, { pdfPath, pdfHash })
      return { id: quoteId, quoteNumber, pdfPath }
    } catch {
      this.deps.repository.revertToDraft(quoteId)
      throw new PdfSaveError()
    }
  }

  private assertEditable(id: number): void {
    const existing = this.deps.repository.findById(id)
    if (!existing) {
      throw new QuoteNotFoundError()
    }
    if (existing.status === 'finalized') {
      throw new QuoteFinalizedError()
    }
  }
}
