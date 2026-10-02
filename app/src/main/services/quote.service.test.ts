import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { Database } from '../db/db'
import { ClientRepository } from '../repositories/client.repository'
import { CompanyProfileRepository } from '../repositories/company-profile.repository'
import { DocumentNumberSequenceRepository } from '../repositories/document-number-sequence.repository'
import { QuoteRepository } from '../repositories/quote.repository'
import { NumberingService } from './numbering.service'
import {
  QuoteService,
  QuoteNotFoundError,
  QuoteFinalizedError,
  CompanyProfileNotSetError,
  PdfSaveError
} from './quote.service'
import type { QuoteInput } from '@shared/schemas/quote.schema'
import type { ClientInput } from '@shared/schemas/client.schema'
import type { CompanyProfileInput } from '@shared/schemas/company-profile.schema'

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

const baseInput: QuoteInput = {
  clientId: 1,
  issueDate: '2026-09-20',
  validUntil: '',
  remarks: '',
  lineItems: [
    { name: 'Webサイト制作一式', quantity: 1, unit: '式', unitPrice: 300000, taxRate: 10 }
  ]
}

function createPdfServiceStub(): { generateQuotePdf: ReturnType<typeof vi.fn> } {
  return {
    generateQuotePdf: vi
      .fn()
      .mockResolvedValue({ pdfPath: '/tmp/2026-001_株式会社サンプル.pdf', pdfHash: 'hash123' })
  }
}

describe('QuoteService', () => {
  let db: Database
  let clientRepository: ClientRepository
  let companyProfileRepository: CompanyProfileRepository
  let quoteRepository: QuoteRepository
  let numberingService: NumberingService
  let clientId: number

  beforeEach(() => {
    db = new Database(':memory:')
    db.initialize()
    clientRepository = new ClientRepository(db)
    companyProfileRepository = new CompanyProfileRepository(db)
    quoteRepository = new QuoteRepository(db)
    numberingService = new NumberingService(new DocumentNumberSequenceRepository(db))
    clientId = clientRepository.insert(baseClient).id
  })

  afterEach(() => {
    db.close()
  })

  function createService(pdfService = createPdfServiceStub()): {
    service: QuoteService
    pdfService: ReturnType<typeof createPdfServiceStub>
  } {
    const service = new QuoteService({
      database: db,
      repository: quoteRepository,
      companyProfileRepository,
      numberingService,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pdfService: pdfService as any
    })
    return { service, pdfService }
  }

  describe('saveDraft', () => {
    it('新規に下書き保存できる', () => {
      const { service } = createService()
      const result = service.saveDraft({ ...baseInput, clientId })
      const found = service.getQuote(result.id)
      expect(found.status).toBe('draft')
      expect(found.quoteNumber).toBeNull()
    })

    it('必須項目(取引先)が未選択の場合はエラーを投げる', () => {
      const { service } = createService()
      expect(() => service.saveDraft({ ...baseInput, clientId: 0 })).toThrow(
        '取引先を選択してください'
      )
    })

    it('既存の下書きを更新できる(idを維持する)', () => {
      const { service } = createService()
      const { id } = service.saveDraft({ ...baseInput, clientId })
      service.saveDraft({ ...baseInput, clientId, remarks: '更新後の備考' }, id)

      const found = service.getQuote(id)
      expect(found.id).toBe(id)
      expect(found.remarks).toBe('更新後の備考')
    })

    it('PDF保存済みの見積書を更新しようとするとQuoteFinalizedErrorを投げる', async () => {
      const { service } = createService()
      companyProfileRepository.upsert(baseCompanyProfile)
      const { id } = await service.finalizeQuote({ ...baseInput, clientId })

      expect(() => service.saveDraft({ ...baseInput, clientId }, id)).toThrow(QuoteFinalizedError)
    })

    it('存在しないidの場合はQuoteNotFoundErrorを投げる', () => {
      const { service } = createService()
      expect(() => service.saveDraft({ ...baseInput, clientId }, 9999)).toThrow(QuoteNotFoundError)
    })
  })

  describe('getQuote', () => {
    it('存在しないIDの場合QuoteNotFoundErrorを投げる', () => {
      const { service } = createService()
      expect(() => service.getQuote(9999)).toThrow(QuoteNotFoundError)
    })
  })

  describe('finalizeQuote', () => {
    it('自社情報が未設定の場合はCompanyProfileNotSetErrorを投げる', async () => {
      const { service } = createService()
      await expect(service.finalizeQuote({ ...baseInput, clientId })).rejects.toThrow(
        CompanyProfileNotSetError
      )
    })

    it('採番・PDF生成・状態更新を行い、確定結果を返す', async () => {
      companyProfileRepository.upsert(baseCompanyProfile)
      const { service, pdfService } = createService()

      const result = await service.finalizeQuote({ ...baseInput, clientId })

      expect(result.quoteNumber).toBe('2026-001')
      expect(result.pdfPath).toBe('/tmp/2026-001_株式会社サンプル.pdf')
      expect(pdfService.generateQuotePdf).toHaveBeenCalledTimes(1)

      const found = service.getQuote(result.id)
      expect(found.status).toBe('finalized')
      expect(found.quoteNumber).toBe('2026-001')
      expect(found.invoiceFormat).toBe('qualified')
      expect(found.pdfPath).toBe('/tmp/2026-001_株式会社サンプル.pdf')
      expect(found.pdfHash).toBe('hash123')
    })

    it('自社のインボイス登録番号が未設定の場合はinvoiceFormatをclassifiedにする', async () => {
      companyProfileRepository.upsert({ ...baseCompanyProfile, invoiceRegistrationNumber: '' })
      const { service } = createService()

      const result = await service.finalizeQuote({ ...baseInput, clientId })
      expect(service.getQuote(result.id).invoiceFormat).toBe('classified')
    })

    it('下書き保存済みの見積書をidを指定して確定できる', async () => {
      companyProfileRepository.upsert(baseCompanyProfile)
      const { service } = createService()
      const draft = service.saveDraft({ ...baseInput, clientId })

      const result = await service.finalizeQuote({ ...baseInput, clientId }, draft.id)
      expect(result.id).toBe(draft.id)
      expect(result.quoteNumber).toBe('2026-001')
    })

    it('PDF生成に失敗した場合、採番・状態変更を下書きへ戻し、PdfSaveErrorを投げる', async () => {
      companyProfileRepository.upsert(baseCompanyProfile)
      const pdfService = {
        generateQuotePdf: vi.fn().mockRejectedValue(new Error('書き込みに失敗しました'))
      }
      const { service } = createService(pdfService)

      await expect(service.finalizeQuote({ ...baseInput, clientId })).rejects.toThrow(PdfSaveError)

      const list = service.listQuotes()
      expect(list).toHaveLength(1)
      expect(list[0]?.status).toBe('draft')
      expect(list[0]?.quoteNumber).toBeNull()
    })

    it('発行日の西暦年を基準に採番する', async () => {
      companyProfileRepository.upsert(baseCompanyProfile)
      const { service } = createService()

      const result = await service.finalizeQuote({
        ...baseInput,
        clientId,
        issueDate: '2027-01-05'
      })
      expect(result.quoteNumber).toBe('2027-001')
    })
  })

  describe('listQuotes', () => {
    it('一覧を取得できる', () => {
      const { service } = createService()
      service.saveDraft({ ...baseInput, clientId })
      expect(service.listQuotes()).toHaveLength(1)
    })
  })
})
