import { describe, expect, it } from 'vitest'
import { buildQuotePdfHtml } from './quote-pdf-template'
import type { Quote } from '@shared/types/quote'
import type { CompanyProfile } from '@shared/types/company-profile'

const sampleQuote: Quote = {
  id: 1,
  quoteNumber: '2026-008',
  clientId: 1,
  clientName: 'サンプル商事株式会社',
  clientHonorific: '御中',
  issueDate: '2026-09-20',
  validUntil: '2026-10-20',
  remarks: '初回打ち合わせ内容に基づく概算見積です。',
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
    },
    {
      id: 2,
      lineNo: 2,
      name: 'サーバー保守(月額)',
      quantity: 1,
      unit: '式',
      unitPrice: 30000,
      taxRate: 10,
      amount: 30000
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

describe('buildQuotePdfHtml', () => {
  it('見積書番号・取引先・金額・明細行を含むHTMLを生成する', () => {
    const html = buildQuotePdfHtml(sampleQuote, sampleCompanyProfile)

    expect(html).toContain('御 見 積 書')
    expect(html).toContain('2026-008')
    expect(html).toContain('サンプル商事株式会社')
    expect(html).toContain('御中')
    expect(html).toContain('¥363,000')
    expect(html).toContain('Webサイト制作一式')
    expect(html).toContain('サンプル商店 山田太郎')
    expect(html).toContain('登録番号: T1234567890123')
    expect(html).toContain('初回打ち合わせ内容に基づく概算見積です。')
  })

  it('敬称が(なし)の場合は敬称を付与しない', () => {
    const html = buildQuotePdfHtml(
      { ...sampleQuote, clientHonorific: '(なし)' },
      sampleCompanyProfile
    )
    expect(html).toContain('サンプル商事株式会社</div>')
  })

  it('自社のインボイス登録番号が未設定の場合は登録番号欄を表示しない(区分記載請求書等)', () => {
    const html = buildQuotePdfHtml(sampleQuote, {
      ...sampleCompanyProfile,
      invoiceRegistrationNumber: null
    })
    expect(html).not.toContain('登録番号:')
  })

  it('有効期限が未設定の場合は有効期限行を表示しない', () => {
    const html = buildQuotePdfHtml({ ...sampleQuote, validUntil: null }, sampleCompanyProfile)
    expect(html).not.toContain('有効期限:')
  })

  it('備考が未設定の場合は備考ブロックを表示しない', () => {
    const html = buildQuotePdfHtml({ ...sampleQuote, remarks: null }, sampleCompanyProfile)
    expect(html).not.toContain('class="remarks-block"')
  })

  it('8%対象の明細が無い場合、8%対象の小計・消費税額の行を表示しない', () => {
    const html = buildQuotePdfHtml(sampleQuote, sampleCompanyProfile)
    expect(html).toContain('10%対象 小計')
    expect(html).not.toContain('8%対象 小計')
    expect(html).not.toContain('8%対象 消費税額')
  })

  it('10%・8%両方の明細がある場合、両方の内訳行を表示する', () => {
    const html = buildQuotePdfHtml(
      {
        ...sampleQuote,
        subtotal8: 2000,
        taxAmount8: 160,
        lineItems: [
          ...sampleQuote.lineItems,
          {
            id: 3,
            lineNo: 3,
            name: '軽減税率対象品',
            quantity: 1,
            unit: '個',
            unitPrice: 2000,
            taxRate: 8,
            amount: 2000
          }
        ]
      },
      sampleCompanyProfile
    )
    expect(html).toContain('10%対象 小計')
    expect(html).toContain('8%対象 小計')
    expect(html).toContain('8%対象 消費税額')
  })

  it('取引先名称・品名に含まれるHTML特殊文字をエスケープする(タグ注入対策)', () => {
    const html = buildQuotePdfHtml(
      {
        ...sampleQuote,
        clientName: '<script>alert(1)</script>',
        lineItems: [{ ...sampleQuote.lineItems[0]!, name: '<b>不正な品名</b>' }]
      },
      sampleCompanyProfile
    )
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<b>不正な品名</b>')
  })
})
