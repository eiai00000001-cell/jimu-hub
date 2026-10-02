import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { Database } from '../db/db'
import { ClientRepository } from '../repositories/client.repository'
import { CompanyProfileRepository } from '../repositories/company-profile.repository'
import { DocumentNumberSequenceRepository } from '../repositories/document-number-sequence.repository'
import { InvoiceRepository } from '../repositories/invoice.repository'
import { QuoteRepository } from '../repositories/quote.repository'
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
      quoteRepository: new QuoteRepository(db),
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

  describe('convertFromQuote(F-13)', () => {
    async function finalizedQuote(overrides: Record<string, unknown> = {}): Promise<number> {
      companyRepo.upsert(company)
      const quoteRepo = new QuoteRepository(db)
      const { id } = quoteRepo.insert({
        clientId,
        issueDate: '2026-09-01',
        validUntil: '',
        remarks: '見積の備考',
        lineItems: [
          { name: '品目A', quantity: 2, unit: '個', unitPrice: 1000, taxRate: 10 },
          { name: '品目B', quantity: 1, unit: '', unitPrice: 500, taxRate: 8 }
        ],
        ...overrides
      })
      quoteRepo.finalize(id, { quoteNumber: '2026-008', invoiceFormat: 'qualified' })
      return id
    }

    it('取引先・備考・明細行を引き継いだ請求書(下書き)を作成し、変換元を保持する', async () => {
      const quoteId = await finalizedQuote()
      const { service } = create()
      const { invoiceId } = service.convertFromQuote(quoteId)

      const invoice = service.getInvoice(invoiceId)
      expect(invoice.status).toBe('draft')
      expect(invoice.clientId).toBe(clientId)
      expect(invoice.remarks).toBe('見積の備考')
      expect(invoice.dueDate).toBeNull()
      expect(invoice.sourceQuoteId).toBe(quoteId)
      expect(invoice.sourceQuoteNumber).toBe('2026-008')
      expect(invoice.invoiceNumber).toBeNull()
      expect(invoice.issueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(invoice.lineItems.map((l) => [l.name, l.quantity, l.unitPrice, l.taxRate])).toEqual([
        ['品目A', 2, 1000, 10],
        ['品目B', 1, 500, 8]
      ])
      expect(invoice.lineItems.every((l) => l.withholdingTarget === false)).toBe(true)
      expect(invoice.withholdingTaxAmount).toBe(0)
      expect(invoice.totalAmount).toBe(2000 + 200 + 500 + 40)
    })

    it('同一見積書から複数回変換すると、その都度新しい請求書を作成する', async () => {
      const quoteId = await finalizedQuote()
      const { service } = create()
      const a = service.convertFromQuote(quoteId).invoiceId
      const b = service.convertFromQuote(quoteId).invoiceId
      expect(a).not.toBe(b)
    })

    it('取引先が利用停止でも変換できる', async () => {
      const quoteId = await finalizedQuote()
      new ClientRepository(db).updateStatus(clientId, 'inactive')
      const { service } = create()
      expect(() => service.convertFromQuote(quoteId)).not.toThrow()
    })

    it('存在しない見積書・下書きの見積書は変換できない', async () => {
      const { service } = create()
      expect(() => service.convertFromQuote(9999)).toThrow('対象の見積書が見つかりません')
      const quoteRepo = new QuoteRepository(db)
      const { id } = quoteRepo.insert({
        clientId,
        issueDate: '2026-09-01',
        validUntil: '',
        remarks: '',
        lineItems: [{ name: 'x', quantity: 1, unit: '', unitPrice: 1, taxRate: 10 }]
      })
      expect(() => service.convertFromQuote(id)).toThrow('PDF保存済み')
    })
  })

  describe('updatePaymentStatus(F-15)', () => {
    async function finalized() {
      companyRepo.upsert(company)
      const { service } = create()
      const { id } = await service.finalizeInvoice({ ...baseInput, clientId })
      return { service, id }
    }

    it('未収→入金済み(入金日必須)→未収(入金日クリア)と変更できる', async () => {
      const { service, id } = await finalized()
      expect(service.getInvoice(id).paymentStatus).toBe('unpaid')

      service.updatePaymentStatus(id, { paymentStatus: 'paid', paymentDate: '2026-09-30' })
      expect(service.getInvoice(id)).toMatchObject({
        paymentStatus: 'paid',
        paymentDate: '2026-09-30'
      })
      expect(service.listInvoices({ paymentStatus: 'unpaid' })).toHaveLength(0)

      service.updatePaymentStatus(id, { paymentStatus: 'unpaid', paymentDate: null })
      expect(service.getInvoice(id)).toMatchObject({ paymentStatus: 'unpaid', paymentDate: null })
      expect(service.listInvoices({ paymentStatus: 'unpaid' })).toHaveLength(1)
    })

    it('入金済みにする際に入金日が未入力の場合はエラー', async () => {
      const { service, id } = await finalized()
      expect(() => service.updatePaymentStatus(id, { paymentStatus: 'paid' })).toThrow(
        '入金日を入力してください'
      )
      expect(() =>
        service.updatePaymentStatus(id, { paymentStatus: 'paid', paymentDate: ' ' })
      ).toThrow('入金日を入力してください')
      expect(service.getInvoice(id).paymentStatus).toBe('unpaid')
    })

    it('下書き・存在しない請求書の入金ステータスは変更できない', () => {
      const { service } = create()
      const { id } = service.saveDraft({ ...baseInput, clientId })
      expect(() =>
        service.updatePaymentStatus(id, { paymentStatus: 'paid', paymentDate: '2026-09-30' })
      ).toThrow('PDF保存済み')
      expect(() =>
        service.updatePaymentStatus(999, { paymentStatus: 'paid', paymentDate: '2026-09-30' })
      ).toThrow(InvoiceNotFoundError)
    })
  })
})
