/**
 * 取引先(CLIENTS)の型定義。
 * 参照元: 詳細設計書 3.3章(入力項目定義表)、6.1章(clientsテーブル定義)
 */

export const HONORIFICS = ['御中', '様', '(なし)'] as const
export type Honorific = (typeof HONORIFICS)[number]

export const CLIENT_STATUSES = ['active', 'inactive'] as const
export type ClientStatus = (typeof CLIENT_STATUSES)[number]

export const CLIENT_SORT_KEYS = [
  'name_asc',
  'name_desc',
  'created_at_desc',
  'created_at_asc'
] as const
export type ClientSortKey = (typeof CLIENT_SORT_KEYS)[number]

export const CLIENT_STATUS_FILTERS = ['active', 'all'] as const
export type ClientStatusFilter = (typeof CLIENT_STATUS_FILTERS)[number]

/** 取引先マスタの1レコード(表示・詳細取得時の形) */
export interface Client {
  id: number
  name: string
  honorific: Honorific
  contactPerson: string | null
  postalCode: string | null
  address: string | null
  phone: string | null
  email: string | null
  invoiceRegistrationNumber: string | null
  memo: string | null
  status: ClientStatus
  createdAt: string
  updatedAt: string
}

/** 取引先一覧取得の絞り込み条件(詳細設計書 4.5章・7章) */
export interface ClientListFilter {
  keyword?: string
  sort?: ClientSortKey
  statusFilter?: ClientStatusFilter
}
