import {
  InvoiceInputSchema,
  PaymentStatusInputSchema,
  type InvoiceInput,
  type PaymentStatusInput
} from '@shared/schemas/invoice.schema'
import { INVOICE_MESSAGES } from '@shared/messages/messages'
import type { InvoiceDetail, InvoiceListFilter, InvoiceSummary } from '@shared/types/invoice'
import type { InvoiceFormat } from '@shared/types/quote'
import type { Database } from '../db/db'
import type { QuoteRepository } from '../repositories/quote.repository'
import type { InvoiceRepository } from '../repositories/invoice.repository'
import type { CompanyProfileRepository } from '../repositories/company-profile.repository'
import type { NumberingService } from './numbering.service'
import type { PdfService } from './pdf.service'
import type { InvoicePaymentRecorder } from './cash-record.service'
import { CompanyProfileNotSetError, PdfSaveError, QuoteNotFoundError } from './quote.service'

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

export class InvoiceNotDeletableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvoiceNotDeletableError'
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
  quoteRepository: QuoteRepository
  companyProfileRepository: CompanyProfileRepository
  numberingService: NumberingService
  pdfService: PdfService
  /** 入金記録の自動作成・取消(F-21)。本番では`CashRecordService`を渡す */
  paymentRecorder?: InvoicePaymentRecorder
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

  /** 請求書と、紐づく入金記録(取消済を含む。新しい順)を返す(詳細設計書4.21章) */
  getInvoice(id: number): InvoiceDetail {
    const invoice = this.deps.repository.findById(id)
    if (!invoice) {
      throw new InvoiceNotFoundError()
    }
    return {
      ...invoice,
      linkedRecords: this.deps.paymentRecorder?.findLinkedByInvoice(id) ?? []
    }
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

  /**
   * 見積書の内容を引き継いだ請求書(下書き)を新規作成する(詳細設計書4.13章)。
   * 取引先・備考・明細行(品名/数量/単位/単価/税率)をコピーし、発行日は本日、支払期限は空欄、
   * 明細行の源泉徴収対象は既定でfalse、source_quote_idに変換元を設定する。
   * 取引先が利用停止でも制限せず、同一見積書から複数回変換した場合も都度新規作成する。
   */
  convertFromQuote(quoteId: number): { invoiceId: number } {
    const quote = this.deps.quoteRepository.findById(quoteId)
    if (!quote) {
      throw new QuoteNotFoundError()
    }
    if (quote.status !== 'finalized') {
      throw new Error(INVOICE_MESSAGES.convertRequiresFinalized)
    }
    const now = new Date()
    const pad = (n: number): string => String(n).padStart(2, '0')
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

    const { id } = this.deps.repository.insert(
      {
        clientId: quote.clientId,
        issueDate: today,
        dueDate: '',
        remarks: quote.remarks ?? '',
        lineItems: quote.lineItems.map((line) => ({
          name: line.name,
          quantity: line.quantity,
          unit: line.unit ?? '',
          unitPrice: line.unitPrice,
          taxRate: line.taxRate,
          withholdingTarget: false
        }))
      },
      quote.id
    )
    return { invoiceId: id }
  }

  /**
   * 入金ステータスを変更する(詳細設計書4.15章)。PDF保存済みの請求書のみ対象。
   * 入金済みへの変更は入金日が必須で、未収へ戻す場合は入金日をクリアする。
   */
  updatePaymentStatus(id: number, input: PaymentStatusInput): { success: true } {
    const parsed = PaymentStatusInputSchema.safeParse(input)
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message ?? 'Invalid input')
    }
    const invoice = this.deps.repository.findById(id)
    if (!invoice) {
      throw new InvoiceNotFoundError()
    }
    if (invoice.status !== 'finalized') {
      throw new Error(INVOICE_MESSAGES.paymentRequiresFinalized)
    }
    const { paymentStatus, paymentDate } = parsed.data
    // 請求書の状態変更と入金記録(・履歴)の作成/取消を同一トランザクションで行う(詳細設計書4.15・4.21章)。
    // どちらかが失敗した場合は全体をロールバックする
    this.deps.database.transaction(() => {
      this.deps.repository.updatePaymentStatus(id, paymentStatus, paymentDate ?? null)
      const recorder = this.deps.paymentRecorder
      if (!recorder) return
      if (paymentStatus === 'paid') {
        try {
          recorder.createFromInvoicePayment({
            id,
            invoiceNumber: invoice.invoiceNumber,
            clientId: invoice.clientId,
            paymentDate: paymentDate ?? null,
            billingAmount: invoice.billingAmount,
            withholdingTaxAmount: invoice.withholdingTaxAmount
          })
        } catch {
          throw new Error(INVOICE_MESSAGES.paymentRecordCreateFailure)
        }
      } else {
        try {
          recorder.cancelByInvoice(id)
        } catch {
          throw new Error(INVOICE_MESSAGES.paymentRecordCancelFailure)
        }
      }
    })
    return { success: true }
  }

  /**
   * [F-26]下書きの請求書を完全に削除する(詳細設計書4.26章)。PDF保存済みは削除しない。
   * 紐づく入金記録(`cash_records.invoice_id`)が存在する場合も削除しない。
   */
  deleteDraft(id: number): { success: true } {
    const existing = this.deps.repository.findById(id)
    if (!existing) {
      throw new InvoiceNotFoundError()
    }
    if (existing.status === 'finalized') {
      throw new InvoiceNotDeletableError(INVOICE_MESSAGES.finalizedNotDeletable)
    }
    if (this.deps.paymentRecorder?.hasRecordsForInvoice(id)) {
      throw new InvoiceNotDeletableError(INVOICE_MESSAGES.hasCashRecord)
    }
    this.deps.database.transaction(() => {
      this.deps.repository.delete(id)
    })
    return { success: true }
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
