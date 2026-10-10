import { useEffect, useState, type ReactElement } from 'react'
import { Button, TextLink } from './Button'
import { ProjectChangeDialog } from './ProjectChangeDialog'
import type {
  ProjectLinkHistoryEntry,
  ProjectLinkTargetType,
  ProjectRef
} from '@shared/types/project'
import { formatDateTime, formatHistoryKind, formatHistoryProject } from '../utils/project-format'

interface ProjectLinkPanelProps {
  targetType: ProjectLinkTargetType
  targetId: number
  targetLabel: string
  project: ProjectRef | null
  /** 「案件を変更」を表示するか(削除済みの記録の詳細〔読み取り専用〕ではfalse) */
  canChange: boolean
  onOpenProject?: (id: number) => void
  /** 変更後に、呼び出し元の画面を再読込する */
  onChanged: () => void
}

/**
 * 見積書・請求書・入出金・経費の詳細画面に表示する、案件の欄。
 * 紐づく案件(案件詳細へのリンク)、「案件を変更」ボタン、この対象の付け替え履歴(なければ欄を表示しない)。
 * 参照元: 詳細設計書3.26章
 */
export function ProjectLinkPanel({
  targetType,
  targetId,
  targetLabel,
  project,
  canChange,
  onOpenProject,
  onChanged
}: ProjectLinkPanelProps): ReactElement {
  const [history, setHistory] = useState<ProjectLinkHistoryEntry[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.jimuhubApi.listProjectLinkHistory(targetType, targetId).then((result) => {
      if (!cancelled) setHistory(result)
    })
    return () => {
      cancelled = true
    }
  }, [targetType, targetId, project?.id])

  return (
    <>
      <div className="section-title">案件</div>
      <div className="panel">
        <dl className="info-grid">
          <dt>案件</dt>
          <dd>
            {project ? (
              onOpenProject ? (
                <TextLink onClick={() => onOpenProject(project.id)}>{project.name}</TextLink>
              ) : (
                project.name
              )
            ) : (
              '案件なし'
            )}
            {project?.status === 'completed' ? '(完了)' : ''}{' '}
            {canChange ? (
              <Button className="btn-sm" onClick={() => setDialogOpen(true)}>
                案件を変更
              </Button>
            ) : null}
          </dd>
        </dl>
      </div>
      {history.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th>日時</th>
              <th>付け替え前の案件</th>
              <th>付け替え後の案件</th>
              <th>操作の種類</th>
            </tr>
          </thead>
          <tbody>
            {history.map((entry) => (
              <tr key={entry.id}>
                <td>{formatDateTime(entry.operatedAt)}</td>
                <td>{formatHistoryProject(entry.fromProjectName)}</td>
                <td>{formatHistoryProject(entry.toProjectName)}</td>
                <td>
                  <span className="badge badge-op-minor">{formatHistoryKind(entry.kind)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {dialogOpen ? (
        <ProjectChangeDialog
          targetType={targetType}
          targetId={targetId}
          targetLabel={targetLabel}
          current={project}
          onClose={() => setDialogOpen(false)}
          onChanged={() => {
            setDialogOpen(false)
            onChanged()
          }}
        />
      ) : null}
    </>
  )
}
