import type { Database } from '../db/db'

interface TotalRow {
  key: string
  income_total: number
  expense_total: number
}

/**
 * 集計用のクエリ。対象は`status = 'active' AND is_deleted = 0`(取消済・削除済を除く)で、
 * 期間の基準は`record_date`(暦年は1月〜12月)。
 * 参照元: 詳細設計書4.23章(`SummaryRepository`)
 */
export class SummaryRepository {
  constructor(private readonly database: Database) {}

  /** 指定した年の月別(キーは`YYYY-MM`) */
  monthlyTotals(yearStart: string, yearEnd: string): TotalRow[] {
    return this.database.sqlite
      .prepare(
        `SELECT substr(record_date, 1, 7) AS key,
                SUM(CASE WHEN kind = 'income'  THEN amount ELSE 0 END) AS income_total,
                SUM(CASE WHEN kind = 'expense' THEN amount ELSE 0 END) AS expense_total
         FROM cash_records
         WHERE status = 'active' AND is_deleted = 0 AND record_date >= ? AND record_date <= ?
         GROUP BY key`
      )
      .all(yearStart, yearEnd) as TotalRow[]
  }

  /** 記録のある全年(キーは`YYYY`) */
  yearlyTotals(): TotalRow[] {
    return this.database.sqlite
      .prepare(
        `SELECT substr(record_date, 1, 4) AS key,
                SUM(CASE WHEN kind = 'income'  THEN amount ELSE 0 END) AS income_total,
                SUM(CASE WHEN kind = 'expense' THEN amount ELSE 0 END) AS expense_total
         FROM cash_records
         WHERE status = 'active' AND is_deleted = 0
         GROUP BY key ORDER BY key`
      )
      .all() as TotalRow[]
  }

  /** 指定した期間の勘定科目別の経費合計(表示順) */
  expenseByAccount(from: string, to: string): Array<{ id: number; name: string; total: number }> {
    return this.database.sqlite
      .prepare(
        `SELECT a.id, a.name, SUM(r.amount) AS total
         FROM cash_records r JOIN accounts a ON a.id = r.account_id
         WHERE r.status = 'active' AND r.is_deleted = 0 AND r.kind = 'expense'
           AND r.record_date >= ? AND r.record_date <= ?
         GROUP BY a.id ORDER BY a.sort_order, a.id`
      )
      .all(from, to) as Array<{ id: number; name: string; total: number }>
  }
}
