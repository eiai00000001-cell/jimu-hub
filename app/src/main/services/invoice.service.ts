import { InvoiceInputSchema, type InvoiceInput } from '@shared/schemas/invoice.schema'
import { INVOICE_MESSAGES } from '@shared/messages/messages'
import type { Invoice, InvoiceListFilter, InvoiceSummary } from '@shared/types/invoice'
import type { InvoiceFormat } from '@shared/types/quote'
import type { Database } from '../db/db'
import type { InvoiceRepository } from '../repositories/invoice.repository'
import type { CompanyProfileRepository } from '../repositories/company-profile.repository'
import type { NumberingService } from './numbering.service'
import type { PdfService } from './pdf.service'
import { CompanyProfileNotSetError, PdfSaveError } from './quote.service'

export class InvoiceNotFoundError extends Error {
  constructor() {
    super(INVOICE_MESSAGES.notFound)
    this.name = 'InvoiceNotFoundError'
  }
}

export class InvoiceFinalizedError extends Error {
  constructor() {
    super(INVOICE_MESSAGES.finalizedNotEditable)
    this.name = 'InvoiceFinalizedError'
  }
}

function parseOrThrow(input: InvoiceInput): InvoiceInput {
  const result = InvoiceInputSchema.safeParse(input)
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? 'Invalid input')
  }
  return result.data
}

export interface FinalizeInvoiceResult {
  id: number
  invoiceNumber: string
  pdfPath: string
}

export interface InvoiceServiceDeps {
  database: Database
  repository: InvoiceRepository
  companyProfileRepository: CompanyProfileRepository
  numberingService: NumberingService
  pdfService: PdfService
}

/**
 * 請求書の一覧・取得・下書き保存・確定(採番・PDF生成)を担うApplication Service層。
 * 参照元: 詳細設計書 4.14〜4.16章、5章(クラス設計 `InvoiceService`)
 * 確定処理の構造はQuoteServiceと同一(採番までを1トランザクション、PDF生成失敗時は下書きへ戻す)。
 */
export class InvoiceService {
  constructor(private readonly deps: InvoiceServiceDeps) {}

  listInvoices(filter: InvoiceListFilter = {}): InvoiceSummary[] {
    return this.deps.repository.findAll(filter)
  }

  getInvoice(id: number): Invoice {
    const invoice = this.deps.repository.findById(id)
    if (!invoice) {
      throw new InvoiceNotFoundError()
    }
    return invoice
  }

  saveDraft(input: InvoiceInput, id?: number): { id: number } {
    const validated = parseOrThrow(input)
    if (id !== undefined) {
      this.assertEditable(id)
      this.deps.repository.update(id, validated)
      return { id }
    }
    return this.deps.repository.insert(validated)
  }

  async finalizeInvoice(input: InvoiceInput, id?: number): Promise<FinalizeInvoiceResult> {
    const validated = parseOrThrow(input)
    const companyProfile = this.deps.companyProfileRepository.get()
    if (!companyProfile) {
      throw new CompanyProfileNotSetError()
    }

    const { id: invoiceId, invoiceNumber } = this.deps.database.transaction(() => {
      if (id !== undefined) {
        this.assertEditable(id)
        this.deps.repository.update(id, validated)
      }
      const targetId = id ?? this.deps.repository.insert(validated).id

      const year = Number(validated.issueDate.slice(0, 4))
      const number = this.deps.numberingService.issueNumber('invoice', year)
      const invoiceFormat: InvoiceFormat = companyProfile.invoiceRegistrationNumber
        ? 'qualified'
        : 'classified'
      this.deps.repository.finalize(targetId, { invoiceNumber: number, invoiceFormat })
      return { id: targetId, invoiceNumber: number }
    })

    try {
      const invoice = this.deps.repository.findById(invoiceId)
      if (!invoice) {
        throw new InvoiceNotFoundError()
      }
      const { pdfPath, pdfHash } = await this.deps.pdfService.generateInvoicePdf(
        invoice,
        companyProfile
      )
      this.deps.repository.updatePdfInfo(invoiceId, { pdfPath, pdfHash })
      return { id: invoiceId, invoiceNumber, pdfPath }
    } catch {
      this.deps.repository.revertToDraft(invoiceId)
      throw new PdfSaveError()
    }
  }

  private assertEditable(id: number): void {
    const existing = this.deps.repository.findById(id)
    if (!existing) {
      throw new InvoiceNotFoundError()
    }
    if (existing.status === 'finalized') {
      throw new InvoiceFinalizedError()
    }
  }
}
