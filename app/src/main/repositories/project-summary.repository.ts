import type { Database } from '../db/db'
import type { ProjectSummary } from '@shared/types/project'

const EMPTY_SUMMARY: ProjectSummary = {
  sales: 0,
  withholding: 0,
  expense: 0,
  balance: 0,
  counts: { quotes: 0, invoicesIssued: 0, invoicesDraft: 0, incomes: 0, expenses: 0 }
}

function emptySummary(): ProjectSummary {
  return { ...EMPTY_SUMMARY, counts: { ...EMPTY_SUMMARY.counts } }
}

/**
 * 案件別収支の集計(案件の全期間)。案件一覧と案件詳細で同じ集計を使う。
 * 売上=発行済み(PDF保存済み)の請求書の合計金額(税込・源泉徴収前。下書き・見積書・入金記録は含めない)、
 * 経費=有効な「経費」の合計(取消済・削除済は含めない)、差引=売上-経費。
 * 参照元: 詳細設計書4.28章手順3・4.31章、5章(`ProjectSummaryRepository`)
 */
export class ProjectSummaryRepository {
  constructor(private readonly database: Database) {}

  /** 1案件の集計。紐づくデータが無い場合は、すべて0 */
  summary(projectId: number): ProjectSummary {
    return this.summariesByProject().get(projectId) ?? emptySummary()
  }

  /** 全案件の集計を、案件数に関わらず3回のSQL(請求書・入出金経費・見積書)で取得する(案件IDをキーとするMap) */
  summariesByProject(): Map<number, ProjectSummary> {
    const sqlite = this.database.sqlite
    const result = new Map<number, ProjectSummary>()
    const of = (id: number): ProjectSummary => {
      let summary = result.get(id)
      if (!summary) {
        summary = emptySummary()
        result.set(id, summary)
      }
      return summary
    }

    const invoices = sqlite
      .prepare(
        `SELECT project_id AS id,
                COALESCE(SUM(CASE WHEN status = 'finalized' THEN total_amount END), 0) AS sales,
                COALESCE(SUM(CASE WHEN status = 'finalized' THEN withholding_tax_amount END), 0) AS withholding,
                SUM(CASE WHEN status = 'finalized' THEN 1 ELSE 0 END) AS issued,
                SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS draft
         FROM invoices WHERE project_id IS NOT NULL GROUP BY project_id`
      )
      .all() as Array<{
      id: number
      sales: number
      withholding: number
      issued: number
      draft: number
    }>
    for (const row of invoices) {
      const summary = of(row.id)
      summary.sales = row.sales
      summary.withholding = row.withholding
      summary.counts.invoicesIssued = row.issued
      summary.counts.invoicesDraft = row.draft
    }

    const records = sqlite
      .prepare(
        `SELECT project_id AS id,
                COALESCE(SUM(CASE WHEN kind = 'expense' AND status = 'active' THEN amount END), 0) AS expense,
                SUM(CASE WHEN kind = 'income' THEN 1 ELSE 0 END) AS incomes,
                SUM(CASE WHEN kind = 'expense' THEN 1 ELSE 0 END) AS expenses
         FROM cash_records WHERE project_id IS NOT NULL AND is_deleted = 0 GROUP BY project_id`
      )
      .all() as Array<{ id: number; expense: number; incomes: number; expenses: number }>
    for (const row of records) {
      const summary = of(row.id)
      summary.expense = row.expense
      summary.counts.incomes = row.incomes
      summary.counts.expenses = row.expenses
    }

    const quotes = sqlite
      .prepare(
        'SELECT project_id AS id, COUNT(*) AS cnt FROM quotes WHERE project_id IS NOT NULL GROUP BY project_id'
      )
      .all() as Array<{ id: number; cnt: number }>
    for (const row of quotes) of(row.id).counts.quotes = row.cnt

    for (const summary of result.values()) summary.balance = summary.sales - summary.expense
    return result
  }
}
