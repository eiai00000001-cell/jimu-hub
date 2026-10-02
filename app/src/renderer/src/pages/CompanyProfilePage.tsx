import { useEffect, useState, type ReactElement } from 'react'
import { AppShell } from '../layout/AppShell'
import { Button } from '../components/Button'
import { Message } from '../components/Message'
import { TextField, TextAreaField, SelectField } from '../components/FormField'
import {
  CompanyProfileInputSchema,
  type CompanyProfileInput
} from '@shared/schemas/company-profile.schema'
import { ACCOUNT_TYPES } from '@shared/types/company-profile'
import { COMPANY_MESSAGES } from '@shared/messages/messages'

const EMPTY_FORM: CompanyProfileInput = {
  name: '',
  address: '',
  invoiceRegistrationNumber: '',
  bankName: '',
  bankBranch: '',
  accountType: '',
  accountNumber: '',
  accountHolder: ''
}

const ACCOUNT_TYPE_OPTIONS = [
  { value: '', label: '(未選択)' },
  ...ACCOUNT_TYPES.map((type) => ({ value: type, label: type }))
]

type FieldErrors = Partial<Record<keyof CompanyProfileInput, string>>

interface CompanyProfilePageProps {
  onNavigateHome: () => void
  onNavigateClients: () => void
  onNavigateDocuments: () => void
  /**
   * 見積書・請求書作成画面からの遷移であった場合にApp.tsxから渡される、保存完了後のコールバック。
   * 指定されている場合、保存成功時は本画面上に留まらず遷移元へ戻る(詳細設計書4.10章手順6)。
   * 未指定(トップ画面からの通常遷移)の場合は、従来どおり本画面上に完了メッセージを表示する。
   */
  onSaved?: () => void
}

/**
 * 自社情報・振込先設定画面[F-10]
 * 参照元: 基本設計書4.9章、詳細設計書3.9章・4.10章、5章(クラス設計 `CompanyProfilePage`)
 */
export function CompanyProfilePage({
  onNavigateHome,
  onNavigateClients,
  onNavigateDocuments,
  onSaved
}: CompanyProfilePageProps): ReactElement {
  const [form, setForm] = useState<CompanyProfileInput>(EMPTY_FORM)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [saved, setSaved] = useState(false)
  const [comingSoonLabel, setComingSoonLabel] = useState<string | null>(null)

  useEffect(() => {
    window.jimuhubApi.getCompanyProfile().then((profile) => {
      if (profile) {
        setForm({
          name: profile.name,
          address: profile.address,
          invoiceRegistrationNumber: profile.invoiceRegistrationNumber ?? '',
          bankName: profile.bankName ?? '',
          bankBranch: profile.bankBranch ?? '',
          accountType: profile.accountType ?? '',
          accountNumber: profile.accountNumber ?? '',
          accountHolder: profile.accountHolder ?? ''
        })
      }
    })
  }, [])

  function updateField<K extends keyof CompanyProfileInput>(
    key: K,
    value: CompanyProfileInput[K]
  ): void {
    setForm((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  async function handleSubmit(): Promise<void> {
    const result = CompanyProfileInputSchema.safeParse(form)
    if (!result.success) {
      const nextErrors: FieldErrors = {}
      for (const issue of result.error.issues) {
        const key = issue.path[0] as keyof CompanyProfileInput
        if (!nextErrors[key]) {
          nextErrors[key] = issue.message
        }
      }
      setErrors(nextErrors)
      setSaved(false)
      return
    }

    setErrors({})
    setSubmitting(true)
    try {
      await window.jimuhubApi.saveCompanyProfile(result.data)
      if (onSaved) {
        onSaved()
      } else {
        setSaved(true)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AppShell
      screenName="自社情報・振込先の設定"
      activeMenu="home"
      pageTitle="自社情報・振込先の設定"
      onNavigateHome={onNavigateHome}
      onNavigateClients={onNavigateClients}
      onNavigateDocuments={onNavigateDocuments}
      onComingSoon={(label) => setComingSoonLabel(label)}
    >
      {saved ? <Message variant="success">{COMPANY_MESSAGES.saveSuccess}</Message> : null}
      {comingSoonLabel ? (
        <Message variant="warning">
          「{comingSoonLabel}」は以降のイテレーションで実装予定です。
        </Message>
      ) : null}

      <div className="section-block">
        <div className="section-heading">自社情報</div>
        <p className="section-desc">見積書・請求書の発行者情報として記載されます。</p>
        <div className="form-columns">
          <div>
            <TextField
              label="氏名・屋号"
              required
              placeholder="例: サンプル商店 山田太郎"
              value={form.name}
              error={errors.name}
              onChange={(e) => updateField('name', e.target.value)}
            />
            <TextAreaField
              label="住所"
              required
              rows={2}
              placeholder="例: 東京都千代田区千代田1-1-1"
              value={form.address}
              error={errors.address}
              onChange={(e) => updateField('address', e.target.value)}
            />
          </div>
          <div>
            <TextField
              label="インボイス登録番号"
              placeholder="例: T1234567890123"
              hint="「T」+ 数字13桁の形式を推奨します。未登録の場合は空欄のままにしてください(見積書・請求書の記載形式が自動で切り替わります)"
              value={form.invoiceRegistrationNumber}
              error={errors.invoiceRegistrationNumber}
              onChange={(e) => updateField('invoiceRegistrationNumber', e.target.value)}
            />
          </div>
        </div>

        <hr className="section-divider" />

        <div className="section-heading">振込先(任意)</div>
        <p className="section-desc">
          請求書にのみ記載されます。未入力の項目は請求書に表示されません。
        </p>
        <div className="form-columns">
          <div>
            <TextField
              label="振込先銀行名"
              placeholder="例: サンプル銀行"
              value={form.bankName}
              error={errors.bankName}
              onChange={(e) => updateField('bankName', e.target.value)}
            />
            <TextField
              label="振込先支店名"
              placeholder="例: 本店営業部"
              value={form.bankBranch}
              error={errors.bankBranch}
              onChange={(e) => updateField('bankBranch', e.target.value)}
            />
            <SelectField
              label="口座種別"
              options={ACCOUNT_TYPE_OPTIONS}
              value={form.accountType}
              onChange={(e) =>
                updateField('accountType', e.target.value as CompanyProfileInput['accountType'])
              }
            />
          </div>
          <div>
            <TextField
              label="口座番号"
              placeholder="例: 1234567"
              hint="半角数字のみを推奨します"
              value={form.accountNumber}
              error={errors.accountNumber}
              onChange={(e) => updateField('accountNumber', e.target.value)}
            />
            <TextField
              label="口座名義"
              placeholder="例: ヤマダ タロウ"
              value={form.accountHolder}
              error={errors.accountHolder}
              onChange={(e) => updateField('accountHolder', e.target.value)}
            />
          </div>
        </div>

        <div className="form-actions">
          <Button variant="primary" disabled={submitting} onClick={() => void handleSubmit()}>
            保存
          </Button>
        </div>
      </div>
    </AppShell>
  )
}
