import { describe, expect, it } from 'vitest'
import { isValidIsoDate, optionalIsoDate, requiredIsoDate } from './date.schema'
import { QuoteInputSchema } from './quote.schema'
import { InvoiceInputSchema, PaymentStatusInputSchema } from './invoice.schema'

const line = { name: '作業', quantity: 1, unit: '', unitPrice: 1000, taxRate: 10 }

describe('isValidIsoDate', () => {
  it('実在するYYYY-MM-DDを受け入れる(うるう日を含む)', () => {
    expect(isValidIsoDate('2026-10-02')).toBe(true)
    expect(isValidIsoDate('2028-02-29')).toBe(true)
  })

  it.each([
    'abc',
    '',
    '2026-1-2',
    '2026/10/02',
    '2026-02-30',
    '2027-02-29',
    '2026-13-01',
    '2026-10-02 '
  ])('%j は受け付けない', (value) => {
    expect(isValidIsoDate(value)).toBe(false)
  })
})

describe('requiredIsoDate / optionalIsoDate', () => {
  it('必須は空文字で未入力、形式不正で形式エラーとなる', () => {
    const schema = requiredIsoDate('必須です')
    expect(schema.safeParse('').error?.issues[0]?.message).toBe('必須です')
    expect(schema.safeParse('abc').error?.issues[0]?.message).toContain('YYYY-MM-DD')
  })

  it('任意は空文字を許容し、値があれば形式を検証する', () => {
    expect(optionalIsoDate.safeParse('').success).toBe(true)
    expect(optionalIsoDate.safeParse('2026-10-02').success).toBe(true)
    expect(optionalIsoDate.safeParse('garbage').success).toBe(false)
  })
})

describe('IPC境界での日付検証(I1-02)', () => {
  it('見積書: 発行日・有効期限の不正値を拒否する', () => {
    const base = {
      clientId: 1,
      issueDate: '2026-10-02',
      validUntil: '',
      remarks: '',
      lineItems: [line]
    }
    expect(QuoteInputSchema.safeParse(base).success).toBe(true)
    expect(QuoteInputSchema.safeParse({ ...base, issueDate: 'abc' }).success).toBe(false)
    expect(QuoteInputSchema.safeParse({ ...base, validUntil: '<b>' }).success).toBe(false)
  })

  it('請求書: 発行日・支払期限の不正値を拒否する', () => {
    const base = {
      clientId: 1,
      issueDate: '2026-10-02',
      dueDate: '',
      remarks: '',
      lineItems: [line]
    }
    expect(InvoiceInputSchema.safeParse(base).success).toBe(true)
    expect(InvoiceInputSchema.safeParse({ ...base, issueDate: '2026-02-30' }).success).toBe(false)
    expect(InvoiceInputSchema.safeParse({ ...base, dueDate: 'x' }).success).toBe(false)
  })

  it('入金日の不正値を拒否する', () => {
    expect(
      PaymentStatusInputSchema.safeParse({ paymentStatus: 'paid', paymentDate: 'garbage' }).success
    ).toBe(false)
    expect(
      PaymentStatusInputSchema.safeParse({ paymentStatus: 'paid', paymentDate: '2026-10-02' })
        .success
    ).toBe(true)
    expect(
      PaymentStatusInputSchema.safeParse({ paymentStatus: 'unpaid', paymentDate: null }).success
    ).toBe(true)
  })
})
