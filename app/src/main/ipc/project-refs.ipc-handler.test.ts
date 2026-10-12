import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc/channels'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Handler) => {
      handlers.set(channel, handler)
    })
  },
  shell: {}
}))

import { QuotesIpcHandler } from './quotes.ipc-handler'
import { InvoicesIpcHandler } from './invoices.ipc-handler'
import { RecordsIpcHandler } from './records.ipc-handler'
import type { QuoteService } from '../services/quote.service'
import type { InvoiceService } from '../services/invoice.service'
import type { CashRecordService } from '../services/cash-record.service'
import type { RecordHistoryService } from '../services/record-history.service'

const ref = { id: 7, name: 'サンプル案件', status: 'active' as const }

describe('詳細取得時の案件の付与(詳細設計書3.26章。quotes:get・invoices:get・records:get)', () => {
  const lookup = { findLinkedProjectRef: vi.fn() }
  const call = (channel: string, id: number): Promise<unknown> =>
    Promise.resolve(handlers.get(channel)!({}, id))

  beforeEach(() => {
    handlers.clear()
    lookup.findLinkedProjectRef.mockReset().mockReturnValue(ref)
    new QuotesIpcHandler(
      {
        getQuote: vi.fn((id: number) => ({ id, quoteNumber: '2026-001' }))
      } as unknown as QuoteService,
      {} as InvoiceService,
      '/tmp/documents',
      lookup
    ).registerHandlers()
    new InvoicesIpcHandler(
      {
        getInvoice: vi.fn((id: number) => ({ id, invoiceNumber: '2026-010' }))
      } as unknown as InvoiceService,
      '/tmp/documents',
      lookup
    ).registerHandlers()
    new RecordsIpcHandler(
      {
        getRecord: vi.fn((id: number) => ({ id, description: '交通費' }))
      } as unknown as CashRecordService,
      {} as RecordHistoryService,
      lookup
    ).registerHandlers()
  })

  it('見積書・請求書・入出金の詳細に、紐づく案件(名称・状態)を付ける', async () => {
    expect(await call(IPC_CHANNELS.quotesGet, 1)).toEqual({
      id: 1,
      quoteNumber: '2026-001',
      project: ref
    })
    expect(lookup.findLinkedProjectRef).toHaveBeenLastCalledWith('quote', 1)
    expect(await call(IPC_CHANNELS.invoicesGet, 2)).toEqual({
      id: 2,
      invoiceNumber: '2026-010',
      project: ref
    })
    expect(lookup.findLinkedProjectRef).toHaveBeenLastCalledWith('invoice', 2)
    expect(await call(IPC_CHANNELS.recordsGet, 3)).toEqual({
      id: 3,
      description: '交通費',
      project: ref
    })
    expect(lookup.findLinkedProjectRef).toHaveBeenLastCalledWith('cash_record', 3)
  })

  it('案件がなければprojectはnull', async () => {
    lookup.findLinkedProjectRef.mockReturnValue(null)
    expect(await call(IPC_CHANNELS.quotesGet, 1)).toMatchObject({ project: null })
  })

  it('案件の参照が無い構成(従来どおり)では、projectを付けずにそのまま返す', async () => {
    handlers.clear()
    new QuotesIpcHandler(
      { getQuote: vi.fn((id: number) => ({ id })) } as unknown as QuoteService,
      {} as InvoiceService,
      '/tmp/documents'
    ).registerHandlers()
    expect(await call(IPC_CHANNELS.quotesGet, 1)).toEqual({ id: 1 })
  })
})
