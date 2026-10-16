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

/** タスク一覧の1行(案件名・案件の状態と、表示時に判定した期限超過を含む。詳細設計書4.37章手順5) */
export interface TaskListItem {
  id: number
  name: string
  status: TaskStatus
  dueDate: string | null
  projectId: number | null
  projectName: string | null
  /** 案件の状態。案件なしはnull(完了の案件は名前に「(完了)」を付記して表示する) */
  projectStatus: 'active' | 'completed' | null
  completedAt: string | null
  /** 未完了で期限日が今日より前の場合のみtrue。保存せず、表示のたびに求める */
  overdue: boolean
}

/** タスク詳細(`tasks:get`) */
export interface TaskDetail extends TaskListItem {
  memo: string | null
  createdAt: string
  updatedAt: string
}

/** 一覧上部の件数。絞り込みにかかわらず全タスクが対象(基本設計書8.2章★33) */
export interface TaskCounts {
  open: number
  overdue: number
}

export interface TaskListResult {
  items: TaskListItem[]
  counts: TaskCounts
}
