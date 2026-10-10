import { useEffect, useState, type ReactElement } from 'react'
import { Button } from './Button'
import { Message } from './Message'
import { PROJECT_MESSAGES } from '@shared/messages/messages'
import type { ProjectLinkTargetType, ProjectRef, ProjectSelectable } from '@shared/types/project'
import { toErrorMessage } from '../utils/error-message'

interface ProjectChangeDialogProps {
  targetType: ProjectLinkTargetType
  targetId: number
  /** 対象の表示(見積書・請求書は種別と書類番号、入出金・経費は日付・種別・摘要) */
  targetLabel: string
  current: ProjectRef | null
  onClose: () => void
  /** 変更に成功した後(呼び出し元の画面を再読込する) */
  onChanged: () => void
}

/**
 * 案件の変更ダイアログ[F-30]。見積書・請求書・入出金・経費の案件を、紐づけ・付け替え・解除する。
 * 選択肢は「案件なし」と進行中の案件(現在の案件が完了の場合は、現在の案件を「{案件名}(完了)」として含める)。
 * 参照元: 詳細設計書3.25章・4.30章
 */
export function ProjectChangeDialog({
  targetType,
  targetId,
  targetLabel,
  current,
  onClose,
  onChanged
}: ProjectChangeDialogProps): ReactElement {
  const [selectable, setSelectable] = useState<ProjectSelectable[]>([])
  const [selected, setSelected] = useState(current ? String(current.id) : '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // 画面表示の都度、候補を取得する(案件を完了にした直後に、候補から外れる)
    window.jimuhubApi.listSelectableProjects(current?.id).then(setSelectable)
  }, [current?.id])

  const unchanged = selected === (current ? String(current.id) : '')

  async function handleSubmit(): Promise<void> {
    setSubmitting(true)
    setError(null)
    try {
      await window.jimuhubApi.changeProjectLink({
        targetType,
        targetId,
        projectId: selected === '' ? null : Number(selected)
      })
      onChanged()
    } catch (caught) {
      setError(toErrorMessage(caught, PROJECT_MESSAGES.linkHistoryWriteFailure))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="overlay">
      <div className="modal wide" role="dialog" aria-label="案件を変更">
        <h2>案件を変更</h2>
        <dl
          className="info-grid"
          style={{ gridTemplateColumns: '90px 1fr', rowGap: 8, margin: '0 0 14px' }}
        >
          <dt>対象</dt>
          <dd>{targetLabel}</dd>
          <dt>現在の案件</dt>
          <dd>{current ? current.name : '案件なし'}</dd>
        </dl>
        {error ? <Message variant="error">{error}</Message> : null}
        <div className="field">
          <label htmlFor="project-change-select">変更先の案件</label>
          <select
            id="project-change-select"
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value="">案件なし</option>
            {selectable.map((project) => (
              <option key={project.id} value={project.id}>
                {project.status === 'completed' ? `${project.name}(完了)` : project.name}
              </option>
            ))}
          </select>
        </div>
        <div className="modal-actions">
          <Button variant="secondary" disabled={submitting} onClick={onClose}>
            キャンセル
          </Button>
          <Button
            variant="primary"
            disabled={submitting || unchanged}
            onClick={() => void handleSubmit()}
          >
            変更する
          </Button>
        </div>
      </div>
    </div>
  )
}
