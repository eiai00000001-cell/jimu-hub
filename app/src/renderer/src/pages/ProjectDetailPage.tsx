import { useEffect, useState, type ReactElement } from 'react'
import { AppShell } from '../layout/AppShell'
import { Button, TextLink } from '../components/Button'
import { Badge } from '../components/Badge'
import { Message } from '../components/Message'
import { ProjectChangeDialog } from '../components/ProjectChangeDialog'
import { PROJECT_MESSAGES } from '@shared/messages/messages'
import type { ProjectDetail, ProjectLinkTargetType, ProjectRef } from '@shared/types/project'
import { toErrorMessage } from '../utils/error-message'
import {
  formatDateTime,
  formatHistoryKind,
  formatHistoryProject,
  formatHistoryTarget,
  formatProjectPeriod,
  formatYen
} from '../utils/project-format'

/** この画面の案件は、紐づく対象の現在の案件である(案件の詳細画面に表示している行は、すべてこの案件に紐づいている) */
function toRef(project: ProjectDetail): ProjectRef {
  return { id: project.id, name: project.name, status: project.status }
}

interface ProjectDetailPageProps {
  projectId: number
  flashMessage?: string
  onBackToList: () => void
  onEdit: (id: number) => void
  onDeleted: () => void
  onOpenQuote: (id: number) => void
  onOpenInvoice: (id: number) => void
  onOpenRecord: (id: number) => void
}

/**
 * 案件詳細画面[F-27・F-29・F-30]。
 * 呼び出し側は`projectId`が変わるたびに`key={projectId}`を指定して再マウントさせること。
 * 参照元: 詳細設計書3.24章・4.27章・4.29章
 */
export function ProjectDetailPage({
  projectId,
  flashMessage,
  onBackToList,
  onEdit,
  onDeleted,
  onOpenQuote,
  onOpenInvoice,
  onOpenRecord
}: ProjectDetailPageProps): ReactElement {
  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [changing, setChanging] = useState<{
    targetType: ProjectLinkTargetType
    targetId: number
    targetLabel: string
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    window.jimuhubApi
      .getProject(projectId)
      .then((result) => {
        if (!cancelled) setProject(result)
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setLoadFailed(true)
          setError(toErrorMessage(caught, PROJECT_MESSAGES.notFound))
        }
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  async function reload(): Promise<void> {
    setProject(await window.jimuhubApi.getProject(projectId))
  }

  async function handleStatusChange(): Promise<void> {
    if (!project) return
    const completing = project.status === 'active'
    if (
      !window.confirm(
        completing ? PROJECT_MESSAGES.confirmComplete : PROJECT_MESSAGES.confirmReopen
      )
    )
      return
    try {
      if (completing) await window.jimuhubApi.completeProject(projectId)
      else await window.jimuhubApi.reopenProject(projectId)
      setError(null)
      await reload()
    } catch (caught) {
      setError(toErrorMessage(caught, PROJECT_MESSAGES.notFound))
    }
  }

  async function handleDelete(): Promise<void> {
    if (!window.confirm(PROJECT_MESSAGES.confirmDelete)) return
    try {
      await window.jimuhubApi.deleteProject(projectId)
      onDeleted()
    } catch (caught) {
      setError(toErrorMessage(caught, PROJECT_MESSAGES.notFound))
    }
  }

  return (
    <AppShell
      screenName="案件詳細"
      activeMenu="projects"
      pageTitle="案件詳細"
      headerActions={
        project ? (
          <>
            <Button onClick={() => onEdit(projectId)}>編集</Button>
            <Button onClick={() => void handleStatusChange()}>
              {project.status === 'active' ? '完了' : '再開'}
            </Button>
            {project.deletable ? <Button onClick={() => void handleDelete()}>削除</Button> : null}
          </>
        ) : null
      }
    >
      {flashMessage ? <Message variant="success">{flashMessage}</Message> : null}
      {error ? <Message variant="error">{error}</Message> : null}
      {loadFailed ? (
        <div className="back-link">
          <TextLink onClick={onBackToList}>&larr; 一覧へ戻る</TextLink>
        </div>
      ) : null}

      {project ? (
        <>
          <div className="panel">
            <dl className="info-grid">
              <dt>案件名</dt>
              <dd>{project.name}</dd>
              <dt>取引先</dt>
              <dd>{project.clientName ?? ''}</dd>
              <dt>状態</dt>
              <dd>
                <Badge
                  variant={project.status === 'active' ? 'projectActive' : 'projectCompleted'}
                />
              </dd>
              <dt>期間</dt>
              <dd>{formatProjectPeriod(project.startDate, project.endDate)}</dd>
              <dt>メモ</dt>
              <dd>{project.memo ?? ''}</dd>
            </dl>
          </div>

          <div className="section-title">案件別収支</div>
          <div className="summary-cards">
            <div className="summary-card">
              <div className="label">売上</div>
              <div className="value">{formatYen(project.summary.sales)}</div>
              {project.summary.withholding > 0 ? (
                <div className="sub-total">
                  うち源泉徴収額 {formatYen(project.summary.withholding)}
                </div>
              ) : null}
            </div>
            <div className="summary-card">
              <div className="label">経費</div>
              <div className="value">{formatYen(project.summary.expense)}</div>
            </div>
            <div className="summary-card">
              <div className="label">差引(売上−経費)</div>
              <div className="value">{formatYen(project.summary.balance)}</div>
            </div>
          </div>
          <p className="note-text" style={{ margin: '-8px 0 0' }}>
            {PROJECT_MESSAGES.salesNote}
          </p>

          <div className="section-title">件数の内訳</div>
          <div className="count-grid">
            <div className="count-item">
              <div className="label">見積書</div>
              <div className="value">
                {project.summary.counts.quotes}
                <small> 件</small>
              </div>
            </div>
            <div className="count-item">
              <div className="label">請求書</div>
              <div className="value">
                {project.summary.counts.invoicesIssued + project.summary.counts.invoicesDraft}
                <small>
                  {' '}
                  件(発行済み {project.summary.counts.invoicesIssued} / 下書き{' '}
                  {project.summary.counts.invoicesDraft})
                </small>
              </div>
            </div>
            <div className="count-item">
              <div className="label">入金(取消済を含む)</div>
              <div className="value">
                {project.summary.counts.incomes}
                <small> 件</small>
              </div>
            </div>
            <div className="count-item">
              <div className="label">経費</div>
              <div className="value">
                {project.summary.counts.expenses}
                <small> 件</small>
              </div>
            </div>
          </div>

          <div className="section-title">紐づく見積書・請求書</div>
          {project.quotes.length + project.invoices.length === 0 ? (
            <div className="empty-state">紐づく見積書・請求書はありません</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>書類番号</th>
                  <th>種別</th>
                  <th>発行日</th>
                  <th>取引先</th>
                  <th className="num">合計金額</th>
                  <th>状態</th>
                  <th className="op">操作</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ...project.invoices.map((d) => ({ ...d, type: 'invoice' as const })),
                  ...project.quotes.map((d) => ({ ...d, type: 'quote' as const }))
                ]
                  .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.id - a.id)
                  .map((doc) => (
                    <tr key={`${doc.type}-${doc.id}`}>
                      <td>
                        <button
                          className="link"
                          style={{ fontSize: 13 }}
                          onClick={() =>
                            doc.type === 'quote' ? onOpenQuote(doc.id) : onOpenInvoice(doc.id)
                          }
                        >
                          {doc.documentNumber ?? '下書き'}
                        </button>
                      </td>
                      <td>{doc.type === 'quote' ? '見積書' : '請求書'}</td>
                      <td>{doc.issueDate}</td>
                      <td>{doc.clientName}</td>
                      <td className="num">{formatYen(doc.totalAmount)}</td>
                      <td>
                        <Badge variant={doc.status === 'draft' ? 'draft' : 'finalized'} />
                      </td>
                      <td className="op">
                        <Button
                          className="btn-sm"
                          onClick={() =>
                            setChanging({
                              targetType: doc.type,
                              targetId: doc.id,
                              targetLabel: `${doc.type === 'quote' ? '見積書' : '請求書'} ${doc.documentNumber ?? '下書き'}`
                            })
                          }
                        >
                          案件を変更
                        </Button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}

          <div className="section-title">紐づく入出金・経費</div>
          {project.records.length === 0 ? (
            <div className="empty-state">紐づく入出金・経費はありません</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>日付</th>
                  <th>種別</th>
                  <th>摘要・メモ</th>
                  <th className="num">金額</th>
                  <th>状態</th>
                  <th className="op">操作</th>
                </tr>
              </thead>
              <tbody>
                {project.records.map((record) => (
                  <tr
                    key={record.id}
                    className={`clickable${record.status === 'cancelled' ? ' cancelled' : ''}`}
                    onClick={() => onOpenRecord(record.id)}
                  >
                    <td>{record.recordDate}</td>
                    <td>
                      <span
                        className={`badge badge-${record.kind === 'income' ? 'income' : 'expense'}`}
                      >
                        {record.kind === 'income' ? '入金' : '経費'}
                      </span>
                    </td>
                    <td>{record.description}</td>
                    <td className="num">
                      <span className="sign">
                        {record.kind === 'income' ? '+' : '−'}
                        {formatYen(record.amount)}
                      </span>
                    </td>
                    <td>
                      {record.status === 'cancelled' ? (
                        <span className="badge badge-cancelled">取消済</span>
                      ) : (
                        <span className="badge badge-active">有効</span>
                      )}
                    </td>
                    <td className="op">
                      <Button
                        className="btn-sm"
                        onClick={(event) => {
                          event.stopPropagation()
                          setChanging({
                            targetType: 'cash_record',
                            targetId: record.id,
                            targetLabel: `${record.recordDate} ${record.kind === 'income' ? '入金' : '経費'} ${record.description}`
                          })
                        }}
                      >
                        案件を変更
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="section-title">付け替え履歴</div>
          {project.history.length === 0 ? (
            <div className="empty-state">付け替え履歴はありません</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>日時</th>
                  <th>対象</th>
                  <th>付け替え前の案件</th>
                  <th>付け替え後の案件</th>
                  <th>操作の種類</th>
                </tr>
              </thead>
              <tbody>
                {project.history.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatDateTime(entry.operatedAt)}</td>
                    <td>{formatHistoryTarget(entry)}</td>
                    <td>{formatHistoryProject(entry.fromProjectName)}</td>
                    <td>{formatHistoryProject(entry.toProjectName)}</td>
                    <td>
                      <span className="badge badge-op-minor">{formatHistoryKind(entry.kind)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="back-link">
            <TextLink onClick={onBackToList}>&larr; 一覧へ戻る</TextLink>
          </div>
        </>
      ) : null}

      {changing && project ? (
        <ProjectChangeDialog
          targetType={changing.targetType}
          targetId={changing.targetId}
          targetLabel={changing.targetLabel}
          current={toRef(project)}
          onClose={() => setChanging(null)}
          onChanged={() => {
            setChanging(null)
            void reload()
          }}
        />
      ) : null}
    </AppShell>
  )
}
