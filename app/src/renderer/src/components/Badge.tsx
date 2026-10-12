import type { ReactElement } from 'react'

type Variant =
  | 'active'
  | 'inactive'
  | 'projectActive'
  | 'projectCompleted'
  | 'soon'
  | 'draft'
  | 'finalized'
  | 'warning'
  | 'unpaid'
  | 'paid'

const LABELS: Record<Variant, string> = {
  active: '利用中',
  inactive: '利用停止',
  projectActive: '進行中',
  projectCompleted: '完了',
  soon: '準備中',
  draft: '下書き',
  finalized: 'PDF保存済み',
  warning: 'PDFファイルの改変が疑われます',
  unpaid: '未収',
  paid: '入金済み'
}

/** 見た目を他の状態バッジと共有するもの(進行中=利用中と同じ、完了=利用停止と同じ) */
const BADGE_CLASS: Partial<Record<Variant, string>> = {
  projectActive: 'active',
  projectCompleted: 'inactive'
}

interface BadgeProps {
  variant: Variant
}

/** 表示だけの物(状態バッジ): デザインガイド5.1章。丸型(例外)・1行で折り返さない */
export function Badge({ variant }: BadgeProps): ReactElement {
  return <span className={`badge badge-${BADGE_CLASS[variant] ?? variant}`}>{LABELS[variant]}</span>
}
