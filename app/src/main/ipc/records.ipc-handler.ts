import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc/channels'
import {
  CashRecordDeleteSchema,
  CashRecordCreateSchema,
  CashRecordUpdateSchema,
  HistoryListFilterSchema,
  RecordIdSchema,
  RecordListFilterSchema
} from '@shared/schemas/cash-record.schema'
import type { CashRecordService } from '../services/cash-record.service'
import type { RecordHistoryService } from '../services/record-history.service'

/**
 * `records:*`・`recordHistory:list`チャンネルを受信し、Service層を呼び出すIPC層。
 * IPC境界でZodスキーマにより再検証する(詳細設計書4.18・4.19章)。
 * 参照元: 詳細設計書5章(`RecordsIpcHandler`)、7章
 */
export class RecordsIpcHandler {
  constructor(
    private readonly service: CashRecordService,
    private readonly historyService: RecordHistoryService
  ) {}

  registerHandlers(): void {
    ipcMain.handle(IPC_CHANNELS.recordsList, async (_event, filter?: unknown) =>
      this.service.listRecords(RecordListFilterSchema.parse(filter ?? {}))
    )
    ipcMain.handle(IPC_CHANNELS.recordsGet, async (_event, id: unknown) =>
      this.service.getRecord(RecordIdSchema.parse(id))
    )
    ipcMain.handle(IPC_CHANNELS.recordsCreate, async (_event, input: unknown) =>
      this.service.createRecord(CashRecordCreateSchema.parse(input))
    )
    ipcMain.handle(IPC_CHANNELS.recordsUpdate, async (_event, input: unknown) =>
      this.service.updateRecord(CashRecordUpdateSchema.parse(input))
    )
    ipcMain.handle(IPC_CHANNELS.recordsDelete, async (_event, input: unknown) =>
      this.service.deleteRecord(CashRecordDeleteSchema.parse(input))
    )
    ipcMain.handle(IPC_CHANNELS.recordHistoryList, async (_event, filter?: unknown) =>
      this.historyService.listHistory(HistoryListFilterSchema.parse(filter ?? {}))
    )
  }
}
