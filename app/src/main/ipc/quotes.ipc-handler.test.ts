import { describe, expect, it, vi, beforeEach } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc/channels'

type Handler = (event: unknown, ...args: unknown[]) => unknown

const handlers = new Map<string, Handler>()
const { openPath, showItemInFolder } = vi.hoisted(() => ({
  openPath: vi.fn().mockResolvedValue(''),
  showItemInFolder: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Handler) => {
      handlers.set(channel, handler)
    })
  },
  shell: { openPath, showItemInFolder }
}))

import { QuotesIpcHandler } from './quotes.ipc-handler'
import { Database } from '../db/db'
import { ClientRepository } from '../repositories/client.repository'
import { CompanyProfileRepository } from '../repositories/company-profile.repository'
import { DocumentNumberSequenceRepository } from '../repositories/document-number-sequence.repository'
import { QuoteRepository } from '../repositories/quote.repository'
import { NumberingService } from '../services/numbering.service'
import { QuoteService } from '../services/quote.service'
import { InvoiceService } from '../services/invoice.service'
import { InvoiceRepository } from '../repositories/invoice.repository'
import type { ClientInput } from '@shared/schemas/client.schema'
import type { CompanyProfileInput } from '@shared/schemas/company-profile.schema'
import type { QuoteInput } from '@shared/schemas/quote.schema'

const baseClient: ClientInput = {
  name: '株式会社サンプル',
  furigana: '',
  honorific: '御中',
  contactPerson: '',
  postalCode: '',
  address: '',
  phone: '',
  email: '',
  invoiceRegistrationNumber: '',
  memo: ''
}

const baseCompanyProfile: CompanyProfileInput = {
  name: 'サンプル商店 山田太郎',
  address: '東京都千代田区千代田1-1-1',
  invoiceRegistrationNumber: 'T1234567890123',
  bankName: '',
  bankBranch: '',
  accountType: '',
  accountNumber: '',
  accountHolder: ''
}

const baseInput: Omit<QuoteInput, 'clientId'> = {
  issueDate: '2026-09-20',
  validUntil: '',
  remarks: '',
  lineItems: [
    { name: 'Webサイト制作一式', quantity: 1, unit: '式', unitPrice: 300000, taxRate: 10 }
  ]
}

describe('QuotesIpcHandler', () => {
  let db: Database
  let clientId: number

  beforeEach(() => {
    handlers.clear()
    vi.clearAllMocks()
    db = new Database(':memory:')
    db.initialize()

    const clientRepository = new ClientRepository(db)
    clientId = clientRepository.insert(baseClient).id
    const companyProfileRepository = new CompanyProfileRepository(db)
    companyProfileRepository.upsert(baseCompanyProfile)

    const quoteRepository = new QuoteRepository(db)
    const numberingService = new NumberingService(new DocumentNumberSequenceRepository(db))
    const pdfService = {
      generateQuotePdf: vi
        .fn()
        .mockResolvedValue({ pdfPath: '/tmp/2026-001_株式会社サンプル.pdf', pdfHash: 'hash123' })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any
    const service = new QuoteService({
      database: db,
      repository: quoteRepository,
      companyProfileRepository,
      numberingService,
      pdfService
    })

    const invoiceService = new InvoiceService({
      database: db,
      repository: new InvoiceRepository(db),
      quoteRepository,
      companyProfileRepository,
      numberingService,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pdfService: {} as any
    })

    new QuotesIpcHandler(service, invoiceService).registerHandlers()
  })

  it('全チャンネルを登録する', () => {
    expect(handlers.has(IPC_CHANNELS.quotesList)).toBe(true)
    expect(handlers.has(IPC_CHANNELS.quotesGet)).toBe(true)
    expect(handlers.has(IPC_CHANNELS.quotesSaveDraft)).toBe(true)
    expect(handlers.has(IPC_CHANNELS.quotesFinalize)).toBe(true)
    expect(handlers.has(IPC_CHANNELS.quotesOpenPdf)).toBe(true)
    expect(handlers.has(IPC_CHANNELS.quotesShowPdfInFolder)).toBe(true)
    expect(handlers.has(IPC_CHANNELS.quotesConvertToInvoice)).toBe(true)
  })

  it('quotes:convertToInvoiceはPDF保存済み見積書から請求書(下書き)を作成しinvoiceIdを返す', async () => {
    const finalized = (await handlers.get(IPC_CHANNELS.quotesFinalize)!(
      {},
      { ...baseInput, clientId }
    )) as { id: number }
    const result = (await handlers.get(IPC_CHANNELS.quotesConvertToInvoice)!({}, finalized.id)) as {
      invoiceId: number
    }
    expect(result.invoiceId).toEqual(expect.any(Number))
  })

  it('quotes:convertToInvoiceは不正なid・下書きの見積書・存在しない見積書を拒否する', async () => {
    const convert = handlers.get(IPC_CHANNELS.quotesConvertToInvoice)!
    await expect(convert({}, 'abc')).rejects.toThrow()
    await expect(convert({}, 9999)).rejects.toThrow('対象の見積書が見つかりません')
    const draft = (await handlers.get(IPC_CHANNELS.quotesSaveDraft)!(
      {},
      { ...baseInput, clientId }
    )) as { id: number }
    await expect(convert({}, draft.id)).rejects.toThrow('PDF保存済み')
  })

  it('quotes:saveDraftはQuoteServiceへ委譲し登録結果を返す', async () => {
    const handler = handlers.get(IPC_CHANNELS.quotesSaveDraft)!
    const result = (await handler({}, { ...baseInput, clientId })) as { id: number }
    expect(result.id).toEqual(expect.any(Number))
  })

  it('quotes:listはQuoteServiceへ委譲し一覧を返す', async () => {
    const saveHandler = handlers.get(IPC_CHANNELS.quotesSaveDraft)!
    await saveHandler({}, { ...baseInput, clientId })

    const listHandler = handlers.get(IPC_CHANNELS.quotesList)!
    const result = await listHandler({}, {})
    expect(result).toHaveLength(1)
  })

  it('quotes:getはQuoteServiceへ委譲し詳細を返す', async () => {
    const saveHandler = handlers.get(IPC_CHANNELS.quotesSaveDraft)!
    const created = (await saveHandler({}, { ...baseInput, clientId })) as { id: number }

    const getHandler = handlers.get(IPC_CHANNELS.quotesGet)!
    const result = (await getHandler({}, created.id)) as { clientId: number }
    expect(result.clientId).toBe(clientId)
  })

  it('quotes:finalizeはQuoteServiceへ委譲し確定結果を返す', async () => {
    const handler = handlers.get(IPC_CHANNELS.quotesFinalize)!
    const result = (await handler({}, { ...baseInput, clientId })) as { quoteNumber: string }
    expect(result.quoteNumber).toBe('2026-001')
  })

  it('quotes:openPdfはpdf_pathをshell.openPathへ渡す', async () => {
    const finalizeHandler = handlers.get(IPC_CHANNELS.quotesFinalize)!
    const created = (await finalizeHandler({}, { ...baseInput, clientId })) as { id: number }

    const handler = handlers.get(IPC_CHANNELS.quotesOpenPdf)!
    const result = await handler({}, created.id)
    expect(result).toEqual({ success: true })
    expect(openPath).toHaveBeenCalledWith('/tmp/2026-001_株式会社サンプル.pdf')
  })

  it('quotes:showPdfInFolderはpdf_pathをshell.showItemInFolderへ渡す', async () => {
    const finalizeHandler = handlers.get(IPC_CHANNELS.quotesFinalize)!
    const created = (await finalizeHandler({}, { ...baseInput, clientId })) as { id: number }

    const handler = handlers.get(IPC_CHANNELS.quotesShowPdfInFolder)!
    const result = await handler({}, created.id)
    expect(result).toEqual({ success: true })
    expect(showItemInFolder).toHaveBeenCalledWith('/tmp/2026-001_株式会社サンプル.pdf')
  })

  describe('IPC境界での実行時バリデーション', () => {
    it('quotes:getは不正なid(文字列)の場合はエラーになる', async () => {
      const handler = handlers.get(IPC_CHANNELS.quotesGet)!
      await expect(handler({}, 'abc')).rejects.toThrow()
    })

    it('quotes:saveDraftは不正なid(0以下)の場合はエラーになる', async () => {
      const handler = handlers.get(IPC_CHANNELS.quotesSaveDraft)!
      await expect(handler({}, { id: 0, ...baseInput, clientId })).rejects.toThrow()
    })

    it('quotes:listは不正なstatus値の場合はエラーになる', async () => {
      const handler = handlers.get(IPC_CHANNELS.quotesList)!
      await expect(handler({}, { status: 'unknown' })).rejects.toThrow()
    })

    it('quotes:listはfilter省略(undefined)の場合は正常に一覧を返す', async () => {
      const handler = handlers.get(IPC_CHANNELS.quotesList)!
      await expect(handler({})).resolves.toEqual([])
    })
  })
})
