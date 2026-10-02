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

import { CompanyIpcHandler } from './company.ipc-handler'
import { Database } from '../db/db'
import { CompanyProfileRepository } from '../repositories/company-profile.repository'
import { CompanyService } from '../services/company.service'
import type { CompanyProfileInput } from '@shared/schemas/company-profile.schema'

const baseInput: CompanyProfileInput = {
  name: 'サンプル商店 山田太郎',
  address: '東京都千代田区千代田1-1-1',
  invoiceRegistrationNumber: '',
  bankName: '',
  bankBranch: '',
  accountType: '',
  accountNumber: '',
  accountHolder: ''
}

describe('CompanyIpcHandler', () => {
  let db: Database
  let service: CompanyService

  beforeEach(() => {
    handlers.clear()
    db = new Database(':memory:')
    db.initialize()
    service = new CompanyService(new CompanyProfileRepository(db))
    new CompanyIpcHandler(service).registerHandlers()
  })

  it('全チャンネルを登録する', () => {
    expect(handlers.has(IPC_CHANNELS.companyGet)).toBe(true)
    expect(handlers.has(IPC_CHANNELS.companySave)).toBe(true)
  })

  it('company:getは未設定の場合nullを返す', async () => {
    const handler = handlers.get(IPC_CHANNELS.companyGet)!
    const result = await handler({})
    expect(result).toBeNull()
  })

  it('company:saveはCompanyServiceへ委譲し保存結果を返す', async () => {
    const saveHandler = handlers.get(IPC_CHANNELS.companySave)!
    const result = await saveHandler({}, baseInput)
    expect(result).toEqual({ success: true })

    const getHandler = handlers.get(IPC_CHANNELS.companyGet)!
    const found = (await getHandler({})) as { name: string }
    expect(found.name).toBe('サンプル商店 山田太郎')
  })
})
