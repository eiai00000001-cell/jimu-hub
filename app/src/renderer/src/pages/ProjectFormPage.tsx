import { useEffect, useState, type ReactElement } from 'react'
import { AppShell } from '../layout/AppShell'
import { Button, TextLink } from '../components/Button'
import { Message } from '../components/Message'
import { TextField, SelectField, TextAreaField } from '../components/FormField'
import { ProjectInputSchema, type ProjectInput } from '@shared/schemas/project.schema'
import { NAVIGATION_MESSAGES, PROJECT_MESSAGES } from '@shared/messages/messages'
import type { Client } from '@shared/types/client'
import { toErrorMessage } from '../utils/error-message'

const EMPTY_FORM: ProjectInput = { name: '', clientId: null, startDate: '', endDate: '', memo: '' }

type FieldErrors = Partial<Record<keyof ProjectInput, string>>

interface ProjectFormPageProps {
  mode: 'new' | 'edit'
  projectId?: number
  /** 登録・保存後に、案件詳細へ遷移する */
  onSaved: (id: number) => void
  onCancel: () => void
}

/**
 * 案件登録画面・案件編集画面[F-27]の共通フォーム。
 * 参照元: 詳細設計書3.23章・4.27章
 */
export function ProjectFormPage({
  mode,
  projectId,
  onSaved,
  onCancel
}: ProjectFormPageProps): ReactElement {
  const [form, setForm] = useState<ProjectInput>(EMPTY_FORM)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [clients, setClients] = useState<Client[]>([])
  /** 編集時の現在の取引先(利用停止でも選択肢に含める) */
  const [currentClient, setCurrentClient] = useState<{ id: number; name: string } | null>(null)

  useEffect(() => {
    window.jimuhubApi.listClients({ statusFilter: 'active' }).then(setClients)
  }, [])

  useEffect(() => {
    if (mode !== 'edit' || projectId === undefined) return
    window.jimuhubApi
      .getProject(projectId)
      .then((project) => {
        setForm({
          name: project.name,
          clientId: project.clientId,
          startDate: project.startDate ?? '',
          endDate: project.endDate ?? '',
          memo: project.memo ?? ''
        })
        if (project.clientId !== null) {
          setCurrentClient({ id: project.clientId, name: project.clientName ?? '' })
        }
      })
      .catch((error: unknown) => setLoadError(toErrorMessage(error, PROJECT_MESSAGES.notFound)))
  }, [mode, projectId])

  function updateField<K extends keyof ProjectInput>(key: K, value: ProjectInput[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(): Promise<void> {
    const result = ProjectInputSchema.safeParse(form)
    if (!result.success) {
      const nextErrors: FieldErrors = {}
      for (const issue of result.error.issues) {
        const key = issue.path[0] as keyof ProjectInput
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
        const created = await window.jimuhubApi.createProject(result.data)
        onSaved(created.id)
      } else if (projectId !== undefined) {
        await window.jimuhubApi.updateProject(projectId, result.data)
        onSaved(projectId)
      }
    } catch (error) {
      setSubmitError(toErrorMessage(error, PROJECT_MESSAGES.notFound))
    } finally {
      setSubmitting(false)
    }
  }

  const pageTitle = mode === 'new' ? '案件を登録' : '案件を編集'
  const clientOptions = [
    { value: '', label: '(未選択)' },
    ...clients.map((client) => ({ value: String(client.id), label: client.name })),
    ...(currentClient && !clients.some((client) => client.id === currentClient.id)
      ? [{ value: String(currentClient.id), label: `${currentClient.name}(利用停止)` }]
      : [])
  ]

  return (
    <AppShell
      screenName={pageTitle}
      activeMenu="projects"
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
        <div className="panel" style={{ maxWidth: 760 }}>
          {submitError ? <Message variant="error">{submitError}</Message> : null}
          <TextField
            label="案件名"
            required
            placeholder="例: 〇〇のWebサイト制作(100文字まで)"
            value={form.name}
            error={errors.name}
            onChange={(e) => updateField('name', e.target.value)}
          />
          <SelectField
            label="取引先"
            hint="利用中の取引先から選べます(任意)"
            options={clientOptions}
            value={form.clientId === null ? '' : String(form.clientId)}
            onChange={(e) =>
              updateField('clientId', e.target.value ? Number(e.target.value) : null)
            }
          />
          <div className="kv">
            <div className={`field${errors.startDate ? ' error' : ''}`}>
              <label>開始日</label>
              <input
                type="date"
                aria-label="開始日"
                value={form.startDate}
                onChange={(e) => updateField('startDate', e.target.value)}
              />
              {errors.startDate ? <div className="error-message">{errors.startDate}</div> : null}
            </div>
            <div className={`field${errors.endDate ? ' error' : ''}`}>
              <label>終了日</label>
              <input
                type="date"
                aria-label="終了日"
                value={form.endDate}
                onChange={(e) => updateField('endDate', e.target.value)}
              />
              {errors.endDate ? <div className="error-message">{errors.endDate}</div> : null}
            </div>
          </div>
          <TextAreaField
            label="メモ"
            rows={4}
            placeholder="1000文字まで"
            value={form.memo}
            error={errors.memo}
            onChange={(e) => updateField('memo', e.target.value)}
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
