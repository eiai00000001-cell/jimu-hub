import { useEffect, useState, type ReactElement } from 'react'
import { AppShell } from '../layout/AppShell'
import { Button, TextLink } from '../components/Button'
import { Message } from '../components/Message'
import { TextField, SelectField, TextAreaField } from '../components/FormField'
import { ClientInputSchema, type ClientInput } from '@shared/schemas/client.schema'
import { HONORIFICS } from '@shared/types/client'
import { CLIENT_MESSAGES } from '@shared/messages/messages'
import { convertHiraganaToKatakana } from '@shared/text/furigana'

const EMPTY_FORM: ClientInput = {
  name: '',
  furigana: '',
  honorific: '(なし)',
  contactPerson: '',
  postalCode: '',
  address: '',
  phone: '',
  email: '',
  invoiceRegistrationNumber: '',
  memo: ''
}

type FieldErrors = Partial<Record<keyof ClientInput, string>>

interface ClientFormPageProps {
  mode: 'new' | 'edit'
  clientId?: number
  onCreated: (id: number) => void
  onUpdated: (id: number) => void
  onCancel: () => void
}

/**
 * 取引先登録画面[F-04]・取引先編集画面[F-07]の共通フォーム。
 * 参照元: 詳細設計書3.3章・3.5章・4.4章・4.7章、5章(クラス設計 `ClientFormPage`)
 */
export function ClientFormPage({
  mode,
  clientId,
  onCreated,
  onUpdated,
  onCancel
}: ClientFormPageProps): ReactElement {
  const [form, setForm] = useState<ClientInput>(EMPTY_FORM)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (mode === 'edit' && clientId !== undefined) {
      window.jimuhubApi
        .getClient(clientId)
        .then((client) => {
          setForm({
            name: client.name,
            furigana: client.furigana ?? '',
            honorific: client.honorific,
            contactPerson: client.contactPerson ?? '',
            postalCode: client.postalCode ?? '',
            address: client.address ?? '',
            phone: client.phone ?? '',
            email: client.email ?? '',
            invoiceRegistrationNumber: client.invoiceRegistrationNumber ?? '',
            memo: client.memo ?? ''
          })
        })
        .catch((error: unknown) => {
          setLoadError(error instanceof Error ? error.message : CLIENT_MESSAGES.notFound)
        })
    }
  }, [mode, clientId])

  function updateField<K extends keyof ClientInput>(key: K, value: ClientInput[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(): Promise<void> {
    const result = ClientInputSchema.safeParse(form)
    if (!result.success) {
      const nextErrors: FieldErrors = {}
      for (const issue of result.error.issues) {
        const key = issue.path[0] as keyof ClientInput
        if (!nextErrors[key]) {
          nextErrors[key] = issue.message
        }
      }
      setErrors(nextErrors)
      return
    }

    setErrors({})
    setSubmitting(true)
    try {
      if (mode === 'new') {
        const created = await window.jimuhubApi.createClient(result.data)
        onCreated(created.id)
      } else if (clientId !== undefined) {
        await window.jimuhubApi.updateClient(clientId, result.data)
        onUpdated(clientId)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const pageTitle = mode === 'new' ? '取引先を登録' : '取引先を編集'
  const submitLabel = mode === 'new' ? '登録' : '保存'

  return (
    <AppShell
      screenName={pageTitle}
      activeMenu="clients"
      pageTitle={pageTitle}
      onNavigateHome={() => {}}
      onNavigateClients={() => {}}
      onComingSoon={() => {}}
    >
      {loadError ? (
        <>
          <Message variant="error">{loadError}</Message>
          <div className="back-link">
            <TextLink onClick={onCancel}>&larr; 一覧へ戻る</TextLink>
          </div>
        </>
      ) : (
        <>
          <div className="form-columns">
            <div>
              <TextField
                label="取引先名称"
                required
                placeholder="例: サンプル商事株式会社"
                value={form.name}
                error={errors.name}
                onChange={(e) => updateField('name', e.target.value)}
              />
              <TextField
                label="フリガナ"
                placeholder="例: サンプルショウジカブシキガイシャ"
                hint="一覧の五十音順表示に使用します(未入力可。全角カタカナで入力してください。ひらがなは自動的に変換されます)"
                value={form.furigana}
                error={errors.furigana}
                onChange={(e) => updateField('furigana', convertHiraganaToKatakana(e.target.value))}
              />
              <SelectField
                label="敬称"
                options={HONORIFICS}
                value={form.honorific}
                onChange={(e) =>
                  updateField('honorific', e.target.value as ClientInput['honorific'])
                }
              />
              <TextField
                label="担当者名"
                placeholder="例: サンプル 太郎"
                value={form.contactPerson}
                error={errors.contactPerson}
                onChange={(e) => updateField('contactPerson', e.target.value)}
              />
              <TextField
                label="郵便番号"
                placeholder="例: 100-0001"
                value={form.postalCode}
                error={errors.postalCode}
                onChange={(e) => updateField('postalCode', e.target.value)}
              />
              <TextAreaField
                label="住所"
                rows={2}
                placeholder="例: 東京都千代田区千代田1-1-1"
                value={form.address}
                error={errors.address}
                onChange={(e) => updateField('address', e.target.value)}
              />
            </div>
            <div>
              <TextField
                label="電話番号"
                placeholder="例: 03-1234-5678"
                value={form.phone}
                error={errors.phone}
                onChange={(e) => updateField('phone', e.target.value)}
              />
              <TextField
                label="メールアドレス"
                placeholder="例: contact@example.com"
                value={form.email}
                error={errors.email}
                onChange={(e) => updateField('email', e.target.value)}
              />
              <TextField
                label="インボイス登録番号"
                placeholder="例: T1234567890123"
                hint="「T」+ 数字13桁の形式を推奨します(未登録の場合は空欄で構いません)"
                value={form.invoiceRegistrationNumber}
                error={errors.invoiceRegistrationNumber}
                onChange={(e) => updateField('invoiceRegistrationNumber', e.target.value)}
              />
              <TextAreaField
                label="メモ"
                rows={4}
                placeholder="補足事項があれば入力してください"
                value={form.memo}
                error={errors.memo}
                onChange={(e) => updateField('memo', e.target.value)}
              />
            </div>
          </div>

          <div className="form-actions">
            <Button variant="primary" disabled={submitting} onClick={() => void handleSubmit()}>
              {submitLabel}
            </Button>
            <Button variant="secondary" onClick={onCancel}>
              キャンセル
            </Button>
          </div>
        </>
      )}
    </AppShell>
  )
}
