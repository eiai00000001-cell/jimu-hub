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
  /** DBではJSON文字列(TEXT)で保持し、エクスポートファイルではオブジェクトとして書き出すキー */
  jsonKeys?: readonly string[]
}

export const CLIENTS_TABLE: TableDef = {
  table: 'clients',
  orderBy: 'id',
  columns: [
    ['id', 'id'],
    ['name', 'name'],
    ['furigana', 'furigana'],
    ['honorific', 'honorific'],
    ['contactPerson', 'contact_person'],
    ['postalCode', 'postal_code'],
    ['address', 'address'],
    ['phone', 'phone'],
    ['email', 'email'],
    ['invoiceRegistrationNumber', 'invoice_registration_number'],
    ['memo', 'memo'],
    ['status', 'status'],
    ['createdAt', 'created_at'],
    ['updatedAt', 'updated_at']
  ]
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

export const ACCOUNTS_TABLE: TableDef = {
  table: 'accounts',
  orderBy: 'id',
  columns: [
    ['id', 'id'],
    ['name', 'name'],
    ['kind', 'kind'],
    ['status', 'status'],
    ['isDefault', 'is_default', true],
    ['defaultKey', 'default_key'],
    ['sortOrder', 'sort_order'],
    ['createdAt', 'created_at'],
    ['updatedAt', 'updated_at']
  ]
}

export const CASH_RECORDS_TABLE: TableDef = {
  table: 'cash_records',
  orderBy: 'id',
  columns: [
    ['id', 'id'],
    ['recordDate', 'record_date'],
    ['kind', 'kind'],
    ['amount', 'amount'],
    ['withholdingTaxAmount', 'withholding_tax_amount'],
    ['accountId', 'account_id'],
    ['description', 'description'],
    ['clientId', 'client_id'],
    ['paymentMethod', 'payment_method'],
    ['taxCategory', 'tax_category'],
    ['taxAmount', 'tax_amount'],
    ['invoiceId', 'invoice_id'],
    ['status', 'status'],
    ['isDeleted', 'is_deleted', true],
    ['recordHash', 'record_hash'],
    ['createdAt', 'created_at'],
    ['updatedAt', 'updated_at']
  ]
}

export const RECEIPTS_TABLE: TableDef = {
  table: 'receipts',
  orderBy: 'id',
  columns: [
    ['id', 'id'],
    ['recordId', 'record_id'],
    ['originalName', 'original_name'],
    ['filePath', 'file_path'],
    ['mimeType', 'mime_type'],
    ['fileSize', 'file_size'],
    ['sha256', 'sha256'],
    ['attachedAt', 'attached_at'],
    ['removedAt', 'removed_at']
  ]
}

export const CASH_RECORD_HISTORY_TABLE: TableDef = {
  table: 'cash_record_history',
  orderBy: 'id',
  jsonKeys: ['snapshotBefore', 'snapshotAfter'],
  columns: [
    ['id', 'id'],
    ['recordId', 'record_id'],
    ['operation', 'operation'],
    ['operatedAt', 'operated_at'],
    ['reason', 'reason'],
    ['snapshotBefore', 'snapshot_before'],
    ['snapshotAfter', 'snapshot_after'],
    ['recordHashAfter', 'record_hash_after']
  ]
}

/**
 * バックアップ対象テーブルの一覧(JSON Linesのファイル名・manifestのキー・定義)。
 * 復元時の取り込み順は、この配列の順(外部キーの参照先から先に)とする(詳細設計書4.3章手順6)。
 * 案件(`projects`・`projectLinkHistory`)は、T-63-6で追加する。
 */
export interface BackupTableEntry {
  /** manifestの`tables`のキー兼`data/<名前>.jsonl`の名前 */
  name: string
  def: TableDef
}

export const BACKUP_TABLES: readonly BackupTableEntry[] = [
  { name: 'clients', def: CLIENTS_TABLE },
  { name: 'companyProfile', def: COMPANY_PROFILE_TABLE },
  { name: 'quotes', def: QUOTES_TABLE },
  { name: 'quoteLineItems', def: QUOTE_LINE_ITEMS_TABLE },
  { name: 'invoices', def: INVOICES_TABLE },
  { name: 'invoiceLineItems', def: INVOICE_LINE_ITEMS_TABLE },
  { name: 'accounts', def: ACCOUNTS_TABLE },
  { name: 'cashRecords', def: CASH_RECORDS_TABLE },
  { name: 'receipts', def: RECEIPTS_TABLE },
  { name: 'cashRecordHistory', def: CASH_RECORD_HISTORY_TABLE }
]

/** テーブルの全行を、JSONキー(camelCase)のレコードとして取得する */
export function readRows(sqlite: SqliteDatabase.Database, def: TableDef): BackupRow[] {
  return convertRows(def, selectRows(sqlite, def, `ORDER BY ${def.orderBy}`))
}

/** 主キー(`id`)の昇順で、`afterId`より大きい行を最大`limit`件取得する(キーセット方式。詳細設計書4.2章手順4) */
export function readRowsPage(
  sqlite: SqliteDatabase.Database,
  def: TableDef,
  afterId: number,
  limit: number
): BackupRow[] {
  return convertRows(
    def,
    selectRows(sqlite, def, 'WHERE id > ? ORDER BY id LIMIT ?', [afterId, limit])
  )
}

function selectRows(
  sqlite: SqliteDatabase.Database,
  def: TableDef,
  tail: string,
  params: unknown[] = []
): BackupRow[] {
  const select = def.columns.map(([key, column]) => `${column} AS ${key}`).join(', ')
  return sqlite.prepare(`SELECT ${select} FROM ${def.table} ${tail}`).all(...params) as BackupRow[]
}

function convertRows(def: TableDef, rows: BackupRow[]): BackupRow[] {
  const boolKeys = def.columns.filter((c) => c[2]).map((c) => c[0])
  return rows.map((row) => {
    const converted: BackupRow = { ...row }
    for (const key of boolKeys) {
      converted[key] = row[key] === 1
    }
    for (const key of def.jsonKeys ?? []) {
      const value = row[key]
      converted[key] = typeof value === 'string' ? JSON.parse(value) : null
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
    if (def.jsonKeys?.includes(key)) {
      return value === undefined || value === null ? null : JSON.stringify(value)
    }
    return value === undefined ? null : value
  })
  sqlite.prepare(`INSERT INTO ${def.table} (${names}) VALUES (${placeholders})`).run(...values)
}
