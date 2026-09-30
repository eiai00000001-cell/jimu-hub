import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { Database } from '../db/db'
import { ClientRepository } from '../repositories/client.repository'
import { CompanyProfileRepository } from '../repositories/company-profile.repository'
import { DocumentNumberSequenceRepository } from '../repositories/document-number-sequence.repository'
import { InvoiceRepository } from '../repositories/invoice.repository'
import { NumberingService } from './numbering.service'
import { InvoiceService, InvoiceNotFoundError, InvoiceFinalizedError } from './invoice.service'
import { CompanyProfileNotSetError, PdfSaveError } from './quote.service'
import type { InvoiceInput } from '@shared/schemas/invoice.schema'

const company = {
  name: 'サンプル商店 山田太郎',
  address: '東京都千代田区千代田1-1-1',
  invoiceRegistrationNumber: 'T1234567890123',
  bankName: '',
  bankBranch: '',
  accountType: '' as const,
  accountNumber: '',
  accountHolder: ''
}

const baseInput: InvoiceInput = {
  clientId: 1,
  issueDate: '2026-09-22',
  dueDate: '',
  remarks: '',
  lineItems: [
    {
      name: 'Webサイト制作一式',
      quantity: 1,
      unit: '式',
      unitPrice: 300000,
      taxRate: 10,
      withholdingTarget: true
    }
  ]
}

describe('InvoiceService', () => {
  let db: Database
  let companyRepo: CompanyProfileRepository
  let clientId: number

  beforeEach(() => {
    db = new Database(':memory:')
    db.initialize()
    companyRepo = new CompanyProfileRepository(db)
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
  })

  afterEach(() => db.close())

  function create(generate = vi.fn().mockResolvedValue({ pdfPath: '/tmp/i.pdf', pdfHash: 'h' })) {
    const service = new InvoiceService({
      database: db,
      repository: new InvoiceRepository(db),
      companyProfileRepository: companyRepo,
      numberingService: new NumberingService(new DocumentNumberSequenceRepository(db)),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pdfService: { generateInvoicePdf: generate } as any
    })
    return { service, generate }
  }

  it('下書き保存でき、必須項目未入力はエラー', () => {
    const { service } = create()
    const { id } = service.saveDraft({ ...baseInput, clientId })
    expect(service.getInvoice(id).status).toBe('draft')
    expect(() => service.saveDraft({ ...baseInput, clientId: 0 })).toThrow(
      '取引先を選択してください'
    )
  })

  it('存在しないid・PDF保存済みの更新はエラー', async () => {
    companyRepo.upsert(company)
    const { service } = create()
    expect(() => service.getInvoice(999)).toThrow(InvoiceNotFoundError)
    expect(() => service.saveDraft({ ...baseInput, clientId }, 999)).toThrow(InvoiceNotFoundError)
    const { id } = await service.finalizeInvoice({ ...baseInput, clientId })
    expect(() => service.saveDraft({ ...baseInput, clientId }, id)).toThrow(InvoiceFinalizedError)
  })

  it('自社情報未設定の場合は確定できない', async () => {
    const { service } = create()
    await expect(service.finalizeInvoice({ ...baseInput, clientId })).rejects.toThrow(
      CompanyProfileNotSetError
    )
  })

  it('採番・PDF生成・状態更新を行い、請求書番号は見積書と別系列', async () => {
    companyRepo.upsert(company)
    const { service, generate } = create()
    const result = await service.finalizeInvoice({ ...baseInput, clientId })
    expect(result).toMatchObject({ invoiceNumber: '2026-001', pdfPath: '/tmp/i.pdf' })
    expect(generate).toHaveBeenCalledTimes(1)
    const found = service.getInvoice(result.id)
    expect(found.status).toBe('finalized')
    expect(found.invoiceFormat).toBe('qualified')
    expect(found.withholdingTaxAmount).toBe(30630)
    expect(found.pdfHash).toBe('h')
  })

  it('登録番号未設定ならclassified', async () => {
    companyRepo.upsert({ ...company, invoiceRegistrationNumber: '' })
    const { service } = create()
    const r = await service.finalizeInvoice({ ...baseInput, clientId })
    expect(service.getInvoice(r.id).invoiceFormat).toBe('classified')
  })

  it('PDF生成失敗時は下書きへ戻しPdfSaveErrorを投げる', async () => {
    companyRepo.upsert(company)
    const { service } = create(vi.fn().mockRejectedValue(new Error('x')))
    await expect(service.finalizeInvoice({ ...baseInput, clientId })).rejects.toThrow(PdfSaveError)
    const list = service.listInvoices()
    expect(list[0]?.status).toBe('draft')
    expect(list[0]?.invoiceNumber).toBeNull()
  })
})
