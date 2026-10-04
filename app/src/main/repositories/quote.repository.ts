import { and, asc, desc, eq, gte, like, lte, type SQL } from 'drizzle-orm'
import type { Database } from '../db/db'
import { clients, invoices, quotes, quoteLineItems } from '../db/schema'
import { calculateLineAmount, calculateTaxBreakdown } from '@shared/calculations/tax-calculation'
import type { Quote, QuoteLineItem, QuoteSummary, QuoteListFilter } from '@shared/types/quote'
import type { QuoteInput } from '@shared/schemas/quote.schema'

function nowIso(): string {
  return new Date().toISOString()
}

function toNullable(value: string): string | null {
  return value === '' ? null : value
}

function mapLineItemRow(row: typeof quoteLineItems.$inferSelect): QuoteLineItem {
  return {
    id: row.id,
    lineNo: row.lineNo,
    name: row.name,
    quantity: row.quantity,
    unit: row.unit,
    unitPrice: row.unitPrice,
    taxRate: row.taxRate as QuoteLineItem['taxRate'],
    amount: row.amount
  }
}

interface QuoteRow {
  id: number
  quoteNumber: string | null
  clientId: number
  clientName: string | null
  clientHonorific: string | null
  issueDate: string
  validUntil: string | null
  remarks: string | null
  subtotal10: number
  taxAmount10: number
  subtotal8: number
  taxAmount8: number
  totalAmount: number
  invoiceFormat: string | null
  status: string
  pdfPath: string | null
  pdfHash: string | null
  pdfHashMismatch: number
  createdAt: string
  updatedAt: string
}

/**
 * quotes・quote_line_itemsテーブルへのアクセスを担うRepository層(集約単位でトランザクション更新)。
 * 参照元: 詳細設計書 4.12・4.13章、5章(クラス設計 `QuoteRepository`)、6.5・6.6章
 */
export class QuoteRepository {
  constructor(private readonly database: Database) {}

  findAll(filter: QuoteListFilter = {}): QuoteSummary[] {
    const { keyword, clientId, dateFrom, dateTo, amountMin, amountMax, status = 'all' } = filter

    const conditions: SQL[] = []
    if (keyword) {
      conditions.push(like(clients.name, `%${keyword}%`))
    }
    if (clientId) {
      conditions.push(eq(quotes.clientId, clientId))
    }
    if (dateFrom) {
      conditions.push(gte(quotes.issueDate, dateFrom))
    }
    if (dateTo) {
      conditions.push(lte(quotes.issueDate, dateTo))
    }
    if (amountMin !== undefined) {
      conditions.push(gte(quotes.totalAmount, amountMin))
    }
    if (amountMax !== undefined) {
      conditions.push(lte(quotes.totalAmount, amountMax))
    }
    if (status !== 'all') {
      conditions.push(eq(quotes.status, status))
    }

    const rows = this.database.orm
      .select({
        id: quotes.id,
        quoteNumber: quotes.quoteNumber,
        clientId: quotes.clientId,
        clientName: clients.name,
        issueDate: quotes.issueDate,
        totalAmount: quotes.totalAmount,
        status: quotes.status
      })
      .from(quotes)
      .leftJoin(clients, eq(quotes.clientId, clients.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(quotes.issueDate), desc(quotes.id))
      .all()

    return rows.map((row) => ({
      id: row.id,
      quoteNumber: row.quoteNumber,
      clientId: row.clientId,
      clientName: row.clientName ?? '',
      issueDate: row.issueDate,
      totalAmount: row.totalAmount,
      status: row.status as QuoteSummary['status']
    }))
  }

  findById(id: number): Quote | null {
    const row = this.database.orm
      .select({
        id: quotes.id,
        quoteNumber: quotes.quoteNumber,
        clientId: quotes.clientId,
        clientName: clients.name,
        clientHonorific: clients.honorific,
        issueDate: quotes.issueDate,
        validUntil: quotes.validUntil,
        remarks: quotes.remarks,
        subtotal10: quotes.subtotal10,
        taxAmount10: quotes.taxAmount10,
        subtotal8: quotes.subtotal8,
        taxAmount8: quotes.taxAmount8,
        totalAmount: quotes.totalAmount,
        invoiceFormat: quotes.invoiceFormat,
        status: quotes.status,
        pdfPath: quotes.pdfPath,
        pdfHash: quotes.pdfHash,
        pdfHashMismatch: quotes.pdfHashMismatch,
        createdAt: quotes.createdAt,
        updatedAt: quotes.updatedAt
      })
      .from(quotes)
      .leftJoin(clients, eq(quotes.clientId, clients.id))
      .where(eq(quotes.id, id))
      .get() as QuoteRow | undefined

    if (!row) {
      return null
    }

    const lineItemRows = this.database.orm
      .select()
      .from(quoteLineItems)
      .where(eq(quoteLineItems.quoteId, id))
      .orderBy(asc(quoteLineItems.lineNo))
      .all()

    return {
      id: row.id,
      quoteNumber: row.quoteNumber,
      clientId: row.clientId,
      clientName: row.clientName ?? '',
      clientHonorific: (row.clientHonorific ?? '(なし)') as Quote['clientHonorific'],
      issueDate: row.issueDate,
      validUntil: row.validUntil,
      remarks: row.remarks,
      subtotal10: row.subtotal10,
      taxAmount10: row.taxAmount10,
      subtotal8: row.subtotal8,
      taxAmount8: row.taxAmount8,
      totalAmount: row.totalAmount,
      invoiceFormat: row.invoiceFormat as Quote['invoiceFormat'],
      status: row.status as Quote['status'],
      pdfPath: row.pdfPath,
      pdfHash: row.pdfHash,
      pdfHashMismatch: row.pdfHashMismatch === 1,
      lineItems: lineItemRows.map(mapLineItemRow),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }
  }

  /** 下書きとして新規登録する(税額はサーバー側で再計算して保存する) */
  insert(input: QuoteInput): { id: number } {
    const timestamp = nowIso()
    const breakdown = calculateTaxBreakdown(input.lineItems)

    return this.database.transaction(() => {
      const [row] = this.database.orm
        .insert(quotes)
        .values({
          clientId: input.clientId,
          issueDate: input.issueDate,
          validUntil: toNullable(input.validUntil),
          remarks: toNullable(input.remarks),
          subtotal10: breakdown.subtotal10,
          taxAmount10: breakdown.taxAmount10,
          subtotal8: breakdown.subtotal8,
          taxAmount8: breakdown.taxAmount8,
          totalAmount: breakdown.totalAmount,
          status: 'draft',
          createdAt: timestamp,
          updatedAt: timestamp
        })
        .returning({ id: quotes.id })
        .all()

      if (!row) {
        throw new Error('見積書の登録に失敗しました(idを取得できませんでした)')
      }
      this.insertLineItems(row.id, input)
      return { id: row.id }
    })
  }

  /** 明細行を全置換した上で、税額をサーバー側で再計算して保存する */
  update(id: number, input: QuoteInput): { changes: number } {
    const breakdown = calculateTaxBreakdown(input.lineItems)

    return this.database.transaction(() => {
      const result = this.database.orm
        .update(quotes)
        .set({
          clientId: input.clientId,
          issueDate: input.issueDate,
          validUntil: toNullable(input.validUntil),
          remarks: toNullable(input.remarks),
          subtotal10: breakdown.subtotal10,
          taxAmount10: breakdown.taxAmount10,
          subtotal8: breakdown.subtotal8,
          taxAmount8: breakdown.taxAmount8,
          totalAmount: breakdown.totalAmount,
          updatedAt: nowIso()
        })
        .where(eq(quotes.id, id))
        .run()

      this.database.orm.delete(quoteLineItems).where(eq(quoteLineItems.quoteId, id)).run()
      this.insertLineItems(id, input)

      return { changes: result.changes }
    })
  }

  private insertLineItems(quoteId: number, input: QuoteInput): void {
    input.lineItems.forEach((line, index) => {
      this.database.orm
        .insert(quoteLineItems)
        .values({
          quoteId,
          lineNo: index + 1,
          name: line.name,
          quantity: line.quantity,
          unit: toNullable(line.unit),
          unitPrice: line.unitPrice,
          taxRate: line.taxRate,
          amount: calculateLineAmount(line.quantity, line.unitPrice)
        })
        .run()
    })
  }

  /** 見積書番号の確定採番・記載形式・状態(finalized)を更新する(詳細設計書4.12章手順7) */
  finalize(
    id: number,
    params: { quoteNumber: string; invoiceFormat: 'qualified' | 'classified' }
  ): { changes: number } {
    const result = this.database.orm
      .update(quotes)
      .set({
        quoteNumber: params.quoteNumber,
        invoiceFormat: params.invoiceFormat,
        status: 'finalized',
        updatedAt: nowIso()
      })
      .where(eq(quotes.id, id))
      .run()
    return { changes: result.changes }
  }

  /** PDF生成後、保存先パス・ハッシュ値を記録する(詳細設計書4.12章手順9) */
  updatePdfInfo(id: number, params: { pdfPath: string; pdfHash: string }): void {
    this.database.orm
      .update(quotes)
      .set({ pdfPath: params.pdfPath, pdfHash: params.pdfHash, updatedAt: nowIso() })
      .where(eq(quotes.id, id))
      .run()
  }

  /**
   * PDF生成・保存に失敗した場合、採番・状態変更を下書きへ戻す(詳細設計書4.12章手順10)。
   * 発番済みの番号は再利用せず欠番のまま扱う(NumberingServiceの採番シーケンスまでは戻さない)。
   */
  revertToDraft(id: number): void {
    this.database.orm
      .update(quotes)
      .set({ quoteNumber: null, invoiceFormat: null, status: 'draft', updatedAt: nowIso() })
      .where(eq(quotes.id, id))
      .run()
  }

  /** 下書きの削除。明細行も合わせて完全に削除する(詳細設計書4.26章手順4)。呼び出しはService層のトランザクション内で行う */
  delete(id: number): { changes: number } {
    this.database.orm.delete(quoteLineItems).where(eq(quoteLineItems.quoteId, id)).run()
    const result = this.database.orm.delete(quotes).where(eq(quotes.id, id)).run()
    return { changes: result.changes }
  }

  /** この見積書を元に作成された請求書が存在するか(`invoices.source_quote_id`) */
  hasDerivedInvoices(id: number): boolean {
    const row = this.database.orm
      .select({ id: invoices.id })
      .from(invoices)
      .where(eq(invoices.sourceQuoteId, id))
      .limit(1)
      .get()
    return row !== undefined
  }
}
