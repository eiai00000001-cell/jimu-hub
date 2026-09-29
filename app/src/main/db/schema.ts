import { sqliteTable, text, integer, real, primaryKey } from 'drizzle-orm/sqlite-core'

/**
 * Drizzle ORMのテーブル定義。
 * テーブル・カラムの物理定義そのもの(CHECK制約・既定値式等)は db.ts の生成SQL(詳細設計書6章のDDLをそのまま採用)を正とし、
 * 本ファイルはCRUD時の型安全なクエリ構築のためのマッピング定義として用いる。
 */

export const clients = sqliteTable('clients', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  furigana: text('furigana'),
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

export const documentNumberSequences = sqliteTable(
  'document_number_sequences',
  {
    year: integer('year').notNull(),
    docType: text('doc_type').notNull(),
    lastNumber: integer('last_number').notNull().default(0)
  },
  (table) => [primaryKey({ columns: [table.year, table.docType] })]
)

export const quotes = sqliteTable('quotes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  quoteNumber: text('quote_number'),
  clientId: integer('client_id').notNull(),
  issueDate: text('issue_date').notNull(),
  validUntil: text('valid_until'),
  remarks: text('remarks'),
  subtotal10: integer('subtotal_10').notNull().default(0),
  taxAmount10: integer('tax_amount_10').notNull().default(0),
  subtotal8: integer('subtotal_8').notNull().default(0),
  taxAmount8: integer('tax_amount_8').notNull().default(0),
  totalAmount: integer('total_amount').notNull().default(0),
  invoiceFormat: text('invoice_format'),
  status: text('status').notNull().default('draft'),
  pdfPath: text('pdf_path'),
  pdfHash: text('pdf_hash'),
  pdfHashMismatch: integer('pdf_hash_mismatch').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
})

export const quoteLineItems = sqliteTable('quote_line_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  quoteId: integer('quote_id').notNull(),
  lineNo: integer('line_no').notNull(),
  name: text('name').notNull(),
  quantity: real('quantity').notNull().default(1),
  unit: text('unit'),
  unitPrice: integer('unit_price').notNull().default(0),
  taxRate: integer('tax_rate').notNull(),
  amount: integer('amount').notNull().default(0)
})
