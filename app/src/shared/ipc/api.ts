import type { Client, ClientListFilter } from '../types/client'
import type { ClientInput } from '../schemas/client.schema'
import type { CompanyProfile } from '../types/company-profile'
import type { CompanyProfileInput } from '../schemas/company-profile.schema'
import type { AccountView, AccountListFilter } from '../types/account'
import type { AccountInput } from '../schemas/account.schema'
import type {
  CashRecordDetail,
  CashRecordSummary,
  HistoryListFilter,
  HistoryListItem,
  Paged,
  RecordListFilter
} from '../types/cash-record'
import type {
  CashRecordInput,
  CashRecordUpdateInput,
  CashRecordDeleteInput
} from '../schemas/cash-record.schema'
import type { Quote, QuoteSummary, QuoteListFilter } from '../types/quote'
import type { QuoteInput } from '../schemas/quote.schema'
import type { InvoiceDetail, InvoiceSummary, InvoiceListFilter } from '../types/invoice'
import type { InvoiceInput } from '../schemas/invoice.schema'

/**
 * Renderer-Main間のIPCリクエスト/レスポンス型。
 * 参照元: 詳細設計書 7章(API/インターフェース設計)
 */

export interface UpdateClientRequest {
  id: number
  input: ClientInput
}

export interface DeactivateClientResult {
  success: true
}

export interface UpdateClientResult {
  success: true
}

export interface CreateClientResult {
  id: number
}

export interface ExportDataResult {
  success: boolean
  filePath?: string
  error?: string
}

export interface ImportDataResult {
  success: boolean
  importedCount?: number
  pdfHashMismatchCount?: number
  error?: string
}

/** アプリ起動処理(4.1章)の結果。データベース接続に失敗した場合はok:falseとなる */
export interface StartupStatus {
  ok: boolean
  message?: string
}

export interface SaveCompanyProfileResult {
  success: true
}

export type SaveQuoteDraftRequest = { id?: number } & QuoteInput
export type FinalizeQuoteRequest = { id?: number } & QuoteInput

export interface SaveQuoteDraftResult {
  id: number
}

export interface FinalizeQuoteResult {
  id: number
  quoteNumber: string
  pdfPath: string
}

export type SaveInvoiceDraftRequest = { id?: number } & InvoiceInput
export type FinalizeInvoiceRequest = { id?: number } & InvoiceInput

export interface SaveInvoiceDraftResult {
  id: number
}

export interface FinalizeInvoiceResult {
  id: number
  invoiceNumber: string
  pdfPath: string
}

export interface ConvertQuoteToInvoiceResult {
  invoiceId: number
}

export type OpenPdfResult = { success: true } | { success: false; error: string }

/**
 * PreloadがcontextBridgeで公開するAPIの型(window.jimuhubApi)。
 * Renderer側はこの型を通じてのみMainプロセスとやり取りする。
 */
export interface JimuhubApi {
  getStartupStatus(): Promise<StartupStatus>
  /** 起動エラー画面からの復元成功後に、アプリを再起動する(F-09) */
  relaunchApp(): Promise<void>
  listClients(filter?: ClientListFilter): Promise<Client[]>
  /** 対象が存在しない場合はPromiseがreject(例外)される(ClientService.getClient()参照) */
  getClient(id: number): Promise<Client>
  createClient(input: ClientInput): Promise<CreateClientResult>
  updateClient(id: number, input: ClientInput): Promise<UpdateClientResult>
  /** 下書きの見積書を削除する(F-26)。PDF保存済み等の場合はreject */
  deleteQuoteDraft(id: number): Promise<DeactivateClientResult>
  /** 下書きの請求書を削除する(F-26)。PDF保存済み等の場合はreject */
  deleteInvoiceDraft(id: number): Promise<DeactivateClientResult>
  listAccounts(filter?: AccountListFilter): Promise<AccountView[]>
  createAccount(input: AccountInput): Promise<{ id: number }>
  renameAccount(id: number, name: string): Promise<DeactivateClientResult>
  deactivateAccount(id: number): Promise<DeactivateClientResult>
  reactivateAccount(id: number): Promise<DeactivateClientResult>
  deleteAccount(id: number): Promise<DeactivateClientResult>
  listRecords(filter?: RecordListFilter): Promise<Paged<CashRecordSummary>>
  getRecord(id: number): Promise<CashRecordDetail>
  createRecord(input: CashRecordInput): Promise<{ id: number }>
  updateRecord(input: CashRecordUpdateInput): Promise<{ id: number; changed: boolean }>
  deleteRecord(input: CashRecordDeleteInput): Promise<DeactivateClientResult>
  listRecordHistory(filter?: HistoryListFilter): Promise<Paged<HistoryListItem>>
  deactivateClient(id: number): Promise<DeactivateClientResult>
  /** 利用停止の取引先を利用中へ戻す(F-25)。存在しない・既に利用中の場合はreject */
  reactivateClient(id: number): Promise<DeactivateClientResult>
  exportData(): Promise<ExportDataResult>
  importData(): Promise<ImportDataResult>
  getCompanyProfile(): Promise<CompanyProfile | null>
  saveCompanyProfile(input: CompanyProfileInput): Promise<SaveCompanyProfileResult>
  listQuotes(filter?: QuoteListFilter): Promise<QuoteSummary[]>
  /** 対象が存在しない場合はPromiseがreject(例外)される(QuoteService.getQuote()参照) */
  getQuote(id: number): Promise<Quote>
  saveQuoteDraft(request: SaveQuoteDraftRequest): Promise<SaveQuoteDraftResult>
  finalizeQuote(request: FinalizeQuoteRequest): Promise<FinalizeQuoteResult>
  openQuotePdf(id: number): Promise<OpenPdfResult>
  showQuotePdfInFolder(id: number): Promise<OpenPdfResult>
  /** PDF保存済みの見積書から請求書(下書き)を新規作成する(F-13) */
  convertQuoteToInvoice(quoteId: number): Promise<ConvertQuoteToInvoiceResult>
  listInvoices(filter?: InvoiceListFilter): Promise<InvoiceSummary[]>
  /** 対象が存在しない場合はPromiseがreject(例外)される(InvoiceService.getInvoice()参照) */
  getInvoice(id: number): Promise<InvoiceDetail>
  saveInvoiceDraft(request: SaveInvoiceDraftRequest): Promise<SaveInvoiceDraftResult>
  finalizeInvoice(request: FinalizeInvoiceRequest): Promise<FinalizeInvoiceResult>
  updateInvoicePaymentStatus(
    id: number,
    input: { paymentStatus: 'unpaid' | 'paid'; paymentDate?: string | null }
  ): Promise<{ success: true }>
  openInvoicePdf(id: number): Promise<OpenPdfResult>
  showInvoicePdfInFolder(id: number): Promise<OpenPdfResult>
}
