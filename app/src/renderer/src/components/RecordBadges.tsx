import type { ReactElement } from 'react'
import { KIND_LABELS } from '@shared/constants/cash-record'
import type { RecordKind, RecordStatus } from '@shared/types/cash-record'

/** 種別バッジ(入金=濃グレー塗り+白文字、経費=グレー地+濃グレー文字) */
export function KindBadge({ kind }: { kind: RecordKind }): ReactElement {
  return <span className={`badge badge-${kind}`}>{KIND_LABELS[kind]}</span>
}

/** 状態バッジ(有効/取消済) */
export function RecordStatusBadge({ status }: { status: RecordStatus }): ReactElement {
  return status === 'active' ? (
    <span className="badge badge-active">有効</span>
  ) : (
    <span className="badge badge-cancelled">取消済</span>
  )
}
