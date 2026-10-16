import type { Database } from '../db/db'
import { isOverdue, type TaskListFilter } from '@shared/schemas/task.schema'
import type { Task, TaskCounts, TaskDetail, TaskListItem, TaskStatus } from '@shared/types/task'

/** Repositoryへ渡す、正規化済み(空をnullへ変換済み)のタスクの項目 */
export interface TaskRecordInput {
  name: string
  memo: string | null
  dueDate: string | null
  projectId: number | null
}

interface TaskRow {
  id: number
  name: string
  memo: string | null
  due_date: string | null
  project_id: number | null
  status: TaskStatus
  completed_at: string | null
  created_at: string
  updated_at: string
}

interface TaskJoinedRow extends TaskRow {
  project_name: string | null
  project_status: 'active' | 'completed' | null
}

const TASK_JOINED_SELECT = `
  SELECT t.*, p.name AS project_name, p.status AS project_status
  FROM tasks t LEFT JOIN projects p ON p.id = t.project_id`

const TASK_ORDER = 'ORDER BY (t.due_date IS NULL) ASC, t.due_date ASC, t.id ASC'

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

function toListItem(row: TaskJoinedRow, today: string): TaskListItem {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    dueDate: row.due_date,
    projectId: row.project_id,
    projectName: row.project_name,
    projectStatus: row.project_status,
    completedAt: row.completed_at,
    overdue: isOverdue(row.status, row.due_date, today)
  }
}

/**
 * tasksテーブルへのアクセスを担うRepository層。
 * 日時は呼び出し側(Service)から渡す。履歴・ハッシュは持たない。
 * 参照元: 詳細設計書 4.34〜4.36章、5章(`TaskRepository`)、6.19章
 */
export class TaskRepository {
  constructor(private readonly database: Database) {}

  private get sqlite(): Database['sqlite'] {
    return this.database.sqlite
  }

  findById(id: number): Task | null {
    const row = this.sqlite.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as
      TaskRow | undefined
    return row
      ? {
          id: row.id,
          name: row.name,
          memo: row.memo,
          dueDate: row.due_date,
          projectId: row.project_id,
          status: row.status,
          completedAt: row.completed_at,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        }
      : null
  }

  /** 未完了のタスクとして登録する。同じ名前も登録できる */
  insert(input: TaskRecordInput, now: string): { id: number } {
    const result = this.sqlite
      .prepare(
        `INSERT INTO tasks (name, memo, due_date, project_id, status, completed_at, created_at, updated_at)
         VALUES (@name, @memo, @dueDate, @projectId, 'open', NULL, @now, @now)`
      )
      .run({ ...input, now })
    return { id: Number(result.lastInsertRowid) }
  }

  /** 名前・メモ・期限日・案件・更新日時のみ更新する(状態・完了日時は変えない)。対象がなければfalse */
  update(id: number, input: TaskRecordInput, now: string): boolean {
    const result = this.sqlite
      .prepare(
        `UPDATE tasks SET name = @name, memo = @memo, due_date = @dueDate,
                project_id = @projectId, updated_at = @now WHERE id = @id`
      )
      .run({ ...input, id, now })
    return result.changes > 0
  }

  /** 未完了のタスクを完了にする。更新したらtrue(すでに完了・存在しない場合はfalse) */
  markDone(id: number, now: string): boolean {
    return (
      this.sqlite
        .prepare(
          `UPDATE tasks SET status = 'done', completed_at = @now, updated_at = @now
           WHERE id = @id AND status = 'open'`
        )
        .run({ id, now }).changes > 0
    )
  }

  /** 完了のタスクを未完了に戻す。更新したらtrue(すでに未完了・存在しない場合はfalse) */
  markOpen(id: number, now: string): boolean {
    return (
      this.sqlite
        .prepare(
          `UPDATE tasks SET status = 'open', completed_at = NULL, updated_at = @now
           WHERE id = @id AND status = 'done'`
        )
        .run({ id, now }).changes > 0
    )
  }

  delete(id: number): boolean {
    return this.sqlite.prepare('DELETE FROM tasks WHERE id = ?').run(id).changes > 0
  }

  /**
   * 条件(すべてを満たすもの)で検索する。並びは期限日の昇順(期限なしは末尾)、同じ期限は登録の古い順。
   * `overdue`は保存せず、渡された「今日」で求める。
   */
  search(filter: TaskListFilter, today: string): TaskListItem[] {
    const where: string[] = []
    const params: Record<string, string | number> = {}
    if (filter.status !== 'all') {
      where.push('t.status = @status')
      params.status = filter.status
    }
    if (filter.projectId === null) {
      where.push('t.project_id IS NULL')
    } else if (filter.projectId !== undefined) {
      where.push('t.project_id = @projectId')
      params.projectId = filter.projectId
    }
    if (filter.keyword !== '') {
      where.push("t.name LIKE '%' || @keyword || '%' ESCAPE '\\'")
      params.keyword = escapeLike(filter.keyword)
    }
    if (filter.dueMode === 'range' && (filter.dueFrom || filter.dueTo)) {
      where.push('t.due_date IS NOT NULL')
      if (filter.dueFrom) {
        where.push('t.due_date >= @dueFrom')
        params.dueFrom = filter.dueFrom
      }
      if (filter.dueTo) {
        where.push('t.due_date <= @dueTo')
        params.dueTo = filter.dueTo
      }
    } else if (filter.dueMode === 'overdue') {
      where.push("t.status = 'open' AND t.due_date IS NOT NULL AND t.due_date < @today")
      params.today = today
    } else if (filter.dueMode === 'none') {
      where.push('t.due_date IS NULL')
    }
    const sql = `${TASK_JOINED_SELECT} ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''} ${TASK_ORDER}`
    return (this.sqlite.prepare(sql).all(params) as TaskJoinedRow[]).map((row) =>
      toListItem(row, today)
    )
  }

  /** 案件に紐づくタスク(未完了・完了とも)。並び・overdueは`search`と同じ */
  findByProject(projectId: number, today: string): TaskListItem[] {
    return (
      this.sqlite
        .prepare(`${TASK_JOINED_SELECT} WHERE t.project_id = ? ${TASK_ORDER}`)
        .all(projectId) as TaskJoinedRow[]
    ).map((row) => toListItem(row, today))
  }

  /** 全タスクを対象にした、未完了と期限超過の件数 */
  countOpenAndOverdue(today: string): TaskCounts {
    const row = this.sqlite
      .prepare(
        `SELECT
           COUNT(CASE WHEN status = 'open' THEN 1 END) AS open,
           COUNT(CASE WHEN status = 'open' AND due_date IS NOT NULL AND due_date < ? THEN 1 END) AS overdue
         FROM tasks`
      )
      .get(today) as TaskCounts
    return { open: row.open, overdue: row.overdue }
  }

  /** 詳細表示用(メモ・登録/更新日時・案件名を含む)。なければnull */
  findDetail(id: number, today: string): TaskDetail | null {
    const row = this.sqlite.prepare(`${TASK_JOINED_SELECT} WHERE t.id = ?`).get(id) as
      TaskJoinedRow | undefined
    return row
      ? {
          ...toListItem(row, today),
          memo: row.memo,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        }
      : null
  }
}
