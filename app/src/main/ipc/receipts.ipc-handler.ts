import { app, BrowserWindow, dialog, ipcMain, nativeImage } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc/channels'
import { RECEIPT_LIMITS } from '@shared/constants/receipt'
import { RecordIdSchema } from '@shared/schemas/cash-record.schema'
import type { PickReceiptsResult } from '@shared/types/receipt'
import { readDevOnlyEnv } from '../app-security'
import type { ReceiptRepository } from '../repositories/receipt.repository'
import { ReceiptPreviewService, type ImageProcessor } from '../services/receipts/receipt-preview'
import type { ReceiptService } from '../services/receipts/receipt.service'
import { ReceiptOpener } from './receipt-opener'

/** Electronの`nativeImage`による画像処理 */
export const nativeImageProcessor: ImageProcessor = {
  load(buffer) {
    const image = nativeImage.createFromBuffer(buffer)
    if (image.isEmpty()) return null
    return { thumbnailDataUrl: (width) => image.resize({ width }).toDataURL() }
  }
}

/**
 * `receipts:*`チャンネルを受信するIPC層。ファイル選択ダイアログはMainで開き、Rendererにはパスを渡さない
 * (識別子`token`のみ)。領収書の参照は`id`のみで、応答にパス・ハッシュ値は含めない。
 * 参照元: 詳細設計書4.22章、5章(`ReceiptsIpcHandler`)、7章
 */
export class ReceiptsIpcHandler {
  private readonly opener: ReceiptOpener
  private readonly preview: ReceiptPreviewService

  constructor(
    private readonly receiptService: ReceiptService,
    private readonly receipts: ReceiptRepository,
    documentsDir: string,
    images: ImageProcessor = nativeImageProcessor
  ) {
    this.opener = new ReceiptOpener(documentsDir)
    this.preview = new ReceiptPreviewService(documentsDir, receipts, images)
  }

  registerHandlers(): void {
    ipcMain.handle(IPC_CHANNELS.receiptsPick, async () => this.pick())
    ipcMain.handle(IPC_CHANNELS.receiptsOpen, async (_e, id: unknown) =>
      this.opener.open(this.filePathOf(id))
    )
    ipcMain.handle(IPC_CHANNELS.receiptsShowInFolder, async (_e, id: unknown) =>
      this.opener.showInFolder(this.filePathOf(id))
    )
    ipcMain.handle(IPC_CHANNELS.receiptsThumbnail, async (_e, id: unknown) =>
      this.preview.getThumbnail(RecordIdSchema.parse(id))
    )
    ipcMain.handle(IPC_CHANNELS.receiptsPreview, async (_e, id: unknown) =>
      this.preview.getPreview(RecordIdSchema.parse(id))
    )
  }

  private filePathOf(id: unknown): string | null {
    return this.receipts.findById(RecordIdSchema.parse(id))?.filePath ?? null
  }

  private async pick(): Promise<PickReceiptsResult> {
    // E2Eテスト専用: OS標準ダイアログはPlaywrightから操作できないため、環境変数でパスが指定されている場合のみ
    // ダイアログ表示を省略する。配布版では環境変数を無視する(SEC-01と同じ方針)
    const override = readDevOnlyEnv('JIMUHUB_E2E_RECEIPT_PATHS', app.isPackaged)
    if (override) {
      return this.receiptService.pickAndStage(override.split(',').filter((p) => p !== ''))
    }
    const options = {
      properties: ['openFile' as const, 'multiSelections' as const],
      filters: [{ name: '領収書(PDF・画像)', extensions: [...RECEIPT_LIMITS.allowedExtensions] }]
    }
    const focused = BrowserWindow.getFocusedWindow()
    const result = focused
      ? await dialog.showOpenDialog(focused, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled) return { files: [], errors: [] }
    return this.receiptService.pickAndStage(result.filePaths)
  }
}
