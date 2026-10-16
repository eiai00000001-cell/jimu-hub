/**
 * タスク(TASKS)の型定義。
 * 参照元: 詳細設計書 3.27〜3.29章、4.34〜4.38章、6.19章
 */

export const TASK_STATUSES = ['open', 'done'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

/** タスクの基本情報(`tasks`テーブルの1行) */
export interface Task {
  id: number
  name: string
  memo: string | null
  /** 期限日(`YYYY-MM-DD`)。期限なしはnull */
  dueDate: string | null
  /** 紐づく案件。案件なしはnull */
  projectId: number | null
  status: TaskStatus
  /** 完了日時(ISO8601)。未完了はnull */
  completedAt: string | null
  createdAt: string
  updatedAt: string
}
