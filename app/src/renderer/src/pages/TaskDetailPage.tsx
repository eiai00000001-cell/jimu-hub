import { useEffect, useState, type ReactElement } from 'react'
import { AppShell } from '../layout/AppShell'
import { Button, TextLink } from '../components/Button'
import { Badge } from '../components/Badge'
import { Message } from '../components/Message'
import { TaskDueDate } from '../components/TaskDueDate'
import { TASK_MESSAGES } from '@shared/messages/messages'
import type { TaskDetail } from '@shared/types/task'
import { toErrorMessage } from '../utils/error-message'
import { formatDateTime } from '../utils/project-format'

interface TaskDetailPageProps {
  taskId: number
  onBackToList: () => void
  onEdit: (id: number) => void
  onDeleted: () => void
  onOpenProject: (id: number) => void
}

/**
 * タスク詳細画面[F-34・F-35・F-36]。
 * 呼び出し側は`taskId`が変わるたびに`key={taskId}`を指定して再マウントさせること。
 * 参照元: 詳細設計書3.29章・4.35〜4.37章、モックアップ F-34_task-detail
 */
export function TaskDetailPage({
  taskId,
  onBackToList,
  onEdit,
  onDeleted,
  onOpenProject
}: TaskDetailPageProps): ReactElement {
  const [task, setTask] = useState<TaskDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.jimuhubApi
      .getTask(taskId)
      .then((result) => {
        if (!cancelled) setTask(result)
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(toErrorMessage(caught, TASK_MESSAGES.notFound))
      })
    return () => {
      cancelled = true
    }
  }, [taskId])

  async function reload(): Promise<void> {
    setTask(await window.jimuhubApi.getTask(taskId))
  }

  async function handleToggle(): Promise<void> {
    if (!task) return
    // 確認ダイアログなしで切り替える(F-35)
    try {
      if (task.status === 'open') await window.jimuhubApi.completeTask(taskId)
      else await window.jimuhubApi.reopenTask(taskId)
      setError(null)
      await reload()
    } catch (caught) {
      setError(toErrorMessage(caught, TASK_MESSAGES.notFound))
    }
  }

  async function handleDelete(): Promise<void> {
    if (!window.confirm(TASK_MESSAGES.confirmDelete)) return
    try {
      await window.jimuhubApi.deleteTask(taskId)
      onDeleted()
    } catch (caught) {
      setError(toErrorMessage(caught, TASK_MESSAGES.notFound))
    }
  }

  const blank = ' '

  return (
    <AppShell
      screenName="タスク詳細"
      activeMenu="tasks"
      pageTitle="タスク詳細"
      headerActions={
        task ? (
          <div className="header-actions">
            <Button onClick={() => onEdit(taskId)}>編集</Button>
            <Button onClick={() => void handleToggle()}>
              {task.status === 'open' ? '完了にする' : '未完了に戻す'}
            </Button>
            <Button onClick={() => void handleDelete()}>削除</Button>
          </div>
        ) : undefined
      }
    >
      {error ? <Message variant="error">{error}</Message> : null}

      {task ? (
        <>
          <div className="panel">
            <dl className="info-grid">
              <dt>タスク名</dt>
              <dd>{task.name}</dd>
              <dt>状態</dt>
              <dd>
                <Badge variant={task.status === 'open' ? 'taskOpen' : 'taskDone'} />
              </dd>
              <dt>期限日</dt>
              <dd>
                <TaskDueDate dueDate={task.dueDate} overdue={task.overdue} />
              </dd>
              <dt>案件</dt>
              <dd>
                {task.projectId !== null && task.projectName !== null ? (
                  <button
                    className="link"
                    style={{ fontSize: 13 }}
                    onClick={() => onOpenProject(task.projectId as number)}
                  >
                    {task.projectStatus === 'completed'
                      ? `${task.projectName}(完了)`
                      : task.projectName}
                  </button>
                ) : (
                  '案件なし'
                )}
              </dd>
              <dt>メモ</dt>
              <dd>{task.memo ?? blank}</dd>
              {task.status === 'done' && task.completedAt ? (
                <>
                  <dt>完了日時</dt>
                  <dd>{formatDateTime(task.completedAt)}</dd>
                </>
              ) : null}
              <dt>登録日時</dt>
              <dd>{formatDateTime(task.createdAt)}</dd>
              <dt>更新日時</dt>
              <dd>{formatDateTime(task.updatedAt)}</dd>
            </dl>
          </div>
        </>
      ) : null}

      <div className="back-link">
        <TextLink onClick={onBackToList}>&larr; 一覧へ戻る</TextLink>
      </div>
    </AppShell>
  )
}
