import { useEffect, useState, type ReactElement } from 'react'
import type { ReceiptView } from '@shared/types/receipt'
import type { ReceiptPreviewResult } from '@shared/types/receipt'

interface ReceiptThumbnailProps {
  receipt: Pick<ReceiptView, 'id' | 'originalName'>
  onClick: () => void
}

/**
 * 領収書のサムネイル(押下で拡大表示)。画像は検証済みの縮小画像、PDFは書類アイコン、
 * 照合に失敗した場合(改変・欠落等)は警告アイコンに置き換える。
 */
export function ReceiptThumbnail({ receipt, onClick }: ReceiptThumbnailProps): ReactElement {
  const [result, setResult] = useState<ReceiptPreviewResult | null>(null)

  useEffect(() => {
    let cancelled = false
    window.jimuhubApi.getReceiptThumbnail(receipt.id).then((r) => {
      if (!cancelled) setResult(r)
    })
    return () => {
      cancelled = true
    }
  }, [receipt.id])

  const label = `${receipt.originalName}を拡大表示`
  if (result?.success && result.kind === 'image') {
    return (
      <button type="button" className="thumb lg" aria-label={label} onClick={onClick}>
        <img src={result.dataUrl} alt="" />
      </button>
    )
  }
  const warn = result !== null && !result.success
  return (
    <button
      type="button"
      className={`thumb lg${warn ? ' warn' : result?.success && result.kind === 'pdf' ? ' pdf' : ''}`}
      aria-label={label}
      onClick={onClick}
    >
      {warn ? '!' : null}
    </button>
  )
}
