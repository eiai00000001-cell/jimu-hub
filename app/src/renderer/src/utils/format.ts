/** 金額を「¥1,234」形式にする */
export function formatYen(value: number): string {
  return `¥${value.toLocaleString('ja-JP')}`
}

/** 入金は「+」、経費は「−」を付けた金額表示(デザインガイドv2.1。色は使わない) */
export function formatSignedAmount(kind: 'income' | 'expense', amount: number): string {
  return `${kind === 'income' ? '+' : '−'}${formatYen(amount)}`
}

/** ISO日時を「YYYY-MM-DD HH:mm」(ローカル時刻)にする */
export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`
}

/** ファイルサイズを「412 KB」「1.2 MB」形式にする */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** 本日を`YYYY-MM-DD`(ローカル日付)で返す */
export function todayIso(): string {
  const date = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
