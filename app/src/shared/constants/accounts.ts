/**
 * 初期勘定科目(14件)。参照元: 詳細設計書4.17章手順1、6.10章
 * 表示順(sortOrder)は区分ごとに10刻み。`defaultKey`のある科目は利用停止にできない。
 */
export interface InitialAccount {
  name: string
  kind: 'expense' | 'income'
  sortOrder: number
  defaultKey: string | null
}

const EXPENSE_NAMES = [
  '通信費',
  '旅費交通費',
  '消耗品費',
  '接待交際費',
  '外注費',
  '会議費',
  '地代家賃',
  '水道光熱費',
  '広告宣伝費',
  '租税公課',
  '支払手数料',
  '雑費'
] as const

/** 請求書の入金記録の自動作成で参照する科目(「売上高」)のdefault_key */
export const SALES_REVENUE_KEY = 'sales_revenue'

export const INITIAL_ACCOUNTS: readonly InitialAccount[] = [
  ...EXPENSE_NAMES.map((name, index) => ({
    name,
    kind: 'expense' as const,
    sortOrder: (index + 1) * 10,
    defaultKey: null
  })),
  { name: '売上高', kind: 'income', sortOrder: 10, defaultKey: SALES_REVENUE_KEY },
  { name: '雑収入', kind: 'income', sortOrder: 20, defaultKey: null }
]
