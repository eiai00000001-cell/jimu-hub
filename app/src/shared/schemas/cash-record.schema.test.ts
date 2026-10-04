import { describe, expect, it } from 'vitest'
import {
  CashRecordCreateSchema,
  CashRecordInputSchema,
  CashRecordUpdateSchema,
  HistoryListFilterSchema,
  RecordListFilterSchema
} from './cash-record.schema'

const valid = {
  kind: 'expense' as const,
  recordDate: '2026-10-01',
  amount: 6600,
  accountId: 1,
  description: ' インターネット回線 ',
  clientId: null,
  paymentMethod: null,
  taxCategory: 'standard_10' as const
}

function firstMessage(input: unknown): string | undefined {
  const r = CashRecordInputSchema.safeParse(input)
  return r.success ? undefined : r.error.issues[0]?.message
}

describe('CashRecordInputSchema(詳細設計書3.16章)', () => {
  it('正常な入力を受け付け、摘要の前後空白を除去する', () => {
    const r = CashRecordInputSchema.parse(valid)
    expect(r.description).toBe('インターネット回線')
  })
  it('日付: 空欄・不正・範囲外のメッセージ', () => {
    expect(firstMessage({ ...valid, recordDate: '' })).toBe('日付を入力してください')
    expect(firstMessage({ ...valid, recordDate: '2026-02-30' })).toContain('YYYY-MM-DD')
    expect(firstMessage({ ...valid, recordDate: '1999-12-31' })).toBe(
      '日付は2000年〜2099年の範囲で入力してください'
    )
    expect(firstMessage({ ...valid, recordDate: '2100-01-01' })).toContain('2000年〜2099年')
  })
  it('金額: 0以下・小数・上限超過・数値以外を拒否する', () => {
    const msg = '金額は1円以上9,999,999,999円以下の整数で入力してください'
    for (const amount of [0, -1, 1.5, 10_000_000_000, 'abc', undefined]) {
      expect(firstMessage({ ...valid, amount })).toBe(msg)
    }
    expect(CashRecordInputSchema.safeParse({ ...valid, amount: 9_999_999_999 }).success).toBe(true)
  })
  it('勘定科目・摘要のメッセージ', () => {
    expect(firstMessage({ ...valid, accountId: 0 })).toBe('勘定科目を選択してください')
    expect(firstMessage({ ...valid, accountId: undefined })).toBe('勘定科目を選択してください')
    expect(firstMessage({ ...valid, description: '   ' })).toBe('摘要・メモを入力してください')
    expect(firstMessage({ ...valid, description: 'あ'.repeat(201) })).toBe(
      '摘要・メモは200文字以内で入力してください'
    )
    expect(
      CashRecordInputSchema.safeParse({ ...valid, description: 'あ'.repeat(200) }).success
    ).toBe(true)
  })
  it('列挙値以外を拒否する', () => {
    expect(firstMessage({ ...valid, kind: 'other' })).toBeDefined()
    expect(firstMessage({ ...valid, paymentMethod: 'bitcoin' })).toBeDefined()
    expect(firstMessage({ ...valid, taxCategory: 'x' })).toBeDefined()
  })
})

describe('RecordListFilterSchema / HistoryListFilterSchema', () => {
  it('空の条件を受け付ける', () => {
    expect(RecordListFilterSchema.safeParse({}).success).toBe(true)
    expect(HistoryListFilterSchema.safeParse({}).success).toBe(true)
  })
  it('日付範囲・金額範囲の逆転を拒否する', () => {
    const d = RecordListFilterSchema.safeParse({ dateFrom: '2026-10-02', dateTo: '2026-10-01' })
    expect(d.success ? '' : d.error.issues[0]?.message).toBe(
      '日付の終了日は、開始日以降の日付を入力してください'
    )
    const a = RecordListFilterSchema.safeParse({ amountMin: 100, amountMax: 10 })
    expect(a.success).toBe(false)
    expect(
      HistoryListFilterSchema.safeParse({ dateFrom: '2026-10-02', dateTo: '2026-10-01' }).success
    ).toBe(false)
  })
  it('不正な種別・ページを拒否する', () => {
    expect(RecordListFilterSchema.safeParse({ kind: 'x' }).success).toBe(false)
    expect(RecordListFilterSchema.safeParse({ page: 0 }).success).toBe(false)
    expect(HistoryListFilterSchema.safeParse({ operation: 'x' }).success).toBe(false)
  })
})

describe('領収書の識別子の重複(R-19)', () => {
  const message = '同じ領収書が重複して指定されています'
  it('作成・更新とも、同じtokenの重複指定を拒否する', () => {
    const created = CashRecordCreateSchema.safeParse({ ...valid, receiptTokens: ['a', 'a'] })
    expect(created.success ? undefined : created.error.issues[0]?.message).toBe(message)
    const updated = CashRecordUpdateSchema.safeParse({
      ...valid,
      id: 1,
      addReceiptTokens: ['a', 'a']
    })
    expect(updated.success ? undefined : updated.error.issues[0]?.message).toBe(message)
  })
  it('異なるtokenは受け付ける', () => {
    expect(CashRecordCreateSchema.safeParse({ ...valid, receiptTokens: ['a', 'b'] }).success).toBe(
      true
    )
  })
})
