import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc/channels'
import type { CsvExportResult } from '@shared/ipc/api'
import { CSV_MESSAGES } from '@shared/messages/messages'
import { CsvExportInputSchema } from '@shared/schemas/csv-export.schema'
import { SummaryInputSchema } from '@shared/schemas/summary.schema'
import { readDevOnlyEnv } from '../app-security'
import { CsvWriteError, type CsvExportService } from '../services/csv-export.service'
import type { SummaryService } from '../services/summary.service'

/**
 * `summary:get`(集計)と`csv:export`(CSV出力)を受信するIPC層。入力はIPC境界でZodスキーマにより再検証する。
 * 参照元: 詳細設計書4.23・4.24章、5章(`ReportsIpcHandler`)、7章
 */
export class ReportsIpcHandler {
  constructor(
    private readonly summaryService: SummaryService,
    private readonly csvService: CsvExportService
  ) {}

  registerHandlers(): void {
    ipcMain.handle(IPC_CHANNELS.summaryGet, async (_event, input: unknown) =>
      this.summaryService.getSummary(SummaryInputSchema.parse(input))
    )
    ipcMain.handle(IPC_CHANNELS.csvExport, async (_event, input: unknown) =>
      this.exportCsv(CsvExportInputSchema.parse(input))
    )
  }

  private async exportCsv(input: { fromMonth: string; toMonth: string }): Promise<CsvExportResult> {
    const { fromMonth, toMonth } = input
    // 0件の場合は、保存ダイアログを開かず、ファイルも作成しない
    if (this.csvService.countTargets(fromMonth, toMonth) === 0) {
      return { success: false, reason: 'empty', error: CSV_MESSAGES.empty }
    }

    // E2Eテスト専用: OS標準ダイアログはPlaywrightから操作できないため、環境変数でパスが指定されている場合のみ
    // ダイアログ表示を省略する。配布版では環境変数を無視する(SEC-01と同じ方針)
    let filePath = readDevOnlyEnv('JIMUHUB_E2E_CSV_PATH', app.isPackaged)
    if (!filePath) {
      const options = {
        defaultPath: `${app.getPath('documents')}/事務HUB_入出金経費_${fromMonth}_${toMonth}.csv`,
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      }
      const focused = BrowserWindow.getFocusedWindow()
      const result = focused
        ? await dialog.showSaveDialog(focused, options)
        : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return { success: false, reason: 'canceled' }
      filePath = result.filePath
    }

    try {
      const { count } = this.csvService.export(fromMonth, toMonth, filePath)
      return { success: true, filePath, count }
    } catch (error) {
      return {
        success: false,
        reason: 'error',
        error: error instanceof CsvWriteError ? error.message : CSV_MESSAGES.writeFailure
      }
    }
  }
}
