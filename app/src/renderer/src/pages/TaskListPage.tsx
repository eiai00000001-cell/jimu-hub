import { useEffect, useState, type ReactElement } from 'react'
import { AppShell } from '../layout/AppShell'
import { Button } from '../components/Button'
import { Badge } from '../components/Badge'
import { Message } from '../components/Message'
import { TaskDueDate } from '../components/TaskDueDate'
import { TASK_MESSAGES } from '@shared/messages/messages'
import { TaskListFilterSchema } from '@shared/schemas/task.schema'
import type { ProjectListItem } from '@shared/types/project'
import type { TaskListItem, TaskListResult } from '@shared/types/task'
import { toErrorMessage } from '../utils/error-message'

type StatusFilter = 'all' | 'open' | 'done'
type DueMode = 'any' | 'range' | 'overdue' | 'none'

interface TaskListPageProps {
  onNewTask: () => void
  onSelectTask: (id: number) => void
}

/**
 * タスク一覧画面[F-35・F-36・F-37]
 * 期限超過の判定は表示のたびにMainが行う(`overdue`)。件数は絞り込みにかかわらず全タスクが対象。
 * 参照元: 詳細設計書3.27章・4.35〜4.37章、モックアップ F-35_task-list
 */
export function TaskListPage({ onNewTask, onSelectTask }: TaskListPageProps): ReactElement {
  const [status, setStatus] = useState<StatusFilter>('open')
  /** '' = すべて、'none' = 案件なし、それ以外は案件ID */
  const [projectFilter, setProjectFilter] = useState('')
  const [dueMode, setDueMode] = useState<DueMode>('any')
  const [dueFrom, setDueFrom] = useState('')
  const [dueTo, setDueTo] = useState('')
  const [keyword, setKeyword] = useState('')
  const [projects, setProjects] = useState<ProjectListItem[]>([])
  const [result, setResult] = useState<TaskListResult | null>(null)
  const [reloadCount, setReloadCount] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // 絞り込みのため、完了の案件も含めたすべての案件を取得する
    window.jimuhubApi.listProjects({ status: 'all' }).then(setProjects)
  }, [])

  // 検索条件(入力内容の変化時に即時反映)。期間の範囲エラーがある間は、再取得せず直前の表示を維持する
  const filter = {
    status,
    ...(projectFilter === ''
      ? {}
      : { projectId: projectFilter === 'none' ? null : Number(projectFilter) }),
    dueMode,
    ...(dueMode === 'range' && dueFrom ? { dueFrom } : {}),
    ...(dueMode === 'range' && dueTo ? { dueTo } : {}),
    ...(keyword.trim() ? { keyword: keyword.trim() } : {})
  }
  const filterResult = TaskListFilterSchema.safeParse(filter)
  const rangeError = filterResult.success
    ? undefined
    : filterResult.error.issues.find((issue) => issue.path[0] === 'dueTo')?.message
  const filterKey = filterResult.success ? JSON.stringify(filter) : null

  useEffect(() => {
    if (filterKey === null) return
    let cancelled = false
    window.jimuhubApi
      .listTasks(JSON.parse(filterKey))
      .then((response) => {
        if (!cancelled) setResult(response)
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(toErrorMessage(caught, TASK_MESSAGES.notFound))
      })
    return () => {
      cancelled = true
    }
  }, [filterKey, reloadCount])

  async function run(action: () => Promise<unknown>): Promise<void> {
    try {
      await action()
      setError(null)
    } catch (caught) {
      setError(toErrorMessage(caught, TASK_MESSAGES.notFound))
    }
    setReloadCount((count) => count + 1)
  }

  function handleToggle(task: TaskListItem): Promise<void> {
    // 確認ダイアログなしで切り替える(F-35)
    return run(() =>
      task.status === 'open'
        ? window.jimuhubApi.completeTask(task.id)
        : window.jimuhubApi.reopenTask(task.id)
    )
  }

  async function handleDelete(task: TaskListItem): Promise<void> {
    if (!window.confirm(TASK_MESSAGES.confirmDelete)) return
    await run(() => window.jimuhubApi.deleteTask(task.id))
  }

  const overdueCount = result?.counts.overdue ?? 0

  return (
    <AppShell
      screenName="タスク一覧"
      activeMenu="tasks"
      pageTitle="タスク一覧"
      headerActions={
        <Button variant="primary" onClick={onNewTask}>
          + タスクを登録
        </Button>
      }
    >
      {error ? <Message variant="error">{error}</Message> : null}

      {result ? (
        <div className="task-counts">
          <div className="task-count">
            <div className="label">未完了</div>
            <div className="value">
              {result.counts.open}
              <small> 件</small>
            </div>
          </div>
          <div className={`task-count${overdueCount >= 1 ? ' alert' : ''}`}>
            <div className="label">
              {overdueCount >= 1 ? <span className="alert-icon">!</span> : null}期限超過
            </div>
            <div className="value">
              {overdueCount}
              <small> 件</small>
            </div>
          </div>
          <div
            style={{ alignSelf: 'flex-end', fontSize: 11, color: 'var(--color-text-secondary)' }}
          >
            件数は、下の絞り込みにかかわらず、全タスクを対象に数えています。
          </div>
        </div>
      ) : null}

      <div className="filter-bar">
        <div className="filter-field">
          <label htmlFor="task-status">状態</label>
          <select
            id="task-status"
            style={{ width: 110 }}
            value={status}
            onChange={(event) => setStatus(event.target.value as StatusFilter)}
          >
            <option value="all">すべて</option>
            <option value="open">未完了</option>
            <option value="done">完了</option>
          </select>
        </div>
        <div className="filter-field">
          <label htmlFor="task-project">案件</label>
          <select
            id="task-project"
            style={{ width: 220 }}
            value={projectFilter}
            onChange={(event) => setProjectFilter(event.target.value)}
          >
            <option value="">すべて</option>
            <option value="none">案件なし</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-field">
          <label htmlFor="task-due-mode">期限</label>
          <select
            id="task-due-mode"
            style={{ width: 140 }}
            value={dueMode}
            onChange={(event) => setDueMode(event.target.value as DueMode)}
          >
            <option value="any">すべて</option>
            <option value="range">期間指定</option>
            <option value="overdue">期限超過のみ</option>
            <option value="none">期限なしのみ</option>
          </select>
        </div>
        {dueMode === 'range' ? (
          <div className={`filter-field${rangeError ? ' error' : ''}`}>
            <label>期限の期間</label>
            <div className="filter-range">
              <input
                type="date"
                aria-label="期限の開始日"
                value={dueFrom}
                onChange={(event) => setDueFrom(event.target.value)}
              />
              <span>〜</span>
              <input
                type="date"
                aria-label="期限の終了日"
                value={dueTo}
                onChange={(event) => setDueTo(event.target.value)}
              />
            </div>
            {rangeError ? <div className="error-message">{rangeError}</div> : null}
          </div>
        ) : null}
        <div className="filter-field">
          <label htmlFor="task-keyword">タスク名</label>
          <input
            id="task-keyword"
            type="text"
            placeholder="キーワード"
            style={{ width: 180 }}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </div>
      </div>

      {result === null ? null : result.items.length === 0 ? (
        <div className="empty-state">{TASK_MESSAGES.emptyList}</div>
      ) : (
        <>
          <p className="result-count">該当 {result.items.length}件</p>
          <table className="table">
            <thead>
              <tr>
                <th>タスク名</th>
                <th>状態</th>
                <th>期限日</th>
                <th>案件</th>
                <th className="op">操作</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((task) => (
                <tr
                  key={task.id}
                  className={`clickable${task.overdue ? ' overdue' : ''}${task.status === 'done' ? ' done' : ''}`}
                  onClick={() => onSelectTask(task.id)}
                >
                  <td className="task-name">
                    <button className="link" style={{ fontSize: 13 }}>
                      {task.name}
                    </button>
                  </td>
                  <td>
                    <Badge variant={task.status === 'open' ? 'taskOpen' : 'taskDone'} />
                  </td>
                  <td>
                    <TaskDueDate dueDate={task.dueDate} overdue={task.overdue} />
                  </td>
                  <td>
                    {task.projectName ?? (
                      <span style={{ color: 'var(--color-text-secondary)' }}>案件なし</span>
                    )}
                  </td>
                  <td className="op">
                    <span className="op-group">
                      <Button
                        className="btn-sm"
                        onClick={(event) => {
                          event.stopPropagation()
                          void handleToggle(task)
                        }}
                      >
                        {task.status === 'open' ? '完了にする' : '未完了に戻す'}
                      </Button>
                      <Button
                        className="btn-sm"
                        onClick={(event) => {
                          event.stopPropagation()
                          void handleDelete(task)
                        }}
                      >
                        削除
                      </Button>
                    </span>
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
