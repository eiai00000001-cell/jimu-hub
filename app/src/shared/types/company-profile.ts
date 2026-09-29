/**
 * 自社情報・振込先(COMPANY_PROFILE)の型定義。
 * 参照元: 詳細設計書 3.9章(入力項目定義表)、6.3章(company_profileテーブル定義)
 */

export const ACCOUNT_TYPES = ['普通', '当座'] as const
export type AccountType = (typeof ACCOUNT_TYPES)[number]

/** 自社情報・振込先の1レコード。未設定の場合(レコード未登録)は`null`で表す */
export interface CompanyProfile {
  name: string
  address: string
  invoiceRegistrationNumber: string | null
  bankName: string | null
  bankBranch: string | null
  accountType: AccountType | null
  accountNumber: string | null
  accountHolder: string | null
  updatedAt: string
}
