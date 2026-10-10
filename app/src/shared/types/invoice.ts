import type { ProjectRef } from './project'
import type { Honorific } from './client'
import type { TaxRate } from '../calculations/tax-calculation'
import type { InvoiceFormat } from './quote'

/**
 * 請求書(INVOICES)の型定義。
 * 参照元: 詳細設計書 3.13・3.14章(入力項目定義表)、6.7・6.8章(invoices・invoice_line_itemsテーブル定義)
 */

export const INVOICE_STATUSES = ['draft', 'finalized'] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

export const INVOICE_STATUS_FILTERS = ['draft', 'finalized', 'all'] as const
export type InvoiceStatusFilter = (typeof INVOICE_STATUS_FILTERS)[number]

export const PAYMENT_STATUSES = ['unpaid', 'paid'] as const
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]

export const PAYMENT_STATUS_FILTERS = ['unpaid', 'paid', 'all'] as const
export type PaymentStatusFilter = (typeof PAYMENT_STATUS_FILTERS)[number]

export interface InvoiceLineItem {
  id: number
  lineNo: number
  name: string
  quantity: number
  unit: string | null
  unitPrice: number
  taxRate: TaxRate
  amount: number
  withholdingTarget: boolean
}

/** 請求書の1レコード(詳細取得時の形。明細行・取引先名を含む) */
export interface Invoice {
  id: number
  invoiceNumber: string | null
  clientId: number
  clientName: string
  clientHonorific: Honorific
  sourceQuoteId: number | null
  /** 変換元見積書の書類番号(変換元がない、または未採番の場合はnull) */
  sourceQuoteNumber: string | null
  issueDate: string
  dueDate: string | null
  remarks: string | null
  subtotal10: number
  taxAmount10: number
  subtotal8: number
  taxAmount8: number
  totalAmount: number
  withholdingTaxAmount: number
  billingAmount: number
  invoiceFormat: InvoiceFormat | null
  status: InvoiceStatus
  paymentStatus: PaymentStatus
  paymentDate: string | null
  pdfPath: string | null
  pdfHash: string | null
  pdfHashMismatch: boolean
  lineItems: InvoiceLineItem[]
  createdAt: string
  updatedAt: string
}

/** 請求書に紐づく入金記録(取消済を含む。詳細設計書4.21章) */
export interface LinkedCashRecord {
  id: number
  recordDate: string
  amount: number
  status: 'active' | 'cancelled'
}

/** `invoices:get`の応答(請求書+紐づく入金記録。新しい順) */
export interface InvoiceDetail extends Invoice {
  linkedRecords: LinkedCashRecord[]
  /** 紐づく案件(詳細取得時にIPC層が付与する。案件なしはnull。詳細設計書3.26章) */
  project?: ProjectRef | null
}

/** 請求書一覧の1行(一覧表示用の要約データ) */
export interface InvoiceSummary {
  id: number
  invoiceNumber: string | null
  clientId: number
  clientName: string
  issueDate: string
  totalAmount: number
  status: InvoiceStatus
  paymentStatus: PaymentStatus
}

/** 請求書一覧取得の絞り込み条件(詳細設計書 4.14章、7章) */
export interface InvoiceListFilter {
  keyword?: string
  clientId?: number
  dateFrom?: string
  dateTo?: string
  amountMin?: number
  amountMax?: number
  status?: InvoiceStatusFilter
  paymentStatus?: PaymentStatusFilter
}
