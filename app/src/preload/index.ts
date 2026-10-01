import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc/channels'
import type {
  JimuhubApi,
  SaveQuoteDraftRequest,
  FinalizeQuoteRequest,
  SaveInvoiceDraftRequest,
  FinalizeInvoiceRequest
} from '@shared/ipc/api'
import type { ClientInput } from '@shared/schemas/client.schema'
import type { ClientListFilter } from '@shared/types/client'
import type { CompanyProfileInput } from '@shared/schemas/company-profile.schema'
import type { QuoteListFilter } from '@shared/types/quote'
import type { InvoiceListFilter } from '@shared/types/invoice'

/**
 * contextBridgeでRendererに安全なAPIのみを公開するPreloadスクリプト。
 * 参照元: 詳細設計書 5章(クラス設計 `jimuhubApi`)、7章(API/インターフェース設計)
 */
const jimuhubApi: JimuhubApi = {
  getStartupStatus: () => ipcRenderer.invoke(IPC_CHANNELS.appStartupStatus),
  listClients: (filter?: ClientListFilter) => ipcRenderer.invoke(IPC_CHANNELS.clientsList, filter),
  getClient: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.clientsGet, id),
  createClient: (input: ClientInput) => ipcRenderer.invoke(IPC_CHANNELS.clientsCreate, input),
  updateClient: (id: number, input: ClientInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.clientsUpdate, id, input),
  deactivateClient: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.clientsDeactivate, id),
  exportData: () => ipcRenderer.invoke(IPC_CHANNELS.dataExport),
  importData: () => ipcRenderer.invoke(IPC_CHANNELS.dataImport),
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
