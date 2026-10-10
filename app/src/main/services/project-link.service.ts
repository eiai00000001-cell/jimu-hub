import { PROJECT_MESSAGES } from '@shared/messages/messages'
import type { ProjectLinkKind, ProjectLinkTargetType } from '@shared/types/project'
import type { Database } from '../db/db'
import type { ProjectRepository } from '../repositories/project.repository'
import { ProjectError } from './project.service'

/**
 * 見積書・請求書・入出金・経費と案件の、紐づけ・付け替え・解除をすべて担うApplication Service層。
 * 画面からの操作も、作成・保存時の紐づけも、削除に伴う解除も、このクラスに集約する(詳細設計書4.30章、2.4章★F4・★F5)。
 *
 * 紐づけは書類・記録の本体とは別に管理し、`updated_at`・`pdf_hash`・`record_hash`・`pdf_hash_mismatch`は更新しない
 * (記録の履歴`cash_record_history`にも追加しない)。付け替えのたびに、`project_link_history`へ1行追記する。
 * 参照元: 詳細設計書4.30章、5章(`ProjectLinkService`)
 */
export class ProjectLinkService {
  constructor(
    private readonly database: Database,
    private readonly repository: ProjectRepository
  ) {}

  /**
   * 紐づけ・付け替え・解除を行い、履歴を記録する(1つのトランザクション。呼び出し元がトランザクション内の場合は、その中で実行する)。
   * 履歴の記録に失敗した場合は、紐づけの更新も含めてロールバックする。
   * @param kind 指定できるのは、対象の削除に伴う解除(`'auto_release'`)のみ。それ以外は自動で判定する
   */
  changeLink(
    targetType: ProjectLinkTargetType,
    targetId: number,
    newProjectId: number | null,
    kind?: 'auto_release'
  ): { changed: boolean } {
    return this.database.transaction(() => {
      const target = this.repository.findLinkTarget(targetType, targetId)
      if (!target) throw new ProjectError(PROJECT_MESSAGES.targetNotFound)
      if (target.deleted && kind !== 'auto_release') {
        throw new ProjectError(PROJECT_MESSAGES.targetDeleted)
      }
      if (target.projectId === newProjectId) return { changed: false }

      let toName: string | null = null
      if (newProjectId !== null) {
        const next = this.repository.findById(newProjectId)
        if (!next) throw new ProjectError(PROJECT_MESSAGES.notFound)
        // 完了の案件へは新しく紐づけられない(現在の案件が完了でも、別の案件・案件なしへは付け替えられる)
        if (next.status !== 'active') throw new ProjectError(PROJECT_MESSAGES.projectNotSelectable)
        toName = next.name
      }
      const fromName =
        target.projectId === null
          ? null
          : (this.repository.findById(target.projectId)?.name ?? null)

      this.repository.setProjectId(targetType, targetId, newProjectId)
      try {
        this.repository.insertHistory({
          targetType,
          targetId,
          targetLabel: target.label,
          fromProjectId: target.projectId,
          fromProjectName: fromName,
          toProjectId: newProjectId,
          toProjectName: toName,
          kind: kind ?? this.decideKind(target.projectId, newProjectId)
        })
      } catch {
        throw new ProjectError(PROJECT_MESSAGES.linkHistoryWriteFailure)
      }
      return { changed: true }
    })
  }

  private decideKind(from: number | null, to: number | null): ProjectLinkKind {
    if (to === null) return 'unassign'
    return from === null ? 'assign' : 'change'
  }
}
