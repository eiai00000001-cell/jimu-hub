import type { ProjectLinkHistoryEntry, ProjectLinkTargetType } from '@shared/types/project'

/** 期間の表示(「開始日〜終了日」。未入力側は空欄) */
export function formatProjectPeriod(startDate: string | null, endDate: string | null): string {
  if (!startDate && !endDate) return ''
  return `${startDate ?? ''}〜${endDate ?? ''}`
}

/** ISO日時を、ローカル時刻の`YYYY-MM-DD HH:mm`で表示する */
export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`
}

const TARGET_TYPE_LABELS: Record<ProjectLinkTargetType, string> = {
  quote: '見積書',
  invoice: '請求書',
  cash_record: '入出金'
}

export function formatHistoryTarget(entry: ProjectLinkHistoryEntry): string {
  return `${TARGET_TYPE_LABELS[entry.targetType]} ${entry.targetLabel}`
}

/** 付け替え前後の案件の表示(案件なしは「案件なし」) */
export function formatHistoryProject(name: string | null): string {
  return name ?? '案件なし'
}

const KIND_LABELS: Record<ProjectLinkHistoryEntry['kind'], string> = {
  assign: '紐づけ',
  change: '付け替え',
  unassign: '解除',
  auto_release: '自動解除'
}

export function formatHistoryKind(kind: ProjectLinkHistoryEntry['kind']): string {
  return KIND_LABELS[kind]
}

/** 金額(円)の表示。マイナスは「−¥12,000」 */
export function formatYen(amount: number): string {
  return `${amount < 0 ? '−' : ''}¥${Math.abs(amount).toLocaleString('ja-JP')}`
}
