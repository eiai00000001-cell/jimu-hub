import { describe, expect, it } from 'vitest'
import { buildInvoicePdfHtml } from './invoice-pdf-template'
import type { Invoice } from '@shared/types/invoice'
import type { CompanyProfile } from '@shared/types/company-profile'

const sampleInvoice: Invoice = {
  id: 1,
  invoiceNumber: '2026-012',
  clientId: 1,
  clientName: 'サンプル商事株式会社',
  clientHonorific: '御中',
  sourceQuoteId: null,
  issueDate: '2026-09-22',
  dueDate: '2026-10-31',
  remarks: 'お振込手数料は貴社にてご負担いただけますと幸いです。',
  subtotal10: 330000,
  taxAmount10: 33000,
  subtotal8: 0,
  taxAmount8: 0,
  totalAmount: 363000,
  withholdingTaxAmount: 30630,
  billingAmount: 332370,
  invoiceFormat: 'qualified',
  status: 'finalized',
  paymentStatus: 'unpaid',
  paymentDate: null,
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
      amount: 300000,
      withholdingTarget: true
    },
    {
      id: 2,
      lineNo: 2,
      name: 'サーバー保守(月額)',
      quantity: 1,
      unit: '式',
      unitPrice: 30000,
      taxRate: 10,
      amount: 30000,
      withholdingTarget: false
    }
  ],
  createdAt: '2026-09-22T00:00:00.000Z',
  updatedAt: '2026-09-22T00:00:00.000Z'
}

const company: CompanyProfile = {
  name: 'サンプル商店 山田太郎',
  address: '東京都千代田区千代田1-1-1',
  invoiceRegistrationNumber: 'T1234567890123',
  bankName: 'サンプル銀行',
  bankBranch: '本店営業部',
  accountType: '普通',
  accountNumber: '1234567',
  accountHolder: 'ヤマダ タロウ',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

describe('buildInvoicePdfHtml', () => {
  it('請求書番号・宛先・請求金額・支払期限・振込先・備考を含む', () => {
    const html = buildInvoicePdfHtml(sampleInvoice, company)
    expect(html).toContain('御 請 求 書')
    expect(html).toContain('2026-012')
    expect(html).toContain('サンプル商事株式会社 御中')
    expect(html).toContain('¥332,370')
    expect(html).toContain('支払期限: 2026年10月31日')
    expect(html).toContain('お振込先')
    expect(html).toContain('サンプル銀行 本店営業部')
    expect(html).toContain('普通 1234567')
    expect(html).toContain('ヤマダ タロウ')
    expect(html).toContain('お振込手数料')
    expect(html).toContain('登録番号: T1234567890123')
  })

  it('源泉徴収対象行がある場合、内訳行に源泉徴収税額(合計)のみ表示する(行ごとの列は設けない)', () => {
    const html = buildInvoicePdfHtml(sampleInvoice, company)
    expect(html).not.toContain('源泉徴収税額</th>') // 行ごとの列は設けない
    expect(html).toContain('源泉徴収税額(合計)')
    expect(html).toContain('−¥30,630')
    expect(html).toContain('合計金額(税込)')
  })

  it('源泉徴収対象行がない場合、源泉徴収税額の列・内訳行を表示しない', () => {
    const html = buildInvoicePdfHtml(
      {
        ...sampleInvoice,
        withholdingTaxAmount: 0,
        billingAmount: 363000,
        lineItems: sampleInvoice.lineItems.map((l) => ({
          ...l,
          withholdingTarget: false
        }))
      },
      company
    )
    expect(html).not.toContain('源泉徴収税額')
  })

  it('明細が存在しない税率区分(8%)の内訳行を表示しない', () => {
    const html = buildInvoicePdfHtml(sampleInvoice, company)
    expect(html).toContain('10%対象 小計')
    expect(html).not.toContain('8%対象')
  })

  it('振込先が全て未設定の場合、お振込先ブロックを表示しない', () => {
    const html = buildInvoicePdfHtml(sampleInvoice, {
      ...company,
      bankName: null,
      bankBranch: null,
      accountType: null,
      accountNumber: null,
      accountHolder: null
    })
    expect(html).not.toContain('お振込先')
  })

  it('支払期限・備考が未設定の場合は表示しない', () => {
    const html = buildInvoicePdfHtml({ ...sampleInvoice, dueDate: null, remarks: null }, company)
    expect(html).not.toContain('支払期限:')
    expect(html).not.toContain('class="remarks-block"')
  })

  it('インボイス登録番号が未設定の場合は登録番号欄を表示しない', () => {
    const html = buildInvoicePdfHtml(sampleInvoice, { ...company, invoiceRegistrationNumber: null })
    expect(html).not.toContain('登録番号:')
  })

  it('HTML特殊文字をエスケープする', () => {
    const html = buildInvoicePdfHtml({ ...sampleInvoice, remarks: '<script>x</script>' }, company)
    expect(html).not.toContain('<script>x</script>')
  })
})
