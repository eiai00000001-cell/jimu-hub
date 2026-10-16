import type { Database } from '../db/db'
import type { Task, TaskStatus } from '@shared/types/task'

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
}
