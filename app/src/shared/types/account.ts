/** 勘定科目(詳細設計書6.10章) */
export type AccountKind = 'expense' | 'income'
export type AccountStatus = 'active' | 'inactive'

export interface Account {
  id: number
  name: string
  kind: AccountKind
  status: AccountStatus
  isDefault: boolean
  defaultKey: string | null
  sortOrder: number
}

/** 一覧表示用。`deletable`は初期科目でなく、記録で一度も使われていない場合のみtrue(詳細設計書4.17章手順2) */
export interface AccountView extends Account {
  deletable: boolean
}

export interface AccountListFilter {
  kind?: AccountKind
  includeInactive?: boolean
}
