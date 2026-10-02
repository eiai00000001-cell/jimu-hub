/**
 * PDFテンプレート(HTML文字列組み立て)で用いる書式ユーティリティ。
 * 参照元: 基本設計書4.15章(見積書・請求書PDFレイアウト)
 */

/** 利用者入力値をHTMLへ埋め込む際にエスケープする(タグ注入・レイアウト崩れの防止) */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 金額を「¥1,234」形式に整形する */
export function formatYen(amount: number): string {
  return `¥${amount.toLocaleString('ja-JP')}`
}

/** 数量を、整数はそのまま・小数は最大2桁までの表示に整形する(末尾の不要な0は表示しない) */
export function formatQuantity(value: number): string {
  return value.toLocaleString('ja-JP', { maximumFractionDigits: 2 })
}

/** ISO8601日付文字列(YYYY-MM-DD)を「YYYY年M月D日」形式に整形する */
export function formatDateJapanese(isoDate: string): string {
  const [year, month, day] = isoDate.split('-')
  if (!year || !month || !day) {
    return escapeHtml(isoDate)
  }
  return escapeHtml(`${year}年${Number(month)}月${Number(day)}日`)
}

/**
 * PDFファイル名に使う文字列から、macOSのファイル名として不適切な文字を除去する。
 * `/`はパス区切りと衝突するため、`:`はFinder上でファイル名として使えないため置換する。
 */
export function sanitizeFileNamePart(value: string): string {
  return value.replace(/[/:]/g, '_').trim()
}
