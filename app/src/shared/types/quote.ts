import type { Honorific } from './client'
import type { ProjectRef } from './project'
import type { TaxRate } from '../calculations/tax-calculation'

/**
 * 見積書(QUOTES)の型定義。
 * 参照元: 詳細設計書 3.11・3.12章(入力項目定義表)、6.5・6.6章(quotes・quote_line_itemsテーブル定義)
 */

export const QUOTE_STATUSES = ['draft', 'finalized'] as const
export type QuoteStatus = (typeof QUOTE_STATUSES)[number]

export const QUOTE_STATUS_FILTERS = ['draft', 'finalized', 'all'] as const
export type QuoteStatusFilter = (typeof QUOTE_STATUS_FILTERS)[number]

export const INVOICE_FORMATS = ['qualified', 'classified'] as const
export type InvoiceFormat = (typeof INVOICE_FORMATS)[number]

export interface QuoteLineItem {
  id: number
  lineNo: number
  name: string
  quantity: number
  unit: string | null
  unitPrice: number
  taxRate: TaxRate
  amount: number
}

/** 見積書の1レコード(詳細取得時の形。明細行・取引先名を含む) */
export interface Quote {
  id: number
  quoteNumber: string | null
  clientId: number
  clientName: string
  clientHonorific: Honorific
  issueDate: string
  validUntil: string | null
  remarks: string | null
  subtotal10: number
  taxAmount10: number
  subtotal8: number
  taxAmount8: number
  totalAmount: number
  invoiceFormat: InvoiceFormat | null
  status: QuoteStatus
  pdfPath: string | null
  pdfHash: string | null
  pdfHashMismatch: boolean
  lineItems: QuoteLineItem[]
  createdAt: string
  updatedAt: string
  /** 紐づく案件(詳細取得時にIPC層が付与する。案件なしはnull。詳細設計書3.26章) */
  project?: ProjectRef | null
}

/** 見積書一覧の1行(一覧表示用の要約データ) */
export interface QuoteSummary {
  id: number
  quoteNumber: string | null
  clientId: number
  clientName: string
  issueDate: string
  totalAmount: number
  status: QuoteStatus
}

/** 見積書一覧取得の絞り込み条件(詳細設計書 4.12章、7章) */
export interface QuoteListFilter {
  keyword?: string
  clientId?: number
  dateFrom?: string
  dateTo?: string
  amountMin?: number
  amountMax?: number
  status?: QuoteStatusFilter
}
