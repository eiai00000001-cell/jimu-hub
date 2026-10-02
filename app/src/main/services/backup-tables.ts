import type SqliteDatabase from 'better-sqlite3'
import type { BackupRow } from '@shared/backup/backup-file'

/**
 * バックアップ(エクスポート/復元)対象テーブルのうち、取引先以外の列定義。
 * JSONのキー(camelCase)とDB列(snake_case)の対応を明示し、復元時は定義済みの列のみをINSERTする。
 * 参照元: 詳細設計書 4.2章・4.3章、6章
 */
export interface TableDef {
  table: string
  /** [JSONキー, DB列名, 真偽値として扱うか] */
  columns: ReadonlyArray<readonly [string, string, boolean?]>
  orderBy: string
}

export const COMPANY_PROFILE_TABLE: TableDef = {
  table: 'company_profile',
  orderBy: 'id',
  columns: [
    ['id', 'id'],
    ['name', 'name'],
    ['address', 'address'],
    ['invoiceRegistrationNumber', 'invoice_registration_number'],
    ['bankName', 'bank_name'],
    ['bankBranch', 'bank_branch'],
    ['accountType', 'account_type'],
    ['accountNumber', 'account_number'],
    ['accountHolder', 'account_holder'],
    ['updatedAt', 'updated_at']
  ]
}

export const QUOTES_TABLE: TableDef = {
  table: 'quotes',
  orderBy: 'id',
  columns: [
    ['id', 'id'],
    ['quoteNumber', 'quote_number'],
    ['clientId', 'client_id'],
    ['issueDate', 'issue_date'],
    ['validUntil', 'valid_until'],
    ['remarks', 'remarks'],
    ['subtotal10', 'subtotal_10'],
    ['taxAmount10', 'tax_amount_10'],
    ['subtotal8', 'subtotal_8'],
    ['taxAmount8', 'tax_amount_8'],
    ['totalAmount', 'total_amount'],
    ['invoiceFormat', 'invoice_format'],
    ['status', 'status'],
    ['pdfPath', 'pdf_path'],
    ['pdfHash', 'pdf_hash'],
    ['pdfHashMismatch', 'pdf_hash_mismatch', true],
    ['createdAt', 'created_at'],
    ['updatedAt', 'updated_at']
  ]
}

export const QUOTE_LINE_ITEMS_TABLE: TableDef = {
  table: 'quote_line_items',
  orderBy: 'quote_id, line_no',
  columns: [
    ['id', 'id'],
    ['quoteId', 'quote_id'],
    ['lineNo', 'line_no'],
    ['name', 'name'],
    ['quantity', 'quantity'],
    ['unit', 'unit'],
    ['unitPrice', 'unit_price'],
    ['taxRate', 'tax_rate'],
    ['amount', 'amount']
  ]
}

export const INVOICES_TABLE: TableDef = {
  table: 'invoices',
  orderBy: 'id',
  columns: [
    ['id', 'id'],
    ['invoiceNumber', 'invoice_number'],
    ['clientId', 'client_id'],
    ['sourceQuoteId', 'source_quote_id'],
    ['issueDate', 'issue_date'],
    ['dueDate', 'due_date'],
    ['remarks', 'remarks'],
    ['subtotal10', 'subtotal_10'],
    ['taxAmount10', 'tax_amount_10'],
    ['subtotal8', 'subtotal_8'],
    ['taxAmount8', 'tax_amount_8'],
    ['totalAmount', 'total_amount'],
    ['withholdingTaxAmount', 'withholding_tax_amount'],
    ['billingAmount', 'billing_amount'],
    ['invoiceFormat', 'invoice_format'],
    ['status', 'status'],
    ['paymentStatus', 'payment_status'],
    ['paymentDate', 'payment_date'],
    ['pdfPath', 'pdf_path'],
    ['pdfHash', 'pdf_hash'],
    ['pdfHashMismatch', 'pdf_hash_mismatch', true],
    ['createdAt', 'created_at'],
    ['updatedAt', 'updated_at']
  ]
}

/** 請求書明細行。行ごとの源泉徴収税額(withholding_amount)は使用しないため、エクスポート・復元の対象外(復元時は0) */
export const INVOICE_LINE_ITEMS_TABLE: TableDef = {
  table: 'invoice_line_items',
  orderBy: 'invoice_id, line_no',
  columns: [
    ['id', 'id'],
    ['invoiceId', 'invoice_id'],
    ['lineNo', 'line_no'],
    ['name', 'name'],
    ['quantity', 'quantity'],
    ['unit', 'unit'],
    ['unitPrice', 'unit_price'],
    ['taxRate', 'tax_rate'],
    ['amount', 'amount'],
    ['withholdingTarget', 'withholding_target', true]
  ]
}

/** テーブルの全行を、JSONキー(camelCase)のレコードとして取得する */
export function readRows(sqlite: SqliteDatabase.Database, def: TableDef): BackupRow[] {
  const select = def.columns.map(([key, column]) => `${column} AS ${key}`).join(', ')
  const rows = sqlite
    .prepare(`SELECT ${select} FROM ${def.table} ORDER BY ${def.orderBy}`)
    .all() as BackupRow[]
  const boolKeys = def.columns.filter((c) => c[2]).map((c) => c[0])
  return rows.map((row) => {
    const converted: BackupRow = { ...row }
    for (const key of boolKeys) {
      converted[key] = row[key] === 1
    }
    return converted
  })
}

/** レコードを1行INSERTする。定義にないキーは無視し、真偽値は0/1へ変換する */
export function insertRow(
  sqlite: SqliteDatabase.Database,
  def: TableDef,
  record: BackupRow,
  overrides: Partial<Record<string, unknown>> = {}
): void {
  const present = def.columns.filter(([key]) => key in record || key in overrides)
  const names = present.map(([, column]) => column).join(', ')
  const placeholders = present.map(() => '?').join(', ')
  const values = present.map(([key, , isBool]) => {
    const value = key in overrides ? overrides[key] : record[key]
    if (isBool) {
      return value === true || value === 1 ? 1 : 0
    }
    return value === undefined ? null : value
  })
  sqlite.prepare(`INSERT INTO ${def.table} (${names}) VALUES (${placeholders})`).run(...values)
}
