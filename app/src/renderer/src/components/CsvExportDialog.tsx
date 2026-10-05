import { useState, type ReactElement } from 'react'
import { Button } from './Button'
import { Message } from './Message'
import { CsvExportInputSchema } from '@shared/schemas/csv-export.schema'
import { CSV_MESSAGES } from '@shared/messages/messages'
import { todayIso } from '../utils/format'

interface CsvExportDialogProps {
  onClose: () => void
}

type Status = { kind: 'success' | 'error'; message: string } | null

/**
 * CSV出力ダイアログ[F-24]。開始年月・終了年月を指定して、入出金・経費を1つのCSVへ出力する。
 * 参照元: 詳細設計書3.20章・4.24章
 */
export function CsvExportDialog({ onClose }: CsvExportDialogProps): ReactElement {
  const year = todayIso().slice(0, 4)
  const [fromMonth, setFromMonth] = useState(`${year}-01`)
  const [toMonth, setToMonth] = useState(`${year}-12`)
  const [fieldErrors, setFieldErrors] = useState<{ fromMonth?: string; toMonth?: string }>({})
  const [status, setStatus] = useState<Status>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleExport(): Promise<void> {
    setStatus(null)
    const parsed = CsvExportInputSchema.safeParse({ fromMonth, toMonth })
    if (!parsed.success) {
      const errors: { fromMonth?: string; toMonth?: string } = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as 'fromMonth' | 'toMonth'
        if (!errors[key]) errors[key] = issue.message
      }
      setFieldErrors(errors)
      return
    }
    setFieldErrors({})
    setSubmitting(true)
    try {
      const result = await window.jimuhubApi.exportCsv(parsed.data)
      if (result.success) {
        setStatus({ kind: 'success', message: CSV_MESSAGES.success(result.filePath, result.count) })
      } else if (result.reason === 'empty') {
        setStatus({ kind: 'error', message: CSV_MESSAGES.empty })
      } else if (result.reason === 'error') {
        setStatus({ kind: 'error', message: result.error ?? CSV_MESSAGES.writeFailure })
      }
      // canceled(保存ダイアログのキャンセル)は何も表示しない
    } catch {
      setStatus({ kind: 'error', message: CSV_MESSAGES.writeFailure })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="overlay">
      <div className="modal" role="dialog" aria-label="CSV出力" style={{ width: 480 }}>
        <h2>CSV出力</h2>
        {status ? <Message variant={status.kind}>{status.message}</Message> : null}
        <p>
          指定した期間の入出金・経費の記録をCSVファイルに出力します(取消済の入金記録を含み、削除済みの記録は含みません)。
        </p>
        <div className="csv-month-row">
          <div className={`field${fieldErrors.fromMonth ? ' error' : ''}`}>
            <label htmlFor="csv-from">
              開始年月<span className="required">必須</span>
            </label>
            <input
              id="csv-from"
              type="month"
              value={fromMonth}
              onChange={(e) => setFromMonth(e.target.value)}
            />
            {fieldErrors.fromMonth ? (
              <div className="error-message">{fieldErrors.fromMonth}</div>
            ) : null}
          </div>
          <div className={`field${fieldErrors.toMonth ? ' error' : ''}`}>
            <label htmlFor="csv-to">
              終了年月<span className="required">必須</span>
            </label>
            <input
              id="csv-to"
              type="month"
              value={toMonth}
              onChange={(e) => setToMonth(e.target.value)}
            />
            {fieldErrors.toMonth ? (
              <div className="error-message">{fieldErrors.toMonth}</div>
            ) : null}
          </div>
        </div>
        <div className="modal-actions">
          <Button onClick={onClose}>{status?.kind === 'success' ? '閉じる' : 'キャンセル'}</Button>
          <Button variant="primary" disabled={submitting} onClick={() => void handleExport()}>
            出力
          </Button>
        </div>
      </div>
    </div>
  )
}
