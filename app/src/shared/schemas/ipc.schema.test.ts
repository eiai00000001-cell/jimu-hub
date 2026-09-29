import { describe, expect, it } from 'vitest'
import {
  ClientIdSchema,
  ClientListFilterSchema,
  QuoteIdSchema,
  OptionalQuoteIdSchema,
  QuoteListFilterSchema,
  InvoiceIdSchema,
  OptionalInvoiceIdSchema,
  InvoiceListFilterSchema
} from './ipc.schema'

describe('ClientIdSchema', () => {
  it('正の整数を受け入れる', () => {
    expect(ClientIdSchema.safeParse(1).success).toBe(true)
  })

  it('0以下・小数・文字列・undefinedは拒否する', () => {
    expect(ClientIdSchema.safeParse(0).success).toBe(false)
    expect(ClientIdSchema.safeParse(-1).success).toBe(false)
    expect(ClientIdSchema.safeParse(1.5).success).toBe(false)
    expect(ClientIdSchema.safeParse('1').success).toBe(false)
    expect(ClientIdSchema.safeParse(undefined).success).toBe(false)
  })
})

describe('ClientListFilterSchema', () => {
  it('空オブジェクト(全項目省略)を受け入れる', () => {
    expect(ClientListFilterSchema.safeParse({}).success).toBe(true)
  })

  it('正しいsort・statusFilterの組み合わせを受け入れる', () => {
    const result = ClientListFilterSchema.safeParse({
      keyword: 'アルファ',
      sort: 'created_at_desc',
      statusFilter: 'all'
    })
    expect(result.success).toBe(true)
  })

  it('sort=furigana_asc(既定値)を受け入れる', () => {
    expect(ClientListFilterSchema.safeParse({ sort: 'furigana_asc' }).success).toBe(true)
  })

  it('列挙値以外のsortは拒否する', () => {
    expect(ClientListFilterSchema.safeParse({ sort: 'unknown_sort' }).success).toBe(false)
  })

  it('列挙値以外のstatusFilterは拒否する', () => {
    expect(ClientListFilterSchema.safeParse({ statusFilter: 'unknown_status' }).success).toBe(false)
  })
})

describe('QuoteIdSchema・OptionalQuoteIdSchema', () => {
  it('正の整数を受け入れる', () => {
    expect(QuoteIdSchema.safeParse(1).success).toBe(true)
  })

  it('0以下・小数・文字列は拒否する', () => {
    expect(QuoteIdSchema.safeParse(0).success).toBe(false)
    expect(QuoteIdSchema.safeParse(-1).success).toBe(false)
    expect(QuoteIdSchema.safeParse(1.5).success).toBe(false)
    expect(QuoteIdSchema.safeParse('1').success).toBe(false)
  })

  it('OptionalQuoteIdSchemaはundefinedを受け入れる(新規作成時)', () => {
    expect(OptionalQuoteIdSchema.safeParse(undefined).success).toBe(true)
  })
})

describe('QuoteListFilterSchema', () => {
  it('空オブジェクト(全項目省略)を受け入れる', () => {
    expect(QuoteListFilterSchema.safeParse({}).success).toBe(true)
  })

  it('正しい組み合わせを受け入れる', () => {
    const result = QuoteListFilterSchema.safeParse({
      clientId: 1,
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31',
      amountMin: 0,
      amountMax: 100000,
      status: 'finalized'
    })
    expect(result.success).toBe(true)
  })

  it('列挙値以外のstatusは拒否する', () => {
    expect(QuoteListFilterSchema.safeParse({ status: 'unknown' }).success).toBe(false)
  })
})

describe('InvoiceIdSchema・OptionalInvoiceIdSchema', () => {
  it('正の整数を受け入れる', () => {
    expect(InvoiceIdSchema.safeParse(1).success).toBe(true)
  })

  it('0以下・小数・文字列は拒否する', () => {
    expect(InvoiceIdSchema.safeParse(0).success).toBe(false)
    expect(InvoiceIdSchema.safeParse(-1).success).toBe(false)
    expect(InvoiceIdSchema.safeParse(1.5).success).toBe(false)
    expect(InvoiceIdSchema.safeParse('1').success).toBe(false)
  })

  it('OptionalInvoiceIdSchemaはundefinedを受け入れる(新規作成時)', () => {
    expect(OptionalInvoiceIdSchema.safeParse(undefined).success).toBe(true)
  })
})

describe('InvoiceListFilterSchema', () => {
  it('空オブジェクト(全項目省略)を受け入れる', () => {
    expect(InvoiceListFilterSchema.safeParse({}).success).toBe(true)
  })

  it('正しい組み合わせ(paymentStatus含む)を受け入れる', () => {
    const result = InvoiceListFilterSchema.safeParse({
      clientId: 1,
      status: 'finalized',
      paymentStatus: 'unpaid'
    })
    expect(result.success).toBe(true)
  })

  it('列挙値以外のpaymentStatusは拒否する', () => {
    expect(InvoiceListFilterSchema.safeParse({ paymentStatus: 'unknown' }).success).toBe(false)
  })
})
