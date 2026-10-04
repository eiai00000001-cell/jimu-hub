import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
import { QuoteRepository } from '../repositories/quote.repository'
import { NumberingService } from '../services/numbering.service'
import { InvoiceService } from '../services/invoice.service'
import type { InvoicePaymentRecorder } from '../services/cash-record.service'

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

const noopPaymentRecorder: InvoicePaymentRecorder = {
  createFromInvoicePayment: () => ({ id: 0 }),
  cancelByInvoice: () => ({ cancelledCount: 0 }),
  findLinkedByInvoice: () => [],
  hasRecordsForInvoice: () => false
}

describe('InvoicesIpcHandler', () => {
  let clientId: number
  let documentsDir: string
  let pdfFile: string
  let pdfPathForService: string

  beforeEach(() => {
    handlers.clear()
    vi.clearAllMocks()
    openPath.mockResolvedValue('')
    documentsDir = join(mkdtempSync(join(tmpdir(), 'jimuhub-inv-ipc-')), 'documents')
    mkdirSync(documentsDir, { recursive: true })
    pdfFile = join(documentsDir, 'i.pdf')
    writeFileSync(pdfFile, '%PDF')
    pdfPathForService = pdfFile
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
      quoteRepository: new QuoteRepository(db),
      companyProfileRepository,
      numberingService: new NumberingService(new DocumentNumberSequenceRepository(db)),
      pdfService: {
        generateInvoicePdf: vi
          .fn()
          .mockImplementation(async () => ({ pdfPath: pdfPathForService, pdfHash: 'h' }))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      paymentRecorder: noopPaymentRecorder
    })
    new InvoicesIpcHandler(service, documentsDir).registerHandlers()
  })

  it('全チャンネルを登録する', () => {
    for (const ch of [
      IPC_CHANNELS.invoicesList,
      IPC_CHANNELS.invoicesGet,
      IPC_CHANNELS.invoicesSaveDraft,
      IPC_CHANNELS.invoicesFinalize,
      IPC_CHANNELS.invoicesOpenPdf,
      IPC_CHANNELS.invoicesShowPdfInFolder,
      IPC_CHANNELS.invoicesUpdatePaymentStatus
    ]) {
      expect(handlers.has(ch)).toBe(true)
    }
  })

  it('[F-26]invoices:deleteDraftは下書きを削除し、不正なidはエラーになる', async () => {
    const created = (await handlers.get(IPC_CHANNELS.invoicesSaveDraft)!(
      {},
      { ...input, clientId }
    )) as { id: number }
    const handler = handlers.get(IPC_CHANNELS.invoicesDeleteDraft)!
    await expect(handler({}, 0)).rejects.toThrow()
    expect(await handler({}, created.id)).toEqual({ success: true })
    await expect(handlers.get(IPC_CHANNELS.invoicesGet)!({}, created.id)).rejects.toThrow()
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
    expect(await handlers.get(IPC_CHANNELS.invoicesOpenPdf)!({}, r.id)).toEqual({ success: true })
    expect(openPath).toHaveBeenCalledWith(pdfFile)
    expect(await handlers.get(IPC_CHANNELS.invoicesShowPdfInFolder)!({}, r.id)).toEqual({
      success: true
    })
    expect(showItemInFolder).toHaveBeenCalledWith(pdfFile)
  })

  it('PDFファイルが存在しない場合は、案内文言を返しOSへは渡さない(I1-05)', async () => {
    const r = (await handlers.get(IPC_CHANNELS.invoicesFinalize)!({}, { ...input, clientId })) as {
      id: number
    }
    rmSync(pdfFile)
    const open = (await handlers.get(IPC_CHANNELS.invoicesOpenPdf)!({}, r.id)) as {
      success: boolean
      error?: string
    }
    expect(open.success).toBe(false)
    expect(open.error).toContain('PDFファイルが見つかりません')
    const show = (await handlers.get(IPC_CHANNELS.invoicesShowPdfInFolder)!({}, r.id)) as {
      success: boolean
    }
    expect(show.success).toBe(false)
    expect(openPath).not.toHaveBeenCalled()
    expect(showItemInFolder).not.toHaveBeenCalled()
  })

  it('shell.openPathが失敗(エラー文字列)を返した場合は失敗として返す(I1-05)', async () => {
    const r = (await handlers.get(IPC_CHANNELS.invoicesFinalize)!({}, { ...input, clientId })) as {
      id: number
    }
    openPath.mockResolvedValueOnce('failed to open')
    const result = (await handlers.get(IPC_CHANNELS.invoicesOpenPdf)!({}, r.id)) as {
      success: boolean
    }
    expect(result.success).toBe(false)
  })

  it('pdf_pathが保存先(documents)の外を指す場合は開かない(I1-03)', async () => {
    pdfPathForService = '/Applications/Calculator.app'
    const r = (await handlers.get(IPC_CHANNELS.invoicesFinalize)!({}, { ...input, clientId })) as {
      id: number
    }
    const open = (await handlers.get(IPC_CHANNELS.invoicesOpenPdf)!({}, r.id)) as {
      success: boolean
    }
    const show = (await handlers.get(IPC_CHANNELS.invoicesShowPdfInFolder)!({}, r.id)) as {
      success: boolean
    }
    expect(open.success).toBe(false)
    expect(show.success).toBe(false)
    expect(openPath).not.toHaveBeenCalled()
    expect(showItemInFolder).not.toHaveBeenCalled()
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

  it('updatePaymentStatusは入金済み・未収へ更新でき、不正なidは拒否する', async () => {
    const r = (await handlers.get(IPC_CHANNELS.invoicesFinalize)!({}, { ...input, clientId })) as {
      id: number
    }
    const update = handlers.get(IPC_CHANNELS.invoicesUpdatePaymentStatus)!
    expect(await update({}, r.id, { paymentStatus: 'paid', paymentDate: '2026-09-30' })).toEqual({
      success: true
    })
    const got = (await handlers.get(IPC_CHANNELS.invoicesGet)!({}, r.id)) as {
      paymentStatus: string
    }
    expect(got.paymentStatus).toBe('paid')
    await expect(update({}, 'abc', { paymentStatus: 'unpaid' })).rejects.toThrow()
    await expect(update({}, r.id, { paymentStatus: 'paid' })).rejects.toThrow('入金日')
  })
})
