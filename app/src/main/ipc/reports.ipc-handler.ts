import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc/channels'
import { SummaryInputSchema } from '@shared/schemas/summary.schema'
import type { SummaryService } from '../services/summary.service'

/**
 * `summary:get`(集計)と`csv:export`(CSV出力)を受信するIPC層。入力はIPC境界でZodスキーマにより再検証する。
 * 参照元: 詳細設計書4.23・4.24章、5章(`ReportsIpcHandler`)、7章
 */
export class ReportsIpcHandler {
  constructor(private readonly summaryService: SummaryService) {}

  registerHandlers(): void {
    ipcMain.handle(IPC_CHANNELS.summaryGet, async (_event, input: unknown) =>
      this.summaryService.getSummary(SummaryInputSchema.parse(input))
    )
  }
}
