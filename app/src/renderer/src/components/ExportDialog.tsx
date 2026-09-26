import { useState, type ReactElement } from 'react'
import { Button } from './Button'
import { Message } from './Message'
import { BACKUP_MESSAGES } from '@shared/messages/messages'

interface ExportDialogProps {
  onClose: () => void
}

/**
 * データエクスポート(ダイアログ)[F-02]
 * 参照元: 詳細設計書3.6章・4.2章
 */
export function ExportDialog({ onClose }: ExportDialogProps): ReactElement {
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleExport(): Promise<void> {
    setSubmitting(true)
    try {
      const response = await window.jimuhubApi.exportData()
      if (response.success && response.filePath) {
        setResult({ success: true, message: BACKUP_MESSAGES.exportSuccess(response.filePath) })
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
        <h2>データをエクスポート</h2>
        <p>現在のデータを1つのファイルに書き出します。保存先はこの後の画面で選択できます。</p>
        <div className="modal-actions">
          <Button variant="primary" disabled={submitting} onClick={() => void handleExport()}>
            エクスポート実行
          </Button>
        </div>
        {result ? (
          <Message variant={result.success ? 'success' : 'error'}>{result.message}</Message>
        ) : null}
      </div>
    </div>
  )
}
