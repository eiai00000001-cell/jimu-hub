import { useEffect, useState, type ReactElement } from 'react'
import { AppShell } from '../layout/AppShell'
import { Button, TextLink } from '../components/Button'
import { Message } from '../components/Message'
import { TextField, TextAreaField } from '../components/FormField'
import { ProjectSelectField } from '../components/ProjectSelectField'
import { TaskInputSchema } from '@shared/schemas/task.schema'
import { NAVIGATION_MESSAGES, TASK_MESSAGES } from '@shared/messages/messages'
import type { ProjectRef } from '@shared/types/project'
import { toErrorMessage } from '../utils/error-message'

interface TaskForm {
  name: string
  memo: string
  dueDate: string
  projectId: number | null
}

const EMPTY_FORM: TaskForm = { name: '', memo: '', dueDate: '', projectId: null }

type FieldErrors = Partial<Record<keyof TaskForm, string>>

interface TaskFormPageProps {
  mode: 'new' | 'edit'
  taskId?: number
  /** 登録・保存後に、タスク詳細へ遷移する */
  onSaved: (id: number) => void
  /** キャンセル(新規は一覧、編集は詳細へ戻る)や、対象が存在しない場合の一覧へ戻る導線 */
  onCancel: () => void
}

/**
 * タスク登録画面・編集画面[F-34]の共通フォーム。
 * 参照元: 詳細設計書3.28章・4.34章、モックアップ F-34_task-form
 */
export function TaskFormPage({ mode, taskId, onSaved, onCancel }: TaskFormPageProps): ReactElement {
  const [form, setForm] = useState<TaskForm>(EMPTY_FORM)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  /** 編集時の現在の案件(完了の案件でも選択肢に含める) */
  const [currentProject, setCurrentProject] = useState<ProjectRef | null>(null)

  useEffect(() => {
    if (mode !== 'edit' || taskId === undefined) return
    window.jimuhubApi
      .getTask(taskId)
      .then((task) => {
        setForm({
          name: task.name,
          memo: task.memo ?? '',
          dueDate: task.dueDate ?? '',
          projectId: task.projectId
        })
        if (task.projectId !== null && task.projectName !== null && task.projectStatus !== null) {
          setCurrentProject({
            id: task.projectId,
            name: task.projectName,
            status: task.projectStatus
          })
        }
      })
      .catch((error: unknown) => setLoadError(toErrorMessage(error, TASK_MESSAGES.notFound)))
  }, [mode, taskId])

  function updateField<K extends keyof TaskForm>(key: K, value: TaskForm[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(): Promise<void> {
    const result = TaskInputSchema.safeParse(form)
    if (!result.success) {
      const nextErrors: FieldErrors = {}
      for (const issue of result.error.issues) {
        const key = issue.path[0] as keyof TaskForm
        if (!nextErrors[key]) nextErrors[key] = issue.message
      }
      setErrors(nextErrors)
      return
    }
    setErrors({})
    setSubmitError(null)
    setSubmitting(true)
    try {
      if (mode === 'new') {
        const created = await window.jimuhubApi.createTask(result.data)
        onSaved(created.id)
      } else if (taskId !== undefined) {
        await window.jimuhubApi.updateTask(taskId, result.data)
        onSaved(taskId)
      }
    } catch (error) {
      setSubmitError(toErrorMessage(error, TASK_MESSAGES.notFound))
    } finally {
      setSubmitting(false)
    }
  }

  const pageTitle = mode === 'new' ? 'タスクを登録' : 'タスクを編集'

  return (
    <AppShell
      screenName={pageTitle}
      activeMenu="tasks"
      pageTitle={pageTitle}
      confirmLeave={() => window.confirm(NAVIGATION_MESSAGES.confirmLeave)}
    >
      {loadError ? (
        <>
          <Message variant="error">{loadError}</Message>
          <div className="back-link">
            <TextLink onClick={onCancel}>&larr; 一覧へ戻る</TextLink>
          </div>
        </>
      ) : (
        <div className="panel form-panel">
          {submitError ? <Message variant="error">{submitError}</Message> : null}
          <TextField
            label="タスク名"
            required
            placeholder="例: 請求書の送付準備"
            hint="100文字以内。同じ名前のタスクも登録できます。"
            value={form.name}
            error={errors.name}
            onChange={(e) => updateField('name', e.target.value)}
          />
          <TextAreaField
            label="メモ"
            rows={4}
            hint="1000文字以内"
            value={form.memo}
            error={errors.memo}
            onChange={(e) => updateField('memo', e.target.value)}
          />
          <div className={`field${errors.dueDate ? ' error' : ''}`}>
            <label>期限日</label>
            <input
              type="date"
              aria-label="期限日"
              style={{ width: 200 }}
              value={form.dueDate}
              onChange={(e) => updateField('dueDate', e.target.value)}
            />
            {errors.dueDate ? (
              <div className="error-message">{errors.dueDate}</div>
            ) : (
              <div className="hint">任意。入力しない場合は、期限なしのタスクになります。</div>
            )}
          </div>
          <ProjectSelectField
            id="task-form-project"
            value={form.projectId}
            current={currentProject}
            hint="進行中の案件から選べます。"
            onChange={(projectId) => updateField('projectId', projectId)}
          />
          <div className="form-actions">
            <Button variant="primary" disabled={submitting} onClick={() => void handleSubmit()}>
              {mode === 'new' ? '登録' : '保存'}
            </Button>
            <Button variant="secondary" onClick={onCancel}>
              キャンセル
            </Button>
          </div>
        </div>
      )}
    </AppShell>
  )
}
