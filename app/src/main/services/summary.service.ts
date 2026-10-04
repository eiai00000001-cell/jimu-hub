import type { SummaryInput } from '@shared/schemas/summary.schema'
import { SummaryInputSchema } from '@shared/schemas/summary.schema'
import type { SummaryAmounts, SummaryResult } from '@shared/types/summary'
import type { SummaryRepository } from '../repositories/summary.repository'

const amounts = (income: number, expense: number): SummaryAmounts => ({
  income,
  expense,
  balance: income - expense
})

/**
 * 月別・年別・勘定科目別の集計を担うApplication Service層。
 * 金額は`amount`(税込。請求書から自動作成された入金記録は源泉徴収後の実入金額)をそのまま合計し、消費税額は用いない。
 * 参照元: 詳細設計書4.23章、5章(`SummaryService`)
 */
export class SummaryService {
  constructor(
    private readonly repository: SummaryRepository,
    private readonly now: () => Date = () => new Date()
  ) {}

  getSummary(rawInput: SummaryInput): SummaryResult {
    const { year, month } = SummaryInputSchema.parse(rawInput)
    const pad = (n: number): string => String(n).padStart(2, '0')

    const monthlyRows = new Map(
      this.repository.monthlyTotals(`${year}-01-01`, `${year}-12-31`).map((r) => [r.key, r])
    )
    const monthly = Array.from({ length: 12 }, (_, i) => {
      const row = monthlyRows.get(`${year}-${pad(i + 1)}`)
      return { month: i + 1, ...amounts(row?.income_total ?? 0, row?.expense_total ?? 0) }
    })
    const yearTotal = amounts(
      monthly.reduce((sum, m) => sum + m.income, 0),
      monthly.reduce((sum, m) => sum + m.expense, 0)
    )

    const yearly = this.repository.yearlyTotals().map((r) => ({
      year: Number(r.key),
      ...amounts(r.income_total, r.expense_total)
    }))
    const years = [...new Set([...yearly.map((y) => y.year), this.now().getFullYear()])].sort(
      (a, b) => a - b
    )

    const from = month === null ? `${year}-01-01` : `${year}-${pad(month)}-01`
    const to = month === null ? `${year}-12-31` : `${year}-${pad(month)}-31`
    const period =
      month === null
        ? yearTotal
        : (({ income, expense, balance }) => ({ income, expense, balance }))(monthly[month - 1]!)

    return {
      years,
      period,
      monthly,
      yearTotal,
      yearly,
      expenseByAccount: this.repository
        .expenseByAccount(from, to)
        .map((r) => ({ accountId: r.id, accountName: r.name, total: r.total }))
    }
  }
}
