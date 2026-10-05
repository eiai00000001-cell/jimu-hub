import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { Database } from '../db/db'
import { SummaryRepository } from '../repositories/summary.repository'
import { SummaryService } from './summary.service'

describe('SummaryService(F-23。詳細設計書4.23章)', () => {
  let db: Database
  let service: SummaryService
  let expenseAccounts: number[]
  let income: number

  beforeEach(() => {
    db = new Database(':memory:')
    db.initialize()
    service = new SummaryService(new SummaryRepository(db), () => new Date(2026, 9, 4))
    expenseAccounts = (
      db.sqlite
        .prepare("SELECT id FROM accounts WHERE kind = 'expense' ORDER BY sort_order")
        .all() as Array<{
        id: number
      }>
    ).map((r) => r.id)
    income = (
      db.sqlite.prepare("SELECT id FROM accounts WHERE default_key = 'sales_revenue'").get() as {
        id: number
      }
    ).id
  })
  afterEach(() => db.close())

  const add = (
    date: string,
    kind: 'income' | 'expense',
    amount: number,
    accountId: number,
    extra: { status?: string; deleted?: number } = {}
  ): void => {
    db.sqlite
      .prepare(
        `INSERT INTO cash_records (record_date, kind, amount, account_id, description, status, is_deleted, tax_amount)
         VALUES (?, ?, ?, ?, 'x', ?, ?, 999)`
      )
      .run(date, kind, amount, accountId, extra.status ?? 'active', extra.deleted ?? 0)
  }

  it('記録が無い場合は、年の選択肢は当年のみで、すべて0円(月別は12件)', () => {
    const r = service.getSummary({ year: 2026, month: null })
    expect(r.years).toEqual([2026])
    expect(r.period).toEqual({ income: 0, expense: 0, balance: 0 })
    expect(r.monthly).toHaveLength(12)
    expect(r.monthly.every((m) => m.income === 0 && m.expense === 0 && m.balance === 0)).toBe(true)
    expect(r.yearTotal).toEqual({ income: 0, expense: 0, balance: 0 })
    expect(r.yearly).toEqual([])
    expect(r.expenseByAccount).toEqual([])
  })

  it('月別・年合計・差額(負を許容)を集計する。消費税額は用いない', () => {
    add('2026-09-10', 'income', 300000, income)
    add('2026-09-28', 'expense', 6600, expenseAccounts[0]!)
    add('2026-10-01', 'expense', 50000, expenseAccounts[1]!)
    const r = service.getSummary({ year: 2026, month: 9 })
    expect(r.monthly[8]).toEqual({ month: 9, income: 300000, expense: 6600, balance: 293400 })
    expect(r.monthly[9]).toEqual({ month: 10, income: 0, expense: 50000, balance: -50000 })
    expect(r.yearTotal).toEqual({ income: 300000, expense: 56600, balance: 243400 })
    expect(r.period).toEqual({ income: 300000, expense: 6600, balance: 293400 })
    expect(service.getSummary({ year: 2026, month: null }).period).toEqual(r.yearTotal)
  })

  it('取消済・削除済は集計対象外', () => {
    add('2026-09-10', 'income', 1000, income)
    add('2026-09-11', 'income', 5000, income, { status: 'cancelled' })
    add('2026-09-12', 'expense', 700, expenseAccounts[0]!, { deleted: 1 })
    const r = service.getSummary({ year: 2026, month: 9 })
    expect(r.period).toEqual({ income: 1000, expense: 0, balance: 1000 })
    expect(r.expenseByAccount).toEqual([])
  })

  it('年別は記録のある全年、年の選択肢は記録のある年と当年の和集合(昇順)', () => {
    add('2024-12-31', 'income', 100, income)
    add('2025-01-01', 'expense', 40, expenseAccounts[0]!)
    const r = service.getSummary({ year: 2026, month: null })
    expect(r.years).toEqual([2024, 2025, 2026])
    expect(r.yearly).toEqual([
      { year: 2024, income: 100, expense: 0, balance: 100 },
      { year: 2025, income: 0, expense: 40, balance: -40 }
    ])
    expect(service.getSummary({ year: 2025, month: 1 }).monthly[0]).toMatchObject({ expense: 40 })
    expect(service.getSummary({ year: 2026, month: null }).yearTotal.expense).toBe(0)
  })

  it('勘定科目別の経費合計は、指定期間・表示順で返す(入金は含めない)', () => {
    add('2026-09-01', 'expense', 100, expenseAccounts[2]!)
    add('2026-09-02', 'expense', 200, expenseAccounts[0]!)
    add('2026-09-30', 'expense', 50, expenseAccounts[0]!)
    add('2026-10-01', 'expense', 999, expenseAccounts[1]!)
    add('2026-09-05', 'income', 777, income)
    const sep = service.getSummary({ year: 2026, month: 9 }).expenseByAccount
    expect(sep.map((a) => [a.accountId, a.total])).toEqual([
      [expenseAccounts[0], 250],
      [expenseAccounts[2], 100]
    ])
    expect(sep[0]!.accountName).toBe('通信費')
    const all = service.getSummary({ year: 2026, month: null }).expenseByAccount
    expect(all.map((a) => a.total)).toEqual([250, 999, 100])
  })

  it('不正な年・月は拒否する', () => {
    expect(() => service.getSummary({ year: 1999, month: null })).toThrow()
    expect(() => service.getSummary({ year: 2026, month: 13 })).toThrow()
    expect(() => service.getSummary({ year: 2026.5, month: null })).toThrow()
  })
})
