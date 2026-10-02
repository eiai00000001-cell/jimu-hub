import { useState, type ReactElement } from 'react'
import { Button } from './Button'
import { TextField } from './FormField'
import { VALIDATION_MESSAGES } from '@shared/messages/messages'

interface QuickClientRegisterModalProps {
  onRegistered: (client: { id: number; name: string }) => void
  onCancel: () => void
}

/**
 * 取引先の簡易登録モーダル[F-11]。
 * 見積書・請求書作成画面(F-12・F-13)の「取引先を新規登録」リンクから開く。
 * 取引先名称のみを必須項目として登録し、他項目は空欄・既定値のまま登録する(4.11章手順2)。
 * 参照元: 詳細設計書 3.11章、4.11章、5章(クラス設計 `QuoteFormPage`から利用)
 */
export function QuickClientRegisterModal({
  onRegistered,
  onCancel
}: QuickClientRegisterModalProps): ReactElement {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(): Promise<void> {
    const trimmed = name.trim()
    if (trimmed === '') {
      setError(VALIDATION_MESSAGES.nameRequired)
      return
    }

    setError(undefined)
    setSubmitting(true)
    try {
      const result = await window.jimuhubApi.createClient({
        name: trimmed,
        furigana: '',
        honorific: '(なし)',
        contactPerson: '',
        postalCode: '',
        address: '',
        phone: '',
        email: '',
        invoiceRegistrationNumber: '',
        memo: ''
      })
      onRegistered({ id: result.id, name: trimmed })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="overlay">
      <div className="modal">
        <h2>取引先を簡易登録</h2>
        <TextField
          label="取引先名称"
          required
          placeholder="例: サンプル商事株式会社"
          value={name}
          error={error}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="modal-actions">
          <Button variant="secondary" onClick={onCancel}>
            キャンセル
          </Button>
          <Button variant="primary" disabled={submitting} onClick={() => void handleSubmit()}>
            登録
          </Button>
        </div>
      </div>
    </div>
  )
}
