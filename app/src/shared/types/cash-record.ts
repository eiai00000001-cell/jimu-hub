import type { ProjectRef } from './project'
import type { ReceiptCheckState, ReceiptView } from './receipt'
import type {
  HISTORY_OPERATIONS,
  PAYMENT_METHODS,
  RECORD_KINDS,
  TAX_CATEGORIES
} from '../constants/cash-record'

/** 入出金・経費のデータ型。参照元: 詳細設計書4.18〜4.22章、6.11〜6.13章 */
export type RecordKind = (typeof RECORD_KINDS)[number]
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]
export type TaxCategory = (typeof TAX_CATEGORIES)[number]
export type RecordStatus = 'active' | 'cancelled'
export type HistoryOperation = (typeof HISTORY_OPERATIONS)[number]

/** cash_recordsの1行(Main内部で使用。記録ハッシュを含む) */
export interface CashRecord {
  id: number
  recordDate: string
  kind: RecordKind
  amount: number
  withholdingTaxAmount: number
  accountId: number
  description: string
  clientId: number | null
  paymentMethod: PaymentMethod | null
  taxCategory: TaxCategory | null
  taxAmount: number
  invoiceId: number | null
  status: RecordStatus
  isDeleted: boolean
  recordHash: string
  createdAt: string
  updatedAt: string
}

/** receiptsの1行(Main内部。T-46で領収書の保存を実装する。ファイルのパス・ハッシュはRendererへ返さない) */
export interface ReceiptRecord {
  id: number
  recordId: number
  originalName: string
  filePath: string
  mimeType: string
  fileSize: number
  sha256: string
  attachedAt: string
  removedAt: string | null
}

/** 履歴のスナップショット(キー順固定。詳細設計書4.20章) */
export interface RecordSnapshot {
  recordDate: string
  kind: RecordKind
  amount: number
  withholdingTaxAmount: number
  accountId: number
  accountName: string
  description: string
  clientId: number | null
  clientName: string | null
  paymentMethod: PaymentMethod | null
  taxCategory: TaxCategory | null
  taxAmount: number
  invoiceId: number | null
  invoiceNumber: string | null
  status: RecordStatus
  isDeleted: boolean
  receipts: Array<{ id: number; originalName: string; sha256: string; removed: boolean }>
}

export interface RecordListFilter {
  dateFrom?: string
  dateTo?: string
  amountMin?: number
  amountMax?: number
  clientId?: number
  accountId?: number
  kind?: RecordKind
  page?: number
}

export interface CashRecordSummary {
  id: number
  recordDate: string
  kind: RecordKind
  amount: number
  status: RecordStatus
  invoiceId: number | null
  invoiceNumber: string | null
  accountName: string
  clientName: string | null
  description: string
  receiptCount: number
}

export interface Paged<T> {
  items: T[]
  totalCount: number
  page: number
  pageSize: number
}

/** 履歴の変更項目ごとの変更前後(表示用に整形済みの文字列) */
export interface FieldChange {
  label: string
  before: string
  after: string
}

export interface HistoryEntryView {
  id: number
  recordId: number
  operation: HistoryOperation
  operatedAt: string
  reason: string | null
  changes: FieldChange[]
}

export interface HistoryListItem extends HistoryEntryView {
  /** 記録(日付・摘要)の表示用。操作後のスナップショットから取得する */
  recordDate: string
  description: string
}

export interface HistoryListFilter {
  operation?: HistoryOperation
  dateFrom?: string
  dateTo?: string
  page?: number
}

/** 記録の改変検知の結果。領収書は外した領収書を含む全件の照合結果 */
export interface RecordIntegrity {
  recordHashOk: boolean
  historyHashOk: boolean
  receipts: Array<{ id: number; state: ReceiptCheckState }>
}

export interface CashRecordDetail {
  id: number
  recordDate: string
  kind: RecordKind
  amount: number
  withholdingTaxAmount: number
  accountId: number
  accountName: string
  description: string
  clientId: number | null
  clientName: string | null
  paymentMethod: PaymentMethod | null
  taxCategory: TaxCategory | null
  taxAmount: number
  invoiceId: number | null
  invoiceNumber: string | null
  status: RecordStatus
  isDeleted: boolean
  createdAt: string
  updatedAt: string
  receipts: ReceiptView[]
  history: HistoryEntryView[]
  integrity: RecordIntegrity
  /** 紐づく案件(詳細取得時にIPC層が付与する。案件なしはnull。詳細設計書3.26章) */
  project?: ProjectRef | null
}
