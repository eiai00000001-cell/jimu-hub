import { and, asc, desc, eq, gte, like, lte, type SQL } from 'drizzle-orm'
import type { Database } from '../db/db'
import { clients, invoices, invoiceLineItems, quotes } from '../db/schema'
import {
  calculateLineAmount,
  calculateTaxBreakdown,
  calculateInvoiceWithholdingTax
} from '@shared/calculations/tax-calculation'
import type {
  Invoice,
  InvoiceLineItem,
  InvoiceSummary,
  InvoiceListFilter
} from '@shared/types/invoice'
import type { InvoiceInput } from '@shared/schemas/invoice.schema'

function nowIso(): string {
  return new Date().toISOString()
}

function toNullable(value: string): string | null {
  return value === '' ? null : value
}

function mapLineItemRow(row: typeof invoiceLineItems.$inferSelect): InvoiceLineItem {
  return {
    id: row.id,
    lineNo: row.lineNo,
    name: row.name,
    quantity: row.quantity,
    unit: row.unit,
    unitPrice: row.unitPrice,
    taxRate: row.taxRate as InvoiceLineItem['taxRate'],
    amount: row.amount,
    withholdingTarget: row.withholdingTarget === 1
  }
}

/**
 * 明細行ごとの金額と、請求書全体の税額・源泉徴収税額・請求金額を算出する(詳細設計書4.14・4.16章)。
 * 源泉徴収税額は、対象行の税抜金額の合計に段階計算を1回適用する(行ごとには算出しない)。
 */
function calculateTotals(input: InvoiceInput): {
  lines: Array<{ amount: number }>
  breakdown: ReturnType<typeof calculateTaxBreakdown>
  withholdingTaxAmount: number
  billingAmount: number
} {
  const lines = input.lineItems.map((line) => ({
    amount: calculateLineAmount(line.quantity, line.unitPrice)
  }))
  const breakdown = calculateTaxBreakdown(input.lineItems)
  const withholdingTaxAmount = calculateInvoiceWithholdingTax(input.lineItems)
  return {
    lines,
    breakdown,
    withholdingTaxAmount,
    billingAmount: breakdown.totalAmount - withholdingTaxAmount
  }
}

/**
 * invoices・invoice_line_itemsテーブルへのアクセスを担うRepository層(集約単位でトランザクション更新)。
 * 参照元: 詳細設計書 4.13〜4.16章、5章(クラス設計 `InvoiceRepository`)、6.7・6.8章
 */
export class InvoiceRepository {
  constructor(private readonly database: Database) {}

  findAll(filter: InvoiceListFilter = {}): InvoiceSummary[] {
    const {
      keyword,
      clientId,
      dateFrom,
      dateTo,
      amountMin,
      amountMax,
      status = 'all',
      paymentStatus = 'all'
    } = filter

    const conditions: SQL[] = []
    if (keyword) conditions.push(like(clients.name, `%${keyword}%`))
    if (clientId) conditions.push(eq(invoices.clientId, clientId))
    if (dateFrom) conditions.push(gte(invoices.issueDate, dateFrom))
    if (dateTo) conditions.push(lte(invoices.issueDate, dateTo))
    if (amountMin !== undefined) conditions.push(gte(invoices.totalAmount, amountMin))
    if (amountMax !== undefined) conditions.push(lte(invoices.totalAmount, amountMax))
    if (status !== 'all') conditions.push(eq(invoices.status, status))
    if (paymentStatus !== 'all') conditions.push(eq(invoices.paymentStatus, paymentStatus))

    const rows = this.database.orm
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        clientId: invoices.clientId,
        clientName: clients.name,
        issueDate: invoices.issueDate,
        totalAmount: invoices.totalAmount,
        status: invoices.status,
        paymentStatus: invoices.paymentStatus
      })
      .from(invoices)
      .leftJoin(clients, eq(invoices.clientId, clients.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(invoices.issueDate), desc(invoices.id))
      .all()

    return rows.map((row) => ({
      id: row.id,
      invoiceNumber: row.invoiceNumber,
      clientId: row.clientId,
      clientName: row.clientName ?? '',
      issueDate: row.issueDate,
      totalAmount: row.totalAmount,
      status: row.status as InvoiceSummary['status'],
      paymentStatus: row.paymentStatus as InvoiceSummary['paymentStatus']
    }))
  }

  findById(id: number): Invoice | null {
    const row = this.database.orm
      .select({
        invoice: invoices,
        clientName: clients.name,
        clientHonorific: clients.honorific
      })
      .from(invoices)
      .leftJoin(clients, eq(invoices.clientId, clients.id))
      .where(eq(invoices.id, id))
      .get()

    if (!row) {
      return null
    }
    const inv = row.invoice

    const sourceQuote =
      inv.sourceQuoteId === null
        ? undefined
        : this.database.orm
            .select({ quoteNumber: quotes.quoteNumber })
            .from(quotes)
            .where(eq(quotes.id, inv.sourceQuoteId))
            .get()

    const lineItemRows = this.database.orm
      .select()
      .from(invoiceLineItems)
      .where(eq(invoiceLineItems.invoiceId, id))
      .orderBy(asc(invoiceLineItems.lineNo))
      .all()

    return {
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      clientId: inv.clientId,
      clientName: row.clientName ?? '',
      clientHonorific: (row.clientHonorific ?? '(なし)') as Invoice['clientHonorific'],
      sourceQuoteId: inv.sourceQuoteId,
      sourceQuoteNumber: sourceQuote?.quoteNumber ?? null,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      remarks: inv.remarks,
      subtotal10: inv.subtotal10,
      taxAmount10: inv.taxAmount10,
      subtotal8: inv.subtotal8,
      taxAmount8: inv.taxAmount8,
      totalAmount: inv.totalAmount,
      withholdingTaxAmount: inv.withholdingTaxAmount,
      billingAmount: inv.billingAmount,
      invoiceFormat: inv.invoiceFormat as Invoice['invoiceFormat'],
      status: inv.status as Invoice['status'],
      paymentStatus: inv.paymentStatus as Invoice['paymentStatus'],
      paymentDate: inv.paymentDate,
      pdfPath: inv.pdfPath,
      pdfHash: inv.pdfHash,
      pdfHashMismatch: inv.pdfHashMismatch === 1,
      lineItems: lineItemRows.map(mapLineItemRow),
      createdAt: inv.createdAt,
      updatedAt: inv.updatedAt
    }
  }

  /** 下書きとして新規登録する。税額・源泉徴収税額・請求金額はサーバー側で再計算して保存する */
  insert(input: InvoiceInput, sourceQuoteId: number | null = null): { id: number } {
    const timestamp = nowIso()
    const totals = calculateTotals(input)

    return this.database.transaction(() => {
      const [row] = this.database.orm
        .insert(invoices)
        .values({
          clientId: input.clientId,
          sourceQuoteId,
          issueDate: input.issueDate,
          dueDate: toNullable(input.dueDate),
          remarks: toNullable(input.remarks),
          subtotal10: totals.breakdown.subtotal10,
          taxAmount10: totals.breakdown.taxAmount10,
          subtotal8: totals.breakdown.subtotal8,
          taxAmount8: totals.breakdown.taxAmount8,
          totalAmount: totals.breakdown.totalAmount,
          withholdingTaxAmount: totals.withholdingTaxAmount,
          billingAmount: totals.billingAmount,
          status: 'draft',
          createdAt: timestamp,
          updatedAt: timestamp
        })
        .returning({ id: invoices.id })
        .all()

      if (!row) {
        throw new Error('請求書の登録に失敗しました(idを取得できませんでした)')
      }
      this.insertLineItems(row.id, input, totals.lines)
      return { id: row.id }
    })
  }

  /** 明細行を全置換した上で、各種金額をサーバー側で再計算して保存する(source_quote_idは変更しない) */
  update(id: number, input: InvoiceInput): { changes: number } {
    const totals = calculateTotals(input)

    return this.database.transaction(() => {
      const result = this.database.orm
        .update(invoices)
        .set({
          clientId: input.clientId,
          issueDate: input.issueDate,
          dueDate: toNullable(input.dueDate),
          remarks: toNullable(input.remarks),
          subtotal10: totals.breakdown.subtotal10,
          taxAmount10: totals.breakdown.taxAmount10,
          subtotal8: totals.breakdown.subtotal8,
          taxAmount8: totals.breakdown.taxAmount8,
          totalAmount: totals.breakdown.totalAmount,
          withholdingTaxAmount: totals.withholdingTaxAmount,
          billingAmount: totals.billingAmount,
          updatedAt: nowIso()
        })
        .where(eq(invoices.id, id))
        .run()

      this.database.orm.delete(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, id)).run()
      this.insertLineItems(id, input, totals.lines)

      return { changes: result.changes }
    })
  }

  private insertLineItems(
    invoiceId: number,
    input: InvoiceInput,
    computed: Array<{ amount: number }>
  ): void {
    input.lineItems.forEach((line, index) => {
      const calc = computed[index]
      this.database.orm
        .insert(invoiceLineItems)
        .values({
          invoiceId,
          lineNo: index + 1,
          name: line.name,
          quantity: line.quantity,
          unit: toNullable(line.unit),
          unitPrice: line.unitPrice,
          taxRate: line.taxRate,
          amount: calc?.amount ?? 0,
          withholdingTarget: line.withholdingTarget ? 1 : 0,
          // 行ごとの源泉徴収税額は算出しない(常に0。列はスキーマ変更回避のため残置)
          withholdingAmount: 0
        })
        .run()
    })
  }

  /** 請求書番号の確定採番・記載形式・状態(finalized)を更新する(詳細設計書4.14章) */
  finalize(
    id: number,
    params: { invoiceNumber: string; invoiceFormat: 'qualified' | 'classified' }
  ): { changes: number } {
    const result = this.database.orm
      .update(invoices)
      .set({
        invoiceNumber: params.invoiceNumber,
        invoiceFormat: params.invoiceFormat,
        status: 'finalized',
        updatedAt: nowIso()
      })
      .where(eq(invoices.id, id))
      .run()
    return { changes: result.changes }
  }

  /** 入金ステータス・入金日を更新する(詳細設計書4.15章)。未収の場合は入金日をクリアする */
  updatePaymentStatus(
    id: number,
    paymentStatus: 'unpaid' | 'paid',
    paymentDate: string | null
  ): { changes: number } {
    const result = this.database.orm
      .update(invoices)
      .set({
        paymentStatus,
        paymentDate: paymentStatus === 'paid' ? paymentDate : null,
        updatedAt: nowIso()
      })
      .where(eq(invoices.id, id))
      .run()
    return { changes: result.changes }
  }

  /** PDF生成後、保存先パス・ハッシュ値を記録する */
  updatePdfInfo(id: number, params: { pdfPath: string; pdfHash: string }): void {
    this.database.orm
      .update(invoices)
      .set({ pdfPath: params.pdfPath, pdfHash: params.pdfHash, updatedAt: nowIso() })
      .where(eq(invoices.id, id))
      .run()
  }

  /** PDF生成・保存に失敗した場合、採番・状態変更を下書きへ戻す(発番済みの番号は欠番のまま扱う) */
  revertToDraft(id: number): void {
    this.database.orm
      .update(invoices)
      .set({ invoiceNumber: null, invoiceFormat: null, status: 'draft', updatedAt: nowIso() })
      .where(eq(invoices.id, id))
      .run()
  }
}
