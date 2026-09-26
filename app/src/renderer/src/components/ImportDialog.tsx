import { useState, type ReactElement } from 'react'
import { Button } from './Button'
import { Message } from './Message'
import { BACKUP_MESSAGES } from '@shared/messages/messages'

interface ImportDialogProps {
  onClose: () => void
  onImported: (count: number) => void
}

/**
 * データ復元(ダイアログ)[F-03]
 * 参照元: 詳細設計書3.7章・4.3章
 */
export function ImportDialog({ onClose, onImported }: ImportDialogProps): ReactElement {
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleImport(): Promise<void> {
    setSubmitting(true)
    try {
      const response = await window.jimuhubApi.importData()
      if (response.success && response.importedCount !== undefined) {
        setResult({
          success: true,
          message: BACKUP_MESSAGES.importSuccess(response.importedCount)
        })
        onImported(response.importedCount)
      } else if (!response.success && response.error) {
        setResult({ success: false, message: response.error })
      }
      // success:false かつ error未設定 = OS標準ダイアログのキャンセル。何も表示しない
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="overlay">
      <div className="modal">
        <button type="button" className="modal-close" aria-label="閉じる" onClick={onClose}>
          &times;
        </button>
        <h2>データを復元</h2>
        <Message variant="warning">{BACKUP_MESSAGES.importWarning}</Message>
        <div className="modal-actions">
          <Button variant="danger" disabled={submitting} onClick={() => void handleImport()}>
            ファイルを選択して復元
          </Button>
        </div>
        {result ? (
          <Message variant={result.success ? 'success' : 'error'}>{result.message}</Message>
        ) : null}
      </div>
    </div>
  )
}
