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

import { AccountsIpcHandler } from './accounts.ipc-handler'
import { Database } from '../db/db'
import { AccountRepository } from '../repositories/account.repository'
import { AccountService } from '../services/account.service'

describe('AccountsIpcHandler(F-17)', () => {
  beforeEach(() => {
    handlers.clear()
    const db = new Database(':memory:')
    db.initialize()
    new AccountsIpcHandler(new AccountService(new AccountRepository(db))).registerHandlers()
  })

  const call = (channel: string, ...args: unknown[]): Promise<unknown> =>
    Promise.resolve(handlers.get(channel)!({}, ...args))

  it('全チャンネルを登録する', () => {
    for (const channel of [
      IPC_CHANNELS.accountsList,
      IPC_CHANNELS.accountsCreate,
      IPC_CHANNELS.accountsRename,
      IPC_CHANNELS.accountsDeactivate,
      IPC_CHANNELS.accountsReactivate,
      IPC_CHANNELS.accountsDelete
    ]) {
      expect(handlers.has(channel)).toBe(true)
    }
  })

  it('追加→一覧→名称変更→利用停止→再開→削除が動作する', async () => {
    const { id } = (await call(IPC_CHANNELS.accountsCreate, {
      name: '研修費',
      kind: 'expense'
    })) as {
      id: number
    }
    const list = (await call(IPC_CHANNELS.accountsList, { kind: 'expense' })) as Array<{
      id: number
      name: string
    }>
    expect(list.at(-1)).toMatchObject({ id, name: '研修費' })
    expect(await call(IPC_CHANNELS.accountsRename, id, '研修・教育費')).toEqual({ success: true })
    expect(await call(IPC_CHANNELS.accountsDeactivate, id)).toEqual({ success: true })
    expect(await call(IPC_CHANNELS.accountsReactivate, id)).toEqual({ success: true })
    expect(await call(IPC_CHANNELS.accountsDelete, id)).toEqual({ success: true })
  })

  it('IPC境界で不正な入力を拒否する', async () => {
    await expect(call(IPC_CHANNELS.accountsDelete, 'abc')).rejects.toThrow()
    await expect(call(IPC_CHANNELS.accountsCreate, { name: '', kind: 'expense' })).rejects.toThrow()
    await expect(call(IPC_CHANNELS.accountsCreate, { name: 'x', kind: 'other' })).rejects.toThrow()
    await expect(call(IPC_CHANNELS.accountsList, { kind: 'other' })).rejects.toThrow()
    await expect(call(IPC_CHANNELS.accountsRename, 1, 123)).rejects.toThrow()
  })
})
