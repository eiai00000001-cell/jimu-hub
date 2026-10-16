import type { Page } from '@playwright/test'
import { callApi, mustApi } from './helpers-i2'
import { dbQuery } from './helpers'

/**
 * イテレーション4(タスク・期限管理)の結合シナリオ用の補助関数(tester作成)。
 * 実装コード(app/src)は参照のみで変更しない。
 */

export interface TaskLite {
  id: number
  name: string
  status: 'open' | 'done'
  dueDate: string | null
  projectId: number | null
  projectName: string | null
  projectStatus: 'active' | 'completed' | null
  completedAt: string | null
  overdue: boolean
}

export interface TaskListResultLite {
  items: TaskLite[]
  counts: { open: number; overdue: number }
}

/** 指定タイムゾーン(省略時はこのPCのローカル)の「今日」から`offsetDays`日ずらした日付(YYYY-MM-DD) */
export function localDate(offsetDays = 0, timeZone?: string): string {
  const base = new Date().toLocaleDateString('en-CA', timeZone ? { timeZone } : undefined)
  const [y, m, d] = base.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + offsetDays))
  return t.toISOString().slice(0, 10)
}

export interface NewTask {
  name: string
  memo?: string
  dueDate?: string | null
  projectId?: number | null
}

export async function createTaskApi(window: Page, t: NewTask): Promise<number> {
  const r = await mustApi<{ id: number }>(window, 'createTask', {
    memo: '',
    dueDate: '',
    projectId: null,
    ...t
  })
  return r.id
}

export async function listTasksApi(
  window: Page,
  filter: Record<string, unknown> = {}
): Promise<TaskListResultLite> {
  return mustApi<TaskListResultLite>(window, 'listTasks', filter)
}

export { callApi, mustApi }

/** タスク表の全行(ID順)を文字列化する。往復比較用 */
export function dumpTasks(dataDir: string): string {
  return dbQuery(dataDir, 'select * from tasks order by id')
}

/** 書類・記録・案件など「タスクの操作で変わってはならないもの」のスナップショット */
export function snapshotNonTask(dataDir: string): string {
  return [
    'select * from projects order by id',
    'select * from project_link_history order by id',
    'select id,quote_number,pdf_hash,updated_at,project_id from quotes order by id',
    'select id,invoice_number,pdf_hash,updated_at,project_id,payment_status from invoices order by id',
    'select id,record_hash,updated_at,project_id,status from cash_records order by id',
    'select * from cash_record_history order by id',
    'select id,sha256 from receipts order by id'
  ]
    .map((q) => dbQuery(dataDir, q))
    .join('\n--\n')
}

export function taskRow(dataDir: string, id: number): string[] {
  return dbQuery(dataDir, `select * from tasks where id=${id}`).split('|')
}
