import { useEffect, useState, type ReactElement } from 'react'
import { AppShell } from '../layout/AppShell'
import { Button } from '../components/Button'
import { Badge } from '../components/Badge'
import { Message } from '../components/Message'
import { PROJECT_MESSAGES } from '@shared/messages/messages'
import { ProjectListFilterSchema } from '@shared/schemas/project.schema'
import type { Client } from '@shared/types/client'
import type { ProjectListItem, ProjectStatusFilter } from '@shared/types/project'
import { toErrorMessage } from '../utils/error-message'
import { formatProjectPeriod } from '../utils/project-format'

interface ProjectListPageProps {
  flashMessage?: string
  onNewProject: () => void
  onSelectProject: (id: number) => void
}

/**
 * 案件一覧画面[F-28]
 * 参照元: 詳細設計書3.22章・4.28章・4.29章
 */
export function ProjectListPage({
  flashMessage,
  onNewProject,
  onSelectProject
}: ProjectListPageProps): ReactElement {
  const [keyword, setKeyword] = useState('')
  const [clientId, setClientId] = useState('')
  const [status, setStatus] = useState<ProjectStatusFilter>('active')
  const [periodFrom, setPeriodFrom] = useState('')
  const [periodTo, setPeriodTo] = useState('')
  const [clients, setClients] = useState<Client[]>([])
  const [projects, setProjects] = useState<ProjectListItem[] | null>(null)
  const [reloadCount, setReloadCount] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.jimuhubApi.listClients({ statusFilter: 'all' }).then(setClients)
  }, [])

  // 検索条件(入力内容の変化時に即時反映)。期間の範囲エラーがある間は、再取得せず直前の表示を維持する
  const filterResult = ProjectListFilterSchema.safeParse({
    keyword: keyword.trim() || undefined,
    clientId: clientId ? Number(clientId) : undefined,
    status,
    periodFrom: periodFrom || undefined,
    periodTo: periodTo || undefined
  })
  const periodError = filterResult.success
    ? undefined
    : filterResult.error.issues.find((issue) => issue.path[0] === 'periodTo')?.message
  const filterKey = filterResult.success ? JSON.stringify(filterResult.data) : null

  useEffect(() => {
    if (filterKey === null) return
    let cancelled = false
    window.jimuhubApi
      .listProjects(JSON.parse(filterKey))
      .then((result) => {
        if (!cancelled) setProjects(result)
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(toErrorMessage(caught, PROJECT_MESSAGES.notFound))
      })
    return () => {
      cancelled = true
    }
  }, [filterKey, reloadCount])

  async function handleChangeStatus(item: ProjectListItem): Promise<void> {
    const completing = item.status === 'active'
    if (
      !window.confirm(
        completing ? PROJECT_MESSAGES.confirmComplete : PROJECT_MESSAGES.confirmReopen
      )
    )
      return
    try {
      if (completing) await window.jimuhubApi.completeProject(item.id)
      else await window.jimuhubApi.reopenProject(item.id)
      setError(null)
    } catch (caught) {
      setError(toErrorMessage(caught, PROJECT_MESSAGES.notFound))
    }
    setReloadCount((count) => count + 1)
  }

  return (
    <AppShell
      screenName="案件一覧"
      activeMenu="projects"
      pageTitle="案件管理"
      headerActions={
        <Button variant="primary" onClick={onNewProject}>
          + 案件を登録
        </Button>
      }
    >
      {flashMessage ? <Message variant="success">{flashMessage}</Message> : null}
      {error ? <Message variant="error">{error}</Message> : null}

      <div className="filter-bar">
        <div className="filter-field">
          <label htmlFor="project-keyword">案件名</label>
          <input
            id="project-keyword"
            type="text"
            placeholder="キーワード"
            style={{ width: 200 }}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </div>
        <div className="filter-field">
          <label htmlFor="project-client">取引先</label>
          <select
            id="project-client"
            style={{ width: 190 }}
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
          >
            <option value="">すべて</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-field">
          <label htmlFor="project-status">状態</label>
          <select
            id="project-status"
            value={status}
            onChange={(event) => setStatus(event.target.value as ProjectStatusFilter)}
          >
            <option value="all">すべて</option>
            <option value="active">進行中</option>
            <option value="completed">完了</option>
          </select>
        </div>
        <div className={`filter-field${periodError ? ' error' : ''}`}>
          <label>期間</label>
          <div className="filter-range">
            <input
              type="date"
              aria-label="期間の開始日"
              value={periodFrom}
              onChange={(event) => setPeriodFrom(event.target.value)}
            />
            <span>〜</span>
            <input
              type="date"
              aria-label="期間の終了日"
              value={periodTo}
              onChange={(event) => setPeriodTo(event.target.value)}
            />
          </div>
          {periodError ? <div className="error-message">{periodError}</div> : null}
        </div>
      </div>

      {projects === null ? null : projects.length === 0 ? (
        <div className="empty-state">{PROJECT_MESSAGES.empty}</div>
      ) : (
        <>
          <p className="table-note">{projects.length}件</p>
          <table className="table">
            <thead>
              <tr>
                <th>案件名</th>
                <th>取引先</th>
                <th>状態</th>
                <th>期間</th>
                <th className="op">操作</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr
                  key={project.id}
                  className={`clickable${project.status === 'completed' ? ' cancelled' : ''}`}
                  onClick={() => onSelectProject(project.id)}
                >
                  <td>{project.name}</td>
                  <td>{project.clientName ?? ''}</td>
                  <td>
                    <Badge
                      variant={project.status === 'active' ? 'projectActive' : 'projectCompleted'}
                    />
                  </td>
                  <td>{formatProjectPeriod(project.startDate, project.endDate)}</td>
                  <td className="op">
                    <Button
                      className="btn-sm"
                      onClick={(event) => {
                        event.stopPropagation()
                        void handleChangeStatus(project)
                      }}
                    >
                      {project.status === 'active' ? '完了' : '再開'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </AppShell>
  )
}
