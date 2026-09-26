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

import { ClientIpcHandler } from './client.ipc-handler'
import { Database } from '../db/db'
import { ClientRepository } from '../repositories/client.repository'
import { ClientService } from '../services/client.service'
import type { ClientInput } from '@shared/schemas/client.schema'

const baseInput: ClientInput = {
  name: '株式会社サンプル',
  honorific: '御中',
  contactPerson: '',
  postalCode: '',
  address: '',
  phone: '',
  email: '',
  invoiceRegistrationNumber: '',
  memo: ''
}

describe('ClientIpcHandler', () => {
  let db: Database
  let service: ClientService

  beforeEach(() => {
    handlers.clear()
    db = new Database(':memory:')
    db.initialize()
    service = new ClientService(new ClientRepository(db))
    new ClientIpcHandler(service).registerHandlers()
  })

  it('全チャンネルを登録する', () => {
    expect(handlers.has(IPC_CHANNELS.clientsList)).toBe(true)
    expect(handlers.has(IPC_CHANNELS.clientsGet)).toBe(true)
    expect(handlers.has(IPC_CHANNELS.clientsCreate)).toBe(true)
    expect(handlers.has(IPC_CHANNELS.clientsUpdate)).toBe(true)
    expect(handlers.has(IPC_CHANNELS.clientsDeactivate)).toBe(true)
  })

  it('clients:createはClientServiceへ委譲し登録結果を返す', async () => {
    const handler = handlers.get(IPC_CHANNELS.clientsCreate)!
    const result = await handler({}, baseInput)
    expect(result).toEqual({ id: expect.any(Number) })
  })

  it('clients:listはClientServiceへ委譲し一覧を返す', async () => {
    const createHandler = handlers.get(IPC_CHANNELS.clientsCreate)!
    await createHandler({}, baseInput)

    const listHandler = handlers.get(IPC_CHANNELS.clientsList)!
    const result = await listHandler({}, {})
    expect(result).toHaveLength(1)
  })

  it('clients:getはClientServiceへ委譲し詳細を返す', async () => {
    const createHandler = handlers.get(IPC_CHANNELS.clientsCreate)!
    const created = (await createHandler({}, baseInput)) as { id: number }

    const getHandler = handlers.get(IPC_CHANNELS.clientsGet)!
    const result = (await getHandler({}, created.id)) as { name: string }
    expect(result.name).toBe('株式会社サンプル')
  })

  it('clients:deactivateはClientServiceへ委譲し状態を変更する', async () => {
    const createHandler = handlers.get(IPC_CHANNELS.clientsCreate)!
    const created = (await createHandler({}, baseInput)) as { id: number }

    const deactivateHandler = handlers.get(IPC_CHANNELS.clientsDeactivate)!
    const result = await deactivateHandler({}, created.id)
    expect(result).toEqual({ success: true })

    const getHandler = handlers.get(IPC_CHANNELS.clientsGet)!
    const found = (await getHandler({}, created.id)) as { status: string }
    expect(found.status).toBe('inactive')
  })

  describe('IPC境界での実行時バリデーション(レビュー結果報告書 No.3)', () => {
    it('clients:getは不正なid(文字列)の場合はエラーになる', async () => {
      const handler = handlers.get(IPC_CHANNELS.clientsGet)!
      await expect(handler({}, 'abc')).rejects.toThrow()
    })

    it('clients:getは不正なid(0以下)の場合はエラーになる', async () => {
      const handler = handlers.get(IPC_CHANNELS.clientsGet)!
      await expect(handler({}, 0)).rejects.toThrow()
    })

    it('clients:updateは不正なidの場合はエラーになる', async () => {
      const handler = handlers.get(IPC_CHANNELS.clientsUpdate)!
      await expect(handler({}, 'abc', baseInput)).rejects.toThrow()
    })

    it('clients:deactivateは不正なidの場合はエラーになる', async () => {
      const handler = handlers.get(IPC_CHANNELS.clientsDeactivate)!
      await expect(handler({}, 'abc')).rejects.toThrow()
    })

    it('clients:listは不正なsort値の場合はエラーになる', async () => {
      const handler = handlers.get(IPC_CHANNELS.clientsList)!
      await expect(handler({}, { sort: 'unknown_sort' })).rejects.toThrow()
    })

    it('clients:listは不正なstatusFilter値の場合はエラーになる', async () => {
      const handler = handlers.get(IPC_CHANNELS.clientsList)!
      await expect(handler({}, { statusFilter: 'unknown_status' })).rejects.toThrow()
    })

    it('clients:listはfilter省略(undefined)の場合は正常に一覧を返す', async () => {
      const handler = handlers.get(IPC_CHANNELS.clientsList)!
      await expect(handler({})).resolves.toEqual([])
    })
  })
})
