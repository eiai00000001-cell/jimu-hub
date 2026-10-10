import { PROJECT_MESSAGES } from '@shared/messages/messages'
import {
  ProjectInputSchema,
  ProjectListFilterSchema,
  type ProjectInput,
  type ProjectListFilter
} from '@shared/schemas/project.schema'
import type {
  ProjectDetail,
  ProjectLinkHistoryEntry,
  ProjectLinkTargetType,
  ProjectListItem,
  ProjectSelectable
} from '@shared/types/project'
import type { Database } from '../db/db'
import type { ProjectRecordInput, ProjectRepository } from '../repositories/project.repository'
import type { ProjectSummaryRepository } from '../repositories/project-summary.repository'

/** 案件の業務エラー(未存在・紐づけあり・状態不整合等)。メッセージは画面にそのまま表示する */
export class ProjectError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectError'
  }
}

/**
 * 案件の登録・更新・削除・一覧・完了/再開を担うApplication Service層。
 * 参照元: 詳細設計書 4.27〜4.29章、5章(`ProjectService`)
 */
export class ProjectService {
  constructor(
    private readonly database: Database,
    private readonly repository: ProjectRepository,
    private readonly summaryRepository: ProjectSummaryRepository
  ) {}

  listProjects(filter: ProjectListFilter = {}): ProjectListItem[] {
    const parsed = ProjectListFilterSchema.safeParse(filter)
    if (!parsed.success) throw new ProjectError(parsed.error.issues[0]?.message ?? 'Invalid input')
    // 収支の概要は、案件詳細と同じ集計を、案件ごとにSQLを発行せずにまとめて取得する(詳細設計書4.28章手順3)
    const summaries = this.summaryRepository.summariesByProject()
    return this.repository.search(parsed.data).map((project) => {
      const summary = summaries.get(project.id)
      return {
        ...project,
        sales: summary?.sales ?? 0,
        expense: summary?.expense ?? 0,
        balance: summary?.balance ?? 0
      }
    })
  }

  getProject(id: number): ProjectDetail {
    const project = this.getOrThrow(id)
    const linkCount = this.repository.countLinks(id)
    return {
      ...project,
      quotes: this.repository.listLinkedDocuments('quotes', id),
      invoices: this.repository.listLinkedDocuments('invoices', id),
      records: this.repository.listLinkedRecords(id),
      history: this.repository.listHistoryOfProject(id),
      summary: this.summaryRepository.summary(id),
      deletable: linkCount === 0
    }
  }

  createProject(input: ProjectInput): { id: number } {
    const record = this.validate(input, null)
    return this.repository.insert(record)
  }

  updateProject(id: number, input: ProjectInput): { success: true } {
    const current = this.getOrThrow(id)
    this.repository.update(id, this.validate(input, current.clientId))
    return { success: true }
  }

  /** 紐づけが1件でもある場合は削除しない(取引先は紐づけに含めない。付け替え履歴は残る) */
  deleteProject(id: number): { success: true } {
    this.database.transaction(() => {
      this.getOrThrow(id)
      if (this.repository.countLinks(id) > 0) throw new ProjectError(PROJECT_MESSAGES.hasLinks)
      this.repository.delete(id)
    })
    return { success: true }
  }

  completeProject(id: number): { success: true } {
    const project = this.getOrThrow(id)
    if (project.status !== 'active') throw new ProjectError(PROJECT_MESSAGES.alreadyCompleted)
    this.repository.updateStatus(id, 'completed')
    return { success: true }
  }

  reopenProject(id: number): { success: true } {
    const project = this.getOrThrow(id)
    if (project.status !== 'completed') throw new ProjectError(PROJECT_MESSAGES.alreadyActive)
    this.repository.updateStatus(id, 'active')
    return { success: true }
  }

  listSelectable(includeId?: number): ProjectSelectable[] {
    return this.repository.listSelectable(includeId)
  }

  listHistory(targetType: ProjectLinkTargetType, targetId: number): ProjectLinkHistoryEntry[] {
    return this.repository.listHistoryOfTarget(targetType, targetId)
  }

  private getOrThrow(id: number): NonNullable<ReturnType<ProjectRepository['findById']>> {
    const project = this.repository.findById(id)
    if (!project) throw new ProjectError(PROJECT_MESSAGES.notFound)
    return project
  }

  /**
   * 入力を検証・正規化する。取引先は、存在し「利用中」であること
   * (編集で現在値と同じ取引先の場合は、利用停止でも許可する。詳細設計書4.27章手順2)。
   */
  private validate(input: ProjectInput, currentClientId: number | null): ProjectRecordInput {
    const parsed = ProjectInputSchema.safeParse(input)
    if (!parsed.success) throw new ProjectError(parsed.error.issues[0]?.message ?? 'Invalid input')
    const value = parsed.data
    if (value.clientId !== null && value.clientId !== currentClientId) {
      if (this.repository.findClientStatus(value.clientId) !== 'active') {
        throw new ProjectError(PROJECT_MESSAGES.clientNotSelectable)
      }
    }
    return {
      name: value.name,
      clientId: value.clientId,
      startDate: value.startDate === '' ? null : value.startDate,
      endDate: value.endDate === '' ? null : value.endDate,
      memo: value.memo === '' ? null : value.memo
    }
  }
}
