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

import { InvoicesIpcHandler } from './invoices.ipc-handler'
import { Database } from '../db/db'
import { ClientRepository } from '../repositories/client.repository'
import { CompanyProfileRepository } from '../repositories/company-profile.repository'
import { DocumentNumberSequenceRepository } from '../repositories/document-number-sequence.repository'
import { InvoiceRepository } from '../repositories/invoice.repository'
import { NumberingService } from '../services/numbering.service'
import { InvoiceService } from '../services/invoice.service'

const input = {
  issueDate: '2026-09-20',
  dueDate: '',
  remarks: '',
  lineItems: [
    {
      name: '品目',
      quantity: 1,
      unit: '式',
      unitPrice: 1000,
      taxRate: 10,
      withholdingTarget: false
    }
  ]
}

describe('InvoicesIpcHandler', () => {
  let clientId: number

  beforeEach(() => {
    handlers.clear()
    vi.clearAllMocks()
    const db = new Database(':memory:')
    db.initialize()
    clientId = new ClientRepository(db).insert({
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
    }).id
    const companyProfileRepository = new CompanyProfileRepository(db)
    companyProfileRepository.upsert({
      name: 'サンプル商店',
      address: '東京都',
      invoiceRegistrationNumber: '',
      bankName: '',
      bankBranch: '',
      accountType: '',
      accountNumber: '',
      accountHolder: ''
    })
    const service = new InvoiceService({
      database: db,
      repository: new InvoiceRepository(db),
      companyProfileRepository,
      numberingService: new NumberingService(new DocumentNumberSequenceRepository(db)),
      pdfService: {
        generateInvoicePdf: vi.fn().mockResolvedValue({ pdfPath: '/tmp/i.pdf', pdfHash: 'h' })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any
    })
    new InvoicesIpcHandler(service).registerHandlers()
  })

  it('全チャンネルを登録する', () => {
    for (const ch of [
      IPC_CHANNELS.invoicesList,
      IPC_CHANNELS.invoicesGet,
      IPC_CHANNELS.invoicesSaveDraft,
      IPC_CHANNELS.invoicesFinalize,
      IPC_CHANNELS.invoicesOpenPdf,
      IPC_CHANNELS.invoicesShowPdfInFolder
    ]) {
      expect(handlers.has(ch)).toBe(true)
    }
  })

  it('saveDraft→list→getが動作する', async () => {
    const created = (await handlers.get(IPC_CHANNELS.invoicesSaveDraft)!(
      {},
      { ...input, clientId }
    )) as {
      id: number
    }
    expect(await handlers.get(IPC_CHANNELS.invoicesList)!({}, {})).toHaveLength(1)
    const got = (await handlers.get(IPC_CHANNELS.invoicesGet)!({}, created.id)) as {
      clientId: number
    }
    expect(got.clientId).toBe(clientId)
  })

  it('finalize後、openPdf/showPdfInFolderがshellへpdf_pathを渡す', async () => {
    const r = (await handlers.get(IPC_CHANNELS.invoicesFinalize)!({}, { ...input, clientId })) as {
      id: number
      invoiceNumber: string
    }
    expect(r.invoiceNumber).toBe('2026-001')
    await handlers.get(IPC_CHANNELS.invoicesOpenPdf)!({}, r.id)
    expect(openPath).toHaveBeenCalledWith('/tmp/i.pdf')
    await handlers.get(IPC_CHANNELS.invoicesShowPdfInFolder)!({}, r.id)
    expect(showItemInFolder).toHaveBeenCalledWith('/tmp/i.pdf')
  })

  it('不正なid・filterはIPC境界で拒否する', async () => {
    await expect(handlers.get(IPC_CHANNELS.invoicesGet)!({}, 'abc')).rejects.toThrow()
    await expect(
      handlers.get(IPC_CHANNELS.invoicesSaveDraft)!({}, { id: 0, ...input, clientId })
    ).rejects.toThrow()
    await expect(
      handlers.get(IPC_CHANNELS.invoicesList)!({}, { paymentStatus: 'x' })
    ).rejects.toThrow()
    await expect(handlers.get(IPC_CHANNELS.invoicesList)!({})).resolves.toEqual([])
  })
})
