/** 入出金・経費の定数・列挙値と表示ラベル。参照元: 詳細設計書3.15〜3.18章、6.11章 */
export const RECORD_PAGE_SIZE = 50
export const RECORD_DATE_MIN = '2000-01-01'
export const RECORD_DATE_MAX = '2099-12-31'
export const RECORD_AMOUNT_MAX = 9_999_999_999
export const RECORD_DESCRIPTION_MAX = 200
export const RECORD_REASON_MAX = 200

export const RECORD_KINDS = ['income', 'expense'] as const
export const PAYMENT_METHODS = ['cash', 'transfer', 'credit_card', 'other'] as const
export const TAX_CATEGORIES = ['standard_10', 'reduced_8', 'tax_exempt', 'not_applicable'] as const
export const HISTORY_OPERATIONS = ['create', 'update', 'delete', 'cancel'] as const

export const KIND_LABELS = { income: '入金', expense: '経費' } as const
export const PAYMENT_METHOD_LABELS = {
  cash: '現金',
  transfer: '振込',
  credit_card: 'クレジットカード',
  other: 'その他'
} as const
export const TAX_CATEGORY_LABELS = {
  standard_10: '10%',
  reduced_8: '8%(軽減)',
  tax_exempt: '非課税',
  not_applicable: '対象外'
} as const
export const STATUS_LABELS = { active: '有効', cancelled: '取消済' } as const
export const OPERATION_LABELS = {
  create: '登録',
  update: '変更',
  delete: '削除',
  cancel: '取消'
} as const
