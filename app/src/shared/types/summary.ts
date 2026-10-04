/** 集計(F-23)の応答。参照元: 詳細設計書4.23章、7章(`summary:get`) */
export interface SummaryAmounts {
  income: number
  expense: number
  /** 差額(入金合計−経費合計。負の値を許容する) */
  balance: number
}

export interface SummaryResult {
  /** 年の選択肢(記録のある年と当年の和集合。昇順) */
  years: number[]
  /** 指定した期間(月の指定が無い場合は年全体)の合計 */
  period: SummaryAmounts
  /** 1〜12月(記録の無い月は0円) */
  monthly: Array<{ month: number } & SummaryAmounts>
  /** 指定した年の合計 */
  yearTotal: SummaryAmounts
  /** 記録のある全年 */
  yearly: Array<{ year: number } & SummaryAmounts>
  /** 指定した期間の勘定科目別の経費合計 */
  expenseByAccount: Array<{ accountId: number; accountName: string; total: number }>
}
