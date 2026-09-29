import type { Client, ClientListFilter } from '../types/client'
import type { ClientInput } from '../schemas/client.schema'
import type { CompanyProfile } from '../types/company-profile'
import type { CompanyProfileInput } from '../schemas/company-profile.schema'
import type { Quote, QuoteSummary, QuoteListFilter } from '../types/quote'
import type { QuoteInput } from '../schemas/quote.schema'

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

export interface OpenPdfResult {
  success: true
}

/**
 * PreloadがcontextBridgeで公開するAPIの型(window.jimuhubApi)。
 * Renderer側はこの型を通じてのみMainプロセスとやり取りする。
 */
export interface JimuhubApi {
  getStartupStatus(): Promise<StartupStatus>
  listClients(filter?: ClientListFilter): Promise<Client[]>
  /** 対象が存在しない場合はPromiseがreject(例外)される(ClientService.getClient()参照) */
  getClient(id: number): Promise<Client>
  createClient(input: ClientInput): Promise<CreateClientResult>
  updateClient(id: number, input: ClientInput): Promise<UpdateClientResult>
  deactivateClient(id: number): Promise<DeactivateClientResult>
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
}
