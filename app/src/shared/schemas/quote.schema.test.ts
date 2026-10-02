import { describe, expect, it } from 'vitest'
import { QuoteInputSchema, LineItemInputSchema } from './quote.schema'

const validLineItem = {
  name: 'Webサイト制作一式',
  quantity: 1,
  unit: '式',
  unitPrice: 300000,
  taxRate: 10
}

const validInput = {
  clientId: 1,
  issueDate: '2026-09-28',
  validUntil: '2026-10-28',
  remarks: '初回打ち合わせ内容に基づく概算見積です。',
  lineItems: [validLineItem]
}

describe('LineItemInputSchema', () => {
  it('正しい入力を受け入れる', () => {
    expect(LineItemInputSchema.safeParse(validLineItem).success).toBe(true)
  })

  it('品名が空欄の場合はエラーになる', () => {
    const result = LineItemInputSchema.safeParse({ ...validLineItem, name: '' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('品名を入力してください')
    }
  })

  it('数量が0以下の場合はエラーになる', () => {
    expect(LineItemInputSchema.safeParse({ ...validLineItem, quantity: 0 }).success).toBe(false)
    expect(LineItemInputSchema.safeParse({ ...validLineItem, quantity: -1 }).success).toBe(false)
  })

  it('数量は小数第2位まで許容する', () => {
    expect(LineItemInputSchema.safeParse({ ...validLineItem, quantity: 1.25 }).success).toBe(true)
  })

  it('数量が小数第3位以下を含む場合はエラーになる', () => {
    expect(LineItemInputSchema.safeParse({ ...validLineItem, quantity: 1.234 }).success).toBe(false)
  })

  it('単価が負の場合はエラーになる', () => {
    expect(LineItemInputSchema.safeParse({ ...validLineItem, unitPrice: -1 }).success).toBe(false)
  })

  it('単価0は許容する', () => {
    expect(LineItemInputSchema.safeParse({ ...validLineItem, unitPrice: 0 }).success).toBe(true)
  })

  it('税率は10または8のみ許容する', () => {
    expect(LineItemInputSchema.safeParse({ ...validLineItem, taxRate: 5 }).success).toBe(false)
    expect(LineItemInputSchema.safeParse({ ...validLineItem, taxRate: 8 }).success).toBe(true)
  })
})

describe('QuoteInputSchema', () => {
  it('正しい入力を受け入れる', () => {
    expect(QuoteInputSchema.safeParse(validInput).success).toBe(true)
  })

  it('取引先が未選択(0)の場合はエラーになる', () => {
    const result = QuoteInputSchema.safeParse({ ...validInput, clientId: 0 })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('取引先を選択してください')
    }
  })

  it('発行日が空欄の場合はエラーになる', () => {
    const result = QuoteInputSchema.safeParse({ ...validInput, issueDate: '' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('発行日を入力してください')
    }
  })

  it('有効期限が空欄でもエラーにならない(任意項目)', () => {
    expect(QuoteInputSchema.safeParse({ ...validInput, validUntil: '' }).success).toBe(true)
  })

  it('明細行が0件の場合はエラーになる', () => {
    const result = QuoteInputSchema.safeParse({ ...validInput, lineItems: [] })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('明細行を1行以上入力してください')
    }
  })

  it('備考が501文字以上の場合はエラーになる', () => {
    expect(QuoteInputSchema.safeParse({ ...validInput, remarks: 'あ'.repeat(501) }).success).toBe(
      false
    )
  })

  it('明細行内のエラーはlineItemsのパスで報告される', () => {
    const result = QuoteInputSchema.safeParse({
      ...validInput,
      lineItems: [{ ...validLineItem, name: '' }]
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['lineItems', 0, 'name'])
    }
  })
})
