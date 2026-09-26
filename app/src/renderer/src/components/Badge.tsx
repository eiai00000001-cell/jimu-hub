import type { ReactElement } from 'react'

type Variant = 'active' | 'inactive' | 'soon'

const LABELS: Record<Variant, string> = {
  active: '利用中',
  inactive: '利用停止',
  soon: '準備中'
}

interface BadgeProps {
  variant: Variant
}

/** 表示だけの物(状態バッジ): デザインガイド5.1章。丸型(例外)・1行で折り返さない */
export function Badge({ variant }: BadgeProps): ReactElement {
  return <span className={`badge badge-${variant}`}>{LABELS[variant]}</span>
}
