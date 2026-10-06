import { useEffect, useState, type ReactElement } from 'react'
import { Button } from './Button'
import { Message } from './Message'
import { BACKUP_MESSAGES } from '@shared/messages/messages'
import type { DataProgress } from '@shared/ipc/api'

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
  const [progress, setProgress] = useState<Pick<
    DataProgress,
    'stage' | 'current' | 'total'
  > | null>(null)

  // 進捗(`data:progress`)の購読。実行中のみ表示する
  useEffect(() => {
    return window.jimuhubApi.onDataProgress?.((p) => {
      if (p.phase === 'export') setProgress({ stage: p.stage, current: p.current, total: p.total })
    })
  }, [])

  async function handleExport(): Promise<void> {
    setSubmitting(true)
    try {
      let response = await window.jimuhubApi.exportData()
      // 見込みサイズが復元上限の80%を超える場合は、続行するかを確認する(基本設計書8.1章★E12)
      if (response.warnLargeBackup) {
        if (!window.confirm(BACKUP_MESSAGES.warnLargeBackup)) return
        response = await window.jimuhubApi.exportData({ confirmLarge: true })
      }
      if (response.success && response.filePath) {
        setResult({ success: true, message: BACKUP_MESSAGES.exportSuccess(response.filePath) })
      } else if (!response.success && response.error) {
        setResult({ success: false, message: response.error })
      }
      // success:false かつ error未設定 = OS標準ダイアログのキャンセル。何も表示しない
    } finally {
      setSubmitting(false)
      setProgress(null)
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
        {submitting && progress ? (
          <p role="status">
            {progress.stage === 'records'
              ? BACKUP_MESSAGES.exportRecords
              : progress.stage === 'packing'
                ? BACKUP_MESSAGES.exportPacking
                : BACKUP_MESSAGES.exportProgress(progress.current, progress.total)}
          </p>
        ) : null}
        {result ? (
          <Message variant={result.success ? 'success' : 'error'}>{result.message}</Message>
        ) : null}
      </div>
    </div>
  )
}
