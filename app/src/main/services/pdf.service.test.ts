import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const FAKE_PDF_CONTENT = Buffer.from('%PDF-1.7 fake pdf content for testing')

const loadFile = vi.fn().mockResolvedValue(undefined)
const printToPDF = vi.fn().mockResolvedValue(FAKE_PDF_CONTENT)
const destroy = vi.fn()

vi.mock('electron', () => ({
  BrowserWindow: vi.fn().mockImplementation(function FakeBrowserWindow() {
    return {
      loadFile,
      webContents: { printToPDF },
      destroy
    }
  })
}))

import { PdfService } from './pdf.service'
import type { Quote } from '@shared/types/quote'
import type { Invoice } from '@shared/types/invoice'
import type { CompanyProfile } from '@shared/types/company-profile'

const sampleQuote: Quote = {
  id: 1,
  quoteNumber: '2026-008',
  clientId: 1,
  clientName: 'サンプル商事株式会社',
  clientHonorific: '御中',
  issueDate: '2026-09-20',
  validUntil: '2026-10-20',
  remarks: null,
  subtotal10: 330000,
  taxAmount10: 33000,
  subtotal8: 0,
  taxAmount8: 0,
  totalAmount: 363000,
  invoiceFormat: 'qualified',
  status: 'finalized',
  pdfPath: null,
  pdfHash: null,
  pdfHashMismatch: false,
  lineItems: [
    {
      id: 1,
      lineNo: 1,
      name: 'Webサイト制作一式',
      quantity: 1,
      unit: '式',
      unitPrice: 300000,
      taxRate: 10,
      amount: 300000
    }
  ],
  createdAt: '2026-09-20T00:00:00.000Z',
  updatedAt: '2026-09-20T00:00:00.000Z'
}

const sampleCompanyProfile: CompanyProfile = {
  name: 'サンプル商店 山田太郎',
  address: '東京都千代田区千代田1-1-1',
  invoiceRegistrationNumber: 'T1234567890123',
  bankName: null,
  bankBranch: null,
  accountType: null,
  accountNumber: null,
  accountHolder: null,
  updatedAt: '2026-01-01T00:00:00.000Z'
}

describe('PdfService', () => {
  let documentsDir: string
  let service: PdfService

  beforeEach(() => {
    vi.clearAllMocks()
    printToPDF.mockResolvedValue(FAKE_PDF_CONTENT)
    documentsDir = mkdtempSync(join(tmpdir(), 'jimuhub-pdf-service-test-'))
    service = new PdfService({ documentsDir })
  })

  afterEach(() => {
    rmSync(documentsDir, { recursive: true, force: true })
  })

  it('見積書PDFを documents/quotes/<年>/<番号>_<取引先名>.pdf へ保存する', async () => {
    const result = await service.generateQuotePdf(sampleQuote, sampleCompanyProfile)

    const expectedPath = join(documentsDir, 'quotes', '2026', '2026-008_サンプル商事株式会社.pdf')
    expect(result.pdfPath).toBe(expectedPath)
    expect(existsSync(expectedPath)).toBe(true)
    expect(readFileSync(expectedPath)).toEqual(FAKE_PDF_CONTENT)
  })

  it('書き込んだPDFファイルのSHA-256ハッシュ値を返す', async () => {
    const result = await service.generateQuotePdf(sampleQuote, sampleCompanyProfile)
    const expectedHash = createHash('sha256').update(FAKE_PDF_CONTENT).digest('hex')
    expect(result.pdfHash).toBe(expectedHash)
  })

  it('非表示のBrowserWindowでHTMLを読み込みprintToPDFを呼び出す', async () => {
    await service.generateQuotePdf(sampleQuote, sampleCompanyProfile)

    expect(loadFile).toHaveBeenCalledTimes(1)
    expect(printToPDF).toHaveBeenCalledTimes(1)
    expect(printToPDF.mock.calls[0]?.[0]).toMatchObject({ pageSize: 'A4', printBackground: true })
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('フッターに本文と同じゴシック体フォントを指定する(既定のセリフ体を上書き。ユーザー指摘によりT-20で修正)', async () => {
    await service.generateQuotePdf(sampleQuote, sampleCompanyProfile)

    const options = printToPDF.mock.calls[0]?.[0]
    expect(options.footerTemplate).toContain('Hiragino Sans')
    expect(options.footerTemplate).toContain('font-family')
  })

  it('取引先名にスラッシュを含む場合、ファイル名では置換される', async () => {
    const result = await service.generateQuotePdf(
      { ...sampleQuote, clientName: 'サンプル/商事' },
      sampleCompanyProfile
    )
    expect(result.pdfPath).toBe(join(documentsDir, 'quotes', '2026', '2026-008_サンプル_商事.pdf'))
  })

  it('printToPDFが失敗した場合、生成したBrowserWindowを必ずdestroyする', async () => {
    printToPDF.mockRejectedValueOnce(new Error('印刷に失敗しました'))

    await expect(service.generateQuotePdf(sampleQuote, sampleCompanyProfile)).rejects.toThrow(
      '印刷に失敗しました'
    )
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('請求書PDFを documents/invoices/<年>/<番号>_<取引先名>.pdf へ保存する', async () => {
    const invoice: Invoice = {
      id: 1,
      invoiceNumber: '2026-012',
      clientId: 1,
      clientName: 'サンプル商事株式会社',
      clientHonorific: '御中',
      sourceQuoteId: null,
      sourceQuoteNumber: null,
      issueDate: '2026-09-22',
      dueDate: null,
      remarks: null,
      subtotal10: 0,
      taxAmount10: 0,
      subtotal8: 0,
      taxAmount8: 0,
      totalAmount: 0,
      withholdingTaxAmount: 0,
      billingAmount: 0,
      invoiceFormat: 'qualified',
      status: 'finalized',
      paymentStatus: 'unpaid',
      paymentDate: null,
      pdfPath: null,
      pdfHash: null,
      pdfHashMismatch: false,
      lineItems: [],
      createdAt: '',
      updatedAt: ''
    }
    const result = await service.generateInvoicePdf(invoice, sampleCompanyProfile)
    expect(result.pdfPath).toBe(
      join(documentsDir, 'invoices', '2026', '2026-012_サンプル商事株式会社.pdf')
    )
    expect(existsSync(result.pdfPath)).toBe(true)
  })
})
