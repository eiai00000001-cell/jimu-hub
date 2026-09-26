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

import { AppIpcHandler } from './app.ipc-handler'

describe('AppIpcHandler', () => {
  beforeEach(() => {
    handlers.clear()
  })

  it('app:startup-statusで正常時の状態を返す', async () => {
    new AppIpcHandler({ ok: true }).registerHandlers()
    const handler = handlers.get(IPC_CHANNELS.appStartupStatus)!
    expect(await handler({})).toEqual({ ok: true })
  })

  it('app:startup-statusで異常時のメッセージを返す', async () => {
    new AppIpcHandler({ ok: false, message: 'エラーメッセージ' }).registerHandlers()
    const handler = handlers.get(IPC_CHANNELS.appStartupStatus)!
    expect(await handler({})).toEqual({ ok: false, message: 'エラーメッセージ' })
  })
})
