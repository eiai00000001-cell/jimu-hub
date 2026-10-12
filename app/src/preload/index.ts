import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc/channels'
import type {
  JimuhubApi,
  DataProgress,
  SaveQuoteDraftRequest,
  FinalizeQuoteRequest,
  SaveInvoiceDraftRequest,
  FinalizeInvoiceRequest
} from '@shared/ipc/api'
import type { ClientInput } from '@shared/schemas/client.schema'
import type { ClientListFilter } from '@shared/types/client'
import type { CompanyProfileInput } from '@shared/schemas/company-profile.schema'
import type {
  ProjectInput,
  ProjectLinkChange,
  ProjectListFilter
} from '@shared/schemas/project.schema'
import type { ProjectLinkTargetType } from '@shared/types/project'
import type { AccountListFilter } from '@shared/types/account'
import type { AccountInput } from '@shared/schemas/account.schema'
import type { CsvExportInput } from '@shared/schemas/csv-export.schema'
import type { SummaryInput } from '@shared/schemas/summary.schema'
import type { RecordListFilter, HistoryListFilter } from '@shared/types/cash-record'
import type {
  CashRecordCreateInput,
  CashRecordUpdateInput,
  CashRecordDeleteInput
} from '@shared/schemas/cash-record.schema'
import type { QuoteListFilter } from '@shared/types/quote'
import type { InvoiceListFilter } from '@shared/types/invoice'

/**
 * contextBridgeでRendererに安全なAPIのみを公開するPreloadスクリプト。
 * 参照元: 詳細設計書 5章(クラス設計 `jimuhubApi`)、7章(API/インターフェース設計)
 */
const jimuhubApi: JimuhubApi = {
  getStartupStatus: () => ipcRenderer.invoke(IPC_CHANNELS.appStartupStatus),
  relaunchApp: () => ipcRenderer.invoke(IPC_CHANNELS.appRelaunch),
  listClients: (filter?: ClientListFilter) => ipcRenderer.invoke(IPC_CHANNELS.clientsList, filter),
  getClient: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.clientsGet, id),
  createClient: (input: ClientInput) => ipcRenderer.invoke(IPC_CHANNELS.clientsCreate, input),
  updateClient: (id: number, input: ClientInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.clientsUpdate, id, input),
  deactivateClient: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.clientsDeactivate, id),
  reactivateClient: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.clientsReactivate, id),
  deleteQuoteDraft: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.quotesDeleteDraft, id),
  deleteInvoiceDraft: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.invoicesDeleteDraft, id),
  listProjects: (filter?: ProjectListFilter) =>
    ipcRenderer.invoke(IPC_CHANNELS.projectsList, filter),
  getProject: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.projectsGet, id),
  createProject: (input: ProjectInput) => ipcRenderer.invoke(IPC_CHANNELS.projectsCreate, input),
  updateProject: (id: number, input: ProjectInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.projectsUpdate, id, input),
  deleteProject: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.projectsDelete, id),
  completeProject: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.projectsComplete, id),
  reopenProject: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.projectsReopen, id),
  listSelectableProjects: (includeId?: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.projectsListSelectable, includeId),
  changeProjectLink: (change: ProjectLinkChange) =>
    ipcRenderer.invoke(IPC_CHANNELS.projectLinksChange, change),
  listProjectLinkHistory: (targetType: ProjectLinkTargetType, targetId: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.projectLinksHistory, targetType, targetId),
  listAccounts: (filter?: AccountListFilter) =>
    ipcRenderer.invoke(IPC_CHANNELS.accountsList, filter),
  createAccount: (input: AccountInput) => ipcRenderer.invoke(IPC_CHANNELS.accountsCreate, input),
  renameAccount: (id: number, name: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.accountsRename, id, name),
  deactivateAccount: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.accountsDeactivate, id),
  reactivateAccount: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.accountsReactivate, id),
  deleteAccount: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.accountsDelete, id),
  exportCsv: (input: CsvExportInput) => ipcRenderer.invoke(IPC_CHANNELS.csvExport, input),
  getSummary: (input: SummaryInput) => ipcRenderer.invoke(IPC_CHANNELS.summaryGet, input),
  pickReceipts: () => ipcRenderer.invoke(IPC_CHANNELS.receiptsPick),
  openReceipt: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.receiptsOpen, id),
  showReceiptInFolder: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.receiptsShowInFolder, id),
  getReceiptThumbnail: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.receiptsThumbnail, id),
  getReceiptPreview: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.receiptsPreview, id),
  listRecords: (filter?: RecordListFilter) => ipcRenderer.invoke(IPC_CHANNELS.recordsList, filter),
  getRecord: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.recordsGet, id),
  createRecord: (input: CashRecordCreateInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.recordsCreate, input),
  updateRecord: (input: CashRecordUpdateInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.recordsUpdate, input),
  deleteRecord: (input: CashRecordDeleteInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.recordsDelete, input),
  listRecordHistory: (filter?: HistoryListFilter) =>
    ipcRenderer.invoke(IPC_CHANNELS.recordHistoryList, filter),
  exportData: (options?: { confirmLarge?: boolean }) =>
    ipcRenderer.invoke(IPC_CHANNELS.dataExport, options),
  onDataProgress: (callback: (progress: DataProgress) => void) => {
    const listener = (_event: unknown, progress: DataProgress): void => callback(progress)
    ipcRenderer.on(IPC_CHANNELS.dataProgress, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.dataProgress, listener)
    }
  },
  inspectBackup: () => ipcRenderer.invoke(IPC_CHANNELS.dataInspectBackup),
  discardBackup: (token: string) => ipcRenderer.invoke(IPC_CHANNELS.dataDiscardBackup, { token }),
  importData: (options?: { token: string }) => ipcRenderer.invoke(IPC_CHANNELS.dataImport, options),
  getCompanyProfile: () => ipcRenderer.invoke(IPC_CHANNELS.companyGet),
  saveCompanyProfile: (input: CompanyProfileInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.companySave, input),
  listQuotes: (filter?: QuoteListFilter) => ipcRenderer.invoke(IPC_CHANNELS.quotesList, filter),
  getQuote: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.quotesGet, id),
  saveQuoteDraft: (request: SaveQuoteDraftRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.quotesSaveDraft, request),
  finalizeQuote: (request: FinalizeQuoteRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.quotesFinalize, request),
  openQuotePdf: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.quotesOpenPdf, id),
  showQuotePdfInFolder: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.quotesShowPdfInFolder, id),
  convertQuoteToInvoice: (quoteId: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.quotesConvertToInvoice, quoteId),
  listInvoices: (filter?: InvoiceListFilter) =>
    ipcRenderer.invoke(IPC_CHANNELS.invoicesList, filter),
  getInvoice: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.invoicesGet, id),
  saveInvoiceDraft: (request: SaveInvoiceDraftRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.invoicesSaveDraft, request),
  finalizeInvoice: (request: FinalizeInvoiceRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.invoicesFinalize, request),
  updateInvoicePaymentStatus: (
    id: number,
    input: { paymentStatus: 'unpaid' | 'paid'; paymentDate?: string | null }
  ) => ipcRenderer.invoke(IPC_CHANNELS.invoicesUpdatePaymentStatus, id, input),
  openInvoicePdf: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.invoicesOpenPdf, id),
  showInvoicePdfInFolder: (id: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.invoicesShowPdfInFolder, id)
}

contextBridge.exposeInMainWorld('jimuhubApi', jimuhubApi)
