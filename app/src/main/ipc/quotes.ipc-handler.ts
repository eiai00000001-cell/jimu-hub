import { ipcMain, shell } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc/channels'
import {
  QuoteIdSchema,
  OptionalQuoteIdSchema,
  QuoteListFilterSchema
} from '@shared/schemas/ipc.schema'
import type { QuoteListFilter } from '@shared/types/quote'
import type { SaveQuoteDraftRequest, FinalizeQuoteRequest, OpenPdfResult } from '@shared/ipc/api'
import type { QuoteService } from '../services/quote.service'

function parseId(id: unknown): number {
  return QuoteIdSchema.parse(id)
}

function parseFilter(filter: unknown): QuoteListFilter {
  return QuoteListFilterSchema.parse(filter ?? {})
}

/**
 * `quotes:*`チャンネルを受信し`QuoteService`を呼び出すIPC層。
 * id・filterはIPC境界でZodスキーマにより実行時バリデーションし、`QuoteInput`本体は
 * 詳細設計書どおりService層(`QuoteInputSchema`)でバリデーションする(レビュー結果報告書 v0.0 No.3の方針を踏襲)。
 * 参照元: 詳細設計書 4.12・4.13章、5章(クラス設計 `QuoteIpcHandler`)、7章(API/インターフェース設計)
 */
export class QuotesIpcHandler {
  constructor(private readonly service: QuoteService) {}

  registerHandlers(): void {
    ipcMain.handle(IPC_CHANNELS.quotesList, async (_event, filter?: unknown) =>
      this.service.listQuotes(parseFilter(filter))
    )
    ipcMain.handle(IPC_CHANNELS.quotesGet, async (_event, id: unknown) =>
      this.service.getQuote(parseId(id))
    )
    ipcMain.handle(IPC_CHANNELS.quotesSaveDraft, async (_event, payload: SaveQuoteDraftRequest) => {
      const { id, ...input } = payload
      return this.service.saveDraft(input, OptionalQuoteIdSchema.parse(id))
    })
    ipcMain.handle(IPC_CHANNELS.quotesFinalize, async (_event, payload: FinalizeQuoteRequest) => {
      const { id, ...input } = payload
      return this.service.finalizeQuote(input, OptionalQuoteIdSchema.parse(id))
    })
    ipcMain.handle(IPC_CHANNELS.quotesOpenPdf, async (_event, id: unknown) =>
      this.openPdf(parseId(id))
    )
    ipcMain.handle(IPC_CHANNELS.quotesShowPdfInFolder, async (_event, id: unknown) =>
      this.showPdfInFolder(parseId(id))
    )
  }

  private async openPdf(id: number): Promise<OpenPdfResult> {
    const quote = this.service.getQuote(id)
    if (quote.pdfPath) {
      await shell.openPath(quote.pdfPath)
    }
    return { success: true }
  }

  private showPdfInFolder(id: number): OpenPdfResult {
    const quote = this.service.getQuote(id)
    if (quote.pdfPath) {
      shell.showItemInFolder(quote.pdfPath)
    }
    return { success: true }
  }
}
