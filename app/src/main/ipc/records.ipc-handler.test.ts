import { describe, expect, it, vi, beforeEach } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc/channels'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Handler) => {
      handlers.set(channel, handler)
    })
  }
}))

import { RecordsIpcHandler } from './records.ipc-handler'
import { Database } from '../db/db'
import { createRecordServices } from '../services/record-services'

const input = {
  kind: 'expense',
  recordDate: '2026-09-28',
  amount: 6600,
  accountId: 1,
  description: 'インターネット回線',
  clientId: null,
  paymentMethod: null,
  taxCategory: 'standard_10'
}

describe('RecordsIpcHandler(F-18〜F-20)', () => {
  beforeEach(() => {
    handlers.clear()
    const db = new Database(':memory:')
    db.initialize()
    const s = createRecordServices(db)
    new RecordsIpcHandler(s.cashRecordService, s.historyService).registerHandlers()
  })

  const call = (channel: string, ...args: unknown[]): Promise<unknown> =>
    Promise.resolve(handlers.get(channel)!({}, ...args))

  it('全チャンネルを登録する', () => {
    for (const c of [
      IPC_CHANNELS.recordsList,
      IPC_CHANNELS.recordsGet,
      IPC_CHANNELS.recordsCreate,
      IPC_CHANNELS.recordsUpdate,
      IPC_CHANNELS.recordsDelete,
      IPC_CHANNELS.recordHistoryList
    ]) {
      expect(handlers.has(c)).toBe(true)
    }
  })

  it('登録→一覧→詳細→更新→履歴→削除が動作する', async () => {
    const { id } = (await call(IPC_CHANNELS.recordsCreate, input)) as { id: number }
    const list = (await call(IPC_CHANNELS.recordsList, {})) as { totalCount: number }
    expect(list.totalCount).toBe(1)
    const detail = (await call(IPC_CHANNELS.recordsGet, id)) as { taxAmount: number }
    expect(detail.taxAmount).toBe(600)
    expect(
      await call(IPC_CHANNELS.recordsUpdate, { ...input, id, amount: 11000, reason: '訂正' })
    ).toEqual({ id, changed: true })
    const history = (await call(IPC_CHANNELS.recordHistoryList, { operation: 'update' })) as {
      items: Array<{ reason: string }>
    }
    expect(history.items[0]?.reason).toBe('訂正')
    expect(await call(IPC_CHANNELS.recordsDelete, { id })).toEqual({ success: true })
  })

  it('IPC境界で不正な入力を拒否する', async () => {
    await expect(call(IPC_CHANNELS.recordsCreate, { ...input, amount: 0 })).rejects.toThrow()
    await expect(call(IPC_CHANNELS.recordsGet, 'abc')).rejects.toThrow()
    await expect(
      call(IPC_CHANNELS.recordsList, { dateFrom: '2026-10-02', dateTo: '2026-10-01' })
    ).rejects.toThrow()
    await expect(call(IPC_CHANNELS.recordsList, { amountMin: 10, amountMax: 1 })).rejects.toThrow()
    await expect(call(IPC_CHANNELS.recordHistoryList, { operation: 'x' })).rejects.toThrow()
    await expect(call(IPC_CHANNELS.recordsDelete, { id: 0 })).rejects.toThrow()
  })
})
