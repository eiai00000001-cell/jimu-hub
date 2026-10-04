import {
  KIND_LABELS,
  PAYMENT_METHOD_LABELS,
  STATUS_LABELS,
  TAX_CATEGORY_LABELS
} from '../constants/cash-record'
import type { FieldChange, RecordSnapshot } from '../types/cash-record'

const NONE = '(なし)'
const UNSELECTED = '(未選択)'

const yen = (value: number): string => `¥${value.toLocaleString('ja-JP')}`

const FIELDS: Array<{
  key: keyof RecordSnapshot
  label: string
  format: (snapshot: RecordSnapshot) => string
}> = [
  { key: 'recordDate', label: '日付', format: (s) => s.recordDate },
  { key: 'kind', label: '種別', format: (s) => KIND_LABELS[s.kind] },
  { key: 'amount', label: '金額', format: (s) => yen(s.amount) },
  {
    key: 'withholdingTaxAmount',
    label: '源泉徴収税額',
    format: (s) => yen(s.withholdingTaxAmount)
  },
  { key: 'accountName', label: '勘定科目', format: (s) => s.accountName },
  { key: 'description', label: '摘要・メモ', format: (s) => s.description },
  { key: 'clientName', label: '取引先', format: (s) => s.clientName ?? NONE },
  {
    key: 'paymentMethod',
    label: '支払方法',
    format: (s) => (s.paymentMethod ? PAYMENT_METHOD_LABELS[s.paymentMethod] : UNSELECTED)
  },
  {
    key: 'taxCategory',
    label: '税区分',
    format: (s) => (s.taxCategory ? TAX_CATEGORY_LABELS[s.taxCategory] : UNSELECTED)
  },
  { key: 'taxAmount', label: '消費税額', format: (s) => yen(s.taxAmount) },
  { key: 'invoiceNumber', label: '請求書番号', format: (s) => s.invoiceNumber ?? NONE },
  { key: 'status', label: '状態', format: (s) => STATUS_LABELS[s.status] },
  { key: 'isDeleted', label: '削除', format: (s) => (s.isDeleted ? 'あり' : 'なし') }
]

/** 領収書の変更(追加・外した)を、変更前後の文字列として返す。変更が無ければnull */
function diffReceipts(
  before: RecordSnapshot | null,
  after: RecordSnapshot
): { before: string; after: string } | null {
  const beforeMap = new Map((before?.receipts ?? []).map((r) => [r.id, r]))
  const added: string[] = []
  const removed: string[] = []
  for (const receipt of after.receipts) {
    const prev = beforeMap.get(receipt.id)
    if (!prev) added.push(receipt.originalName)
    else if (!prev.removed && receipt.removed) removed.push(receipt.originalName)
  }
  if (added.length === 0 && removed.length === 0) return null
  const parts = [
    ...added.map((name) => `追加: ${name}`),
    ...removed.map((name) => `外した: ${name}`)
  ]
  return { before: NONE, after: parts.join('、') }
}

/**
 * 2つのスナップショットを項目ごとに比較し、変更のあった項目の変更前後(表示用の文字列)を返す。
 * `before`が`null`(登録)の場合は、すべての項目を「(なし)→変更後」として返す。
 * 参照元: 詳細設計書4.20章(`HistoryDiffer`)
 */
export function diffSnapshots(before: RecordSnapshot | null, after: RecordSnapshot): FieldChange[] {
  const changes: FieldChange[] = []
  for (const field of FIELDS) {
    if (before === null) {
      changes.push({ label: field.label, before: NONE, after: field.format(after) })
      continue
    }
    if (before[field.key] !== after[field.key]) {
      changes.push({
        label: field.label,
        before: field.format(before),
        after: field.format(after)
      })
    }
  }
  const receipts = diffReceipts(before, after)
  if (receipts) changes.push({ label: '領収書', ...receipts })
  return changes
}
