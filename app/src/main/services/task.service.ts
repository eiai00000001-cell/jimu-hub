import { PROJECT_MESSAGES, TASK_MESSAGES } from '@shared/messages/messages'
import {
  TaskInputSchema,
  TaskListFilterSchema,
  type TaskInput,
  type TaskListFilterInput
} from '@shared/schemas/task.schema'
import type { TaskDetail, TaskListResult } from '@shared/types/task'
import { LocalTodayProvider, type TodayProvider } from './clock/today-provider'
import type { Database } from '../db/db'
import type { ProjectRepository } from '../repositories/project.repository'
import type { TaskRecordInput, TaskRepository } from '../repositories/task.repository'

/** タスクの業務エラー(未存在・案件の不整合・入力違反等)。メッセージは画面にそのまま表示する */
export class TaskError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TaskError'
  }
}

/**
 * タスクの登録・更新・削除・完了/未完了の切り替えを担うApplication Service層。
 * 書類・入出金・案件の行、各種ハッシュ・履歴には一切触れない。
 * 参照元: 詳細設計書 4.34〜4.36章、5章(`TaskService`)
 */
export class TaskService {
  constructor(
    private readonly database: Database,
    private readonly repository: TaskRepository,
    private readonly projectRepository: ProjectRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly todayProvider: TodayProvider = new LocalTodayProvider(now)
  ) {}

  createTask(input: TaskInput): { id: number } {
    const record = this.validate(input, null)
    return this.repository.insert(record, this.nowIso())
  }

  updateTask(id: number, input: TaskInput): { success: true } {
    const current = this.repository.findById(id)
    if (!current) throw new TaskError(TASK_MESSAGES.notFound)
    const record = this.validate(input, current.projectId)
    if (!this.repository.update(id, record, this.nowIso())) {
      throw new TaskError(TASK_MESSAGES.notFound)
    }
    return { success: true }
  }

  /** 未完了→完了。すでに完了の場合は何も変更せず`changed: false`(冪等) */
  completeTask(id: number): { changed: boolean } {
    return this.database.transaction(() => {
      if (this.repository.markDone(id, this.nowIso())) return { changed: true }
      this.requireExists(id)
      return { changed: false }
    })
  }

  /** 完了→未完了。すでに未完了の場合は何も変更せず`changed: false`(冪等) */
  reopenTask(id: number): { changed: boolean } {
    return this.database.transaction(() => {
      if (this.repository.markOpen(id, this.nowIso())) return { changed: true }
      this.requireExists(id)
      return { changed: false }
    })
  }

  deleteTask(id: number): { success: true } {
    if (!this.repository.delete(id)) throw new TaskError(TASK_MESSAGES.notFound)
    return { success: true }
  }

  /**
   * 一覧(絞り込み)と件数を返す。件数は絞り込みにかかわらず全タスクが対象。
   * 期限超過は、呼び出しごとに今日と比較して判定する(詳細設計書4.37章)。
   */
  listTasks(filter: TaskListFilterInput = {}): TaskListResult {
    const parsed = TaskListFilterSchema.safeParse(filter)
    if (!parsed.success) throw new TaskError(parsed.error.issues[0]?.message ?? 'Invalid input')
    const today = this.todayProvider.today()
    return {
      items: this.repository.search(parsed.data, today),
      counts: this.repository.countOpenAndOverdue(today)
    }
  }

  getTask(id: number): TaskDetail {
    const detail = this.repository.findDetail(id, this.todayProvider.today())
    if (!detail) throw new TaskError(TASK_MESSAGES.notFound)
    return detail
  }

  private requireExists(id: number): void {
    if (!this.repository.findById(id)) throw new TaskError(TASK_MESSAGES.notFound)
  }

  private nowIso(): string {
    return this.now().toISOString()
  }

  /**
   * 入力を検証・正規化する。案件は、存在すること、進行中であること
   * (更新で現在と同じ案件の場合は、完了の案件でも許可する。詳細設計書4.34章手順3)。
   */
  private validate(input: TaskInput, currentProjectId: number | null): TaskRecordInput {
    const parsed = TaskInputSchema.safeParse(input)
    if (!parsed.success) throw new TaskError(parsed.error.issues[0]?.message ?? 'Invalid input')
    const value = parsed.data
    if (value.projectId !== null) {
      const project = this.projectRepository.findById(value.projectId)
      if (!project) throw new TaskError(TASK_MESSAGES.projectNotFound)
      if (value.projectId !== currentProjectId && project.status !== 'active') {
        throw new TaskError(PROJECT_MESSAGES.projectNotSelectable)
      }
    }
    return {
      name: value.name,
      memo: value.memo,
      dueDate: value.dueDate,
      projectId: value.projectId
    }
  }
}
