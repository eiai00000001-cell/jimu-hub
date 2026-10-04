import { describe, expect, it, vi, beforeEach } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc/channels'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn((c: string, h: Handler) => handlers.set(c, h)) }
}))

import { ReportsIpcHandler } from './reports.ipc-handler'
import { Database } from '../db/db'
import { SummaryRepository } from '../repositories/summary.repository'
import { SummaryService } from '../services/summary.service'

describe('ReportsIpcHandler(F-23)', () => {
  beforeEach(() => {
    handlers.clear()
    const db = new Database(':memory:')
    db.initialize()
    new ReportsIpcHandler(new SummaryService(new SummaryRepository(db))).registerHandlers()
  })
  const call = (c: string, ...a: unknown[]): Promise<unknown> =>
    Promise.resolve(handlers.get(c)!({}, ...a))

  it('summary:getは集計を返し、不正な入力は拒否する', async () => {
    const r = (await call(IPC_CHANNELS.summaryGet, { year: 2026, month: null })) as {
      monthly: unknown[]
    }
    expect(r.monthly).toHaveLength(12)
    await expect(call(IPC_CHANNELS.summaryGet, { year: 'x', month: null })).rejects.toThrow()
    await expect(call(IPC_CHANNELS.summaryGet, { year: 2026, month: 0 })).rejects.toThrow()
    await expect(call(IPC_CHANNELS.summaryGet, undefined)).rejects.toThrow()
  })
})
