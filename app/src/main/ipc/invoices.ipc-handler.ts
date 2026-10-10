import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc/channels'
import {
  InvoiceIdSchema,
  OptionalInvoiceIdSchema,
  InvoiceListFilterSchema
} from '@shared/schemas/ipc.schema'
import type { PaymentStatusInput } from '@shared/schemas/invoice.schema'
import type { InvoiceListFilter } from '@shared/types/invoice'
import type {
  SaveInvoiceDraftRequest,
  FinalizeInvoiceRequest,
  OpenPdfResult
} from '@shared/ipc/api'
import type { InvoiceService } from '../services/invoice.service'
import type { ProjectRefLookup } from '../repositories/project.repository'
import { PdfOpener } from './pdf-opener'

function parseId(id: unknown): number {
  return InvoiceIdSchema.parse(id)
}

function parseFilter(filter: unknown): InvoiceListFilter {
  return InvoiceListFilterSchema.parse(filter ?? {})
}

/**
 * `invoices:*`チャンネルを受信し`InvoiceService`を呼び出すIPC層(QuotesIpcHandlerと同一方針)。
 * 参照元: 詳細設計書 4.14〜4.16章、5章(クラス設計 `InvoiceIpcHandler`)、7章
 */
export class InvoicesIpcHandler {
  private readonly pdfOpener: PdfOpener

  constructor(
    private readonly service: InvoiceService,
    documentsDir: string,
    private readonly projectRefs?: ProjectRefLookup
  ) {
    this.pdfOpener = new PdfOpener(documentsDir)
  }

  registerHandlers(): void {
    ipcMain.handle(IPC_CHANNELS.invoicesList, async (_event, filter?: unknown) =>
      this.service.listInvoices(parseFilter(filter))
    )
    ipcMain.handle(IPC_CHANNELS.invoicesDeleteDraft, async (_event, id: unknown) =>
      this.service.deleteDraft(parseId(id))
    )
    ipcMain.handle(IPC_CHANNELS.invoicesGet, async (_event, id: unknown) => {
      const invoice = this.service.getInvoice(parseId(id))
      return this.projectRefs
        ? { ...invoice, project: this.projectRefs.findLinkedProjectRef('invoice', invoice.id) }
        : invoice
    })
    ipcMain.handle(
      IPC_CHANNELS.invoicesSaveDraft,
      async (_event, payload: SaveInvoiceDraftRequest) => {
        const { id, ...input } = payload
        return this.service.saveDraft(input, OptionalInvoiceIdSchema.parse(id))
      }
    )
    ipcMain.handle(
      IPC_CHANNELS.invoicesFinalize,
      async (_event, payload: FinalizeInvoiceRequest) => {
        const { id, ...input } = payload
        return this.service.finalizeInvoice(input, OptionalInvoiceIdSchema.parse(id))
      }
    )
    ipcMain.handle(
      IPC_CHANNELS.invoicesUpdatePaymentStatus,
      async (_event, id: unknown, input: PaymentStatusInput) =>
        this.service.updatePaymentStatus(parseId(id), input)
    )
    ipcMain.handle(IPC_CHANNELS.invoicesOpenPdf, async (_event, id: unknown) =>
      this.openPdf(parseId(id))
    )
    ipcMain.handle(IPC_CHANNELS.invoicesShowPdfInFolder, async (_event, id: unknown) =>
      this.showPdfInFolder(parseId(id))
    )
  }

  private async openPdf(id: number): Promise<OpenPdfResult> {
    return this.pdfOpener.open(this.service.getInvoice(id).pdfPath)
  }

  private showPdfInFolder(id: number): OpenPdfResult {
    return this.pdfOpener.showInFolder(this.service.getInvoice(id).pdfPath)
  }
}
