import type { Client, ClientListFilter } from '../types/client'
import type { ClientInput } from '../schemas/client.schema'
import type { CompanyProfile } from '../types/company-profile'
import type { CompanyProfileInput } from '../schemas/company-profile.schema'
import type { AccountView, AccountListFilter } from '../types/account'
import type { AccountInput } from '../schemas/account.schema'
import type { CsvExportInput } from '../schemas/csv-export.schema'
import type { SummaryInput } from '../schemas/summary.schema'
import type {
  ProjectDetail,
  ProjectLinkHistoryEntry,
  ProjectLinkTargetType,
  ProjectListItem,
  ProjectSelectable
} from '../types/project'
import type { ProjectInput, ProjectLinkChange, ProjectListFilter } from '../schemas/project.schema'
import type { SummaryResult } from '../types/summary'
import type { PickReceiptsResult, ReceiptPreviewResult } from '../types/receipt'
import type {
  CashRecordDetail,
  CashRecordSummary,
  HistoryListFilter,
  HistoryListItem,
  Paged,
  RecordListFilter
} from '../types/cash-record'
import type {
  CashRecordCreateInput,
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
  /** 見込みサイズが復元上限の80%を超える場合の警告。利用者が続行を選んだ場合のみ`confirmLarge`付きで再実行する */
  warnLargeBackup?: boolean
}

/**
 * エクスポート・復元の進捗の通知(`data:progress`)。`stage`ごとに`current`・`total`の単位が異なる
 * (records=テーブル数、files=PDF・領収書の件数、packing=ZIPの仕上げ、extract=展開したファイル数、verify=照合したファイル数)。
 */
export interface DataProgress {
  phase: 'export' | 'import'
  stage: 'records' | 'files' | 'packing' | 'extract' | 'verify'
  current: number
  total: number
}

export interface ImportDataResult {
  success: boolean
  importedCount?: number
  pdfHashMismatchCount?: number
  receiptHashMismatchCount?: number
  recordHashMismatchCount?: number
  error?: string
}

/** 復元ファイルの事前確認の結果(`data:inspectBackup`。詳細設計書4.33章) */
export interface BackupInspection {
  /** `data:import`へ渡す識別子(30分有効) */
  token: string
  fileName: string
  schemaVersion: number
  hasReceipts: boolean
  hasProjects: boolean
  currentReceiptCount: number
  currentProjectCount: number
  /** 領収書・案件が消える旨の確認画面が必要か */
  needsConfirmation: boolean
}

export type InspectBackupResult =
  | { success: true; inspection: BackupInspection }
  | { success: false; canceled?: true; error?: string }

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

/** CSV出力の結果。0件は`empty`、保存ダイアログのキャンセルは`canceled`(詳細設計書7章) */
export type CsvExportResult =
  | { success: true; filePath: string; count: number }
  | { success: false; reason: 'empty' | 'canceled' | 'error'; error?: string }

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
  /** 案件(F-27〜F-30)。対象が存在しない場合などはPromiseがrejectされ、メッセージは`PROJECT_MESSAGES`の文言 */
  listProjects(filter?: ProjectListFilter): Promise<ProjectListItem[]>
  getProject(id: number): Promise<ProjectDetail>
  createProject(input: ProjectInput): Promise<{ id: number }>
  updateProject(id: number, input: ProjectInput): Promise<{ success: true }>
  deleteProject(id: number): Promise<{ success: true }>
  completeProject(id: number): Promise<{ success: true }>
  reopenProject(id: number): Promise<{ success: true }>
  /** 紐づけ先の候補(進行中の案件。`includeId`の案件は完了でも含める) */
  listSelectableProjects(includeId?: number): Promise<ProjectSelectable[]>
  changeProjectLink(change: ProjectLinkChange): Promise<{ changed: boolean }>
  listProjectLinkHistory(
    targetType: ProjectLinkTargetType,
    targetId: number
  ): Promise<ProjectLinkHistoryEntry[]>
  listAccounts(filter?: AccountListFilter): Promise<AccountView[]>
  createAccount(input: AccountInput): Promise<{ id: number }>
  renameAccount(id: number, name: string): Promise<DeactivateClientResult>
  deactivateAccount(id: number): Promise<DeactivateClientResult>
  reactivateAccount(id: number): Promise<DeactivateClientResult>
  deleteAccount(id: number): Promise<DeactivateClientResult>
  exportCsv(input: CsvExportInput): Promise<CsvExportResult>
  getSummary(input: SummaryInput): Promise<SummaryResult>
  pickReceipts(): Promise<PickReceiptsResult>
  openReceipt(id: number): Promise<OpenPdfResult>
  showReceiptInFolder(id: number): Promise<OpenPdfResult>
  getReceiptThumbnail(id: number): Promise<ReceiptPreviewResult>
  getReceiptPreview(id: number): Promise<ReceiptPreviewResult>
  listRecords(filter?: RecordListFilter): Promise<Paged<CashRecordSummary>>
  getRecord(id: number): Promise<CashRecordDetail>
  createRecord(input: CashRecordCreateInput): Promise<{ id: number }>
  updateRecord(input: CashRecordUpdateInput): Promise<{ id: number; changed: boolean }>
  deleteRecord(input: CashRecordDeleteInput): Promise<DeactivateClientResult>
  listRecordHistory(filter?: HistoryListFilter): Promise<Paged<HistoryListItem>>
  deactivateClient(id: number): Promise<DeactivateClientResult>
  /** 利用停止の取引先を利用中へ戻す(F-25)。存在しない・既に利用中の場合はreject */
  reactivateClient(id: number): Promise<DeactivateClientResult>
  exportData(options?: { confirmLarge?: boolean }): Promise<ExportDataResult>
  /** 進捗の通知を購読する。購読解除関数を返す */
  onDataProgress(callback: (progress: DataProgress) => void): () => void
  /** 復元ファイルを選択し、現在のデータを変更せずに内容を確認する(F-33) */
  inspectBackup(): Promise<InspectBackupResult>
  /** 確認画面で「キャンセル」した場合に、選択済みファイルの情報を破棄する */
  discardBackup(token: string): Promise<{ success: true }>
  /** `token`は`inspectBackup`が返した識別子。省略時はMainがファイル選択ダイアログを開く(起動エラー画面) */
  importData(options?: { token: string }): Promise<ImportDataResult>
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
