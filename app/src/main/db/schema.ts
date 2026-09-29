import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

/**
 * Drizzle ORMのテーブル定義。
 * テーブル・カラムの物理定義そのもの(CHECK制約・既定値式等)は db.ts の生成SQL(詳細設計書6章のDDLをそのまま採用)を正とし、
 * 本ファイルはCRUD時の型安全なクエリ構築のためのマッピング定義として用いる。
 */

export const clients = sqliteTable('clients', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  honorific: text('honorific').notNull().default('(なし)'),
  contactPerson: text('contact_person'),
  postalCode: text('postal_code'),
  address: text('address'),
  phone: text('phone'),
  email: text('email'),
  invoiceRegistrationNumber: text('invoice_registration_number'),
  memo: text('memo'),
  status: text('status').notNull().default('active'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
})

export const appMeta = sqliteTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull()
})

export const companyProfile = sqliteTable('company_profile', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  address: text('address').notNull(),
  invoiceRegistrationNumber: text('invoice_registration_number'),
  bankName: text('bank_name'),
  bankBranch: text('bank_branch'),
  accountType: text('account_type'),
  accountNumber: text('account_number'),
  accountHolder: text('account_holder'),
  updatedAt: text('updated_at').notNull()
})
