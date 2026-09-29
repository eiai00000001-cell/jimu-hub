import { describe, expect, it } from 'vitest'
import { InvoiceInputSchema, InvoiceLineItemInputSchema } from './invoice.schema'

const validLineItem = {
  name: 'Webサイト制作一式',
  quantity: 1,
  unit: '式',
  unitPrice: 300000,
  taxRate: 10,
  withholdingTarget: true
}

const validInput = {
  clientId: 1,
  issueDate: '2026-09-28',
  dueDate: '2026-10-31',
  remarks: 'お振込手数料は貴社にてご負担いただけますと幸いです。',
  lineItems: [validLineItem]
}

describe('InvoiceLineItemInputSchema', () => {
  it('正しい入力を受け入れる', () => {
    expect(InvoiceLineItemInputSchema.safeParse(validLineItem).success).toBe(true)
  })

  it('withholdingTargetが未指定の場合はfalseを既定値にする', () => {
    const { withholdingTarget: _withholdingTarget, ...rest } = validLineItem
    const result = InvoiceLineItemInputSchema.safeParse(rest)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.withholdingTarget).toBe(false)
    }
  })

  it('見積書の明細行スキーマと同じ検証(品名必須等)を引き継ぐ', () => {
    const result = InvoiceLineItemInputSchema.safeParse({ ...validLineItem, name: '' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('品名を入力してください')
    }
  })
})

describe('InvoiceInputSchema', () => {
  it('正しい入力を受け入れる', () => {
    expect(InvoiceInputSchema.safeParse(validInput).success).toBe(true)
  })

  it('取引先が未選択(0)の場合はエラーになる', () => {
    expect(InvoiceInputSchema.safeParse({ ...validInput, clientId: 0 }).success).toBe(false)
  })

  it('発行日が空欄の場合はエラーになる', () => {
    expect(InvoiceInputSchema.safeParse({ ...validInput, issueDate: '' }).success).toBe(false)
  })

  it('支払期限が空欄でもエラーにならない(任意項目)', () => {
    expect(InvoiceInputSchema.safeParse({ ...validInput, dueDate: '' }).success).toBe(true)
  })

  it('明細行が0件の場合はエラーになる', () => {
    expect(InvoiceInputSchema.safeParse({ ...validInput, lineItems: [] }).success).toBe(false)
  })
})
