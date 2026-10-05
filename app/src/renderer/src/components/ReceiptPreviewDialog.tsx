import { useEffect, useState, type ReactElement } from 'react'
import { Button } from './Button'
import { Message } from './Message'
import { RECEIPT_MESSAGES } from '@shared/messages/messages'
import type { ReceiptPreviewResult } from '@shared/types/receipt'

interface ReceiptPreviewDialogProps {
  receiptId: number
  fileName: string
  onOpenExternal: () => void
  onClose: () => void
}

/**
 * 領収書のアプリ内拡大表示ダイアログ。画像は拡大表示、PDFは案内のみ。
 * 照合結果がmismatch・missing・unreadableの場合は、警告のみを表示する(画像は表示しない)。
 * 参照元: 詳細設計書3.17章(領収書のサムネイル表示と拡大表示)、4.22章
 */
export function ReceiptPreviewDialog({
  receiptId,
  fileName,
  onOpenExternal,
  onClose
}: ReceiptPreviewDialogProps): ReactElement {
  const [result, setResult] = useState<ReceiptPreviewResult | null>(null)

  useEffect(() => {
    let cancelled = false
    window.jimuhubApi.getReceiptPreview(receiptId).then((r) => {
      if (!cancelled) setResult(r)
    })
    return () => {
      cancelled = true
    }
  }, [receiptId])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const warning =
    result && !result.success
      ? result.state === 'mismatch'
        ? RECEIPT_MESSAGES.mismatchWarning
        : result.state === 'missing'
          ? RECEIPT_MESSAGES.missingWarning
          : RECEIPT_MESSAGES.unreadableWarning
      : null

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="modal"
        style={{ width: 520 }}
        role="dialog"
        aria-label="領収書の拡大表示"
        onClick={(event) => event.stopPropagation()}
      >
        <h2>{fileName}</h2>
        {warning ? <Message variant="error">{warning}</Message> : null}
        {result?.success && result.kind === 'image' ? (
          <div className="receipt-preview-image">
            <img src={result.dataUrl} alt={fileName} />
          </div>
        ) : null}
        {result?.success && result.kind === 'pdf' ? (
          <p>{RECEIPT_MESSAGES.pdfNotPreviewable}</p>
        ) : null}
        <div className="modal-actions">
          <Button onClick={onOpenExternal}>開く(OS標準アプリ)</Button>
          <Button variant="primary" onClick={onClose}>
            閉じる
          </Button>
        </div>
      </div>
    </div>
  )
}
