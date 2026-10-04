import type { Database } from '../db/db'
import { RECORD_PAGE_SIZE } from '@shared/constants/cash-record'
import type {
  CashRecord,
  CashRecordSummary,
  Paged,
  RecordListFilter
} from '@shared/types/cash-record'

interface CashRecordRow {
  id: number
  record_date: string
  kind: CashRecord['kind']
  amount: number
  withholding_tax_amount: number
  account_id: number
  description: string
  client_id: number | null
  payment_method: CashRecord['paymentMethod']
  tax_category: CashRecord['taxCategory']
  tax_amount: number
  invoice_id: number | null
  status: CashRecord['status']
  is_deleted: number
  record_hash: string
  created_at: string
  updated_at: string
}

function mapRow(row: CashRecordRow): CashRecord {
  return {
    id: row.id,
    recordDate: row.record_date,
    kind: row.kind,
    amount: row.amount,
    withholdingTaxAmount: row.withholding_tax_amount,
    accountId: row.account_id,
    description: row.description,
    clientId: row.client_id,
    paymentMethod: row.payment_method,
    taxCategory: row.tax_category,
    taxAmount: row.tax_amount,
    invoiceId: row.invoice_id,
    status: row.status,
    isDeleted: row.is_deleted === 1,
    recordHash: row.record_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/** 登録・更新で保存する項目(記録ハッシュ・日時は含まない) */
export type CashRecordValues = Pick<
  CashRecord,
  | 'recordDate'
  | 'kind'
  | 'amount'
  | 'withholdingTaxAmount'
  | 'accountId'
  | 'description'
  | 'clientId'
  | 'paymentMethod'
  | 'taxCategory'
  | 'taxAmount'
  | 'invoiceId'
  | 'status'
  | 'isDeleted'
>

/** 参照名(勘定科目・取引先・請求書番号) */
export interface RecordNames {
  accountName: string
  clientName: string | null
  invoiceNumber: string | null
}

function nowIso(): string {
  return new Date().toISOString()
}

/**
 * cash_recordsテーブルへのアクセスを担うRepository層。
 * 検索はJOINを含むため、他のRepositoryと異なり素のSQL(better-sqlite3)で記述する。
 * 参照元: 詳細設計書4.18〜4.21章、5章(`CashRecordRepository`)、6.11章
 */
export class CashRecordRepository {
  constructor(private readonly database: Database) {}

  findById(id: number): CashRecord | null {
    const row = this.database.sqlite.prepare('SELECT * FROM cash_records WHERE id = ?').get(id) as
      CashRecordRow | undefined
    return row ? mapRow(row) : null
  }

  findNames(record: Pick<CashRecord, 'accountId' | 'clientId' | 'invoiceId'>): RecordNames {
    const row = this.database.sqlite
      .prepare(
        `SELECT (SELECT name FROM accounts WHERE id = @accountId) AS account_name,
                (SELECT name FROM clients WHERE id = @clientId) AS client_name,
                (SELECT invoice_number FROM invoices WHERE id = @invoiceId) AS invoice_number`
      )
      .get(record) as {
      account_name: string | null
      client_name: string | null
      invoice_number: string | null
    }
    return {
      accountName: row.account_name ?? '',
      clientName: row.client_name,
      invoiceNumber: row.invoice_number
    }
  }

  /** 記録を登録し、IDを返す。`record_hash`は呼び出し側が登録直後に`updateHash`で設定する */
  insert(values: CashRecordValues): { id: number } {
    const now = nowIso()
    const result = this.database.sqlite
      .prepare(
        `INSERT INTO cash_records (record_date, kind, amount, withholding_tax_amount, account_id,
           description, client_id, payment_method, tax_category, tax_amount, invoice_id, status,
           is_deleted, record_hash, created_at, updated_at)
         VALUES (@recordDate, @kind, @amount, @withholdingTaxAmount, @accountId, @description,
           @clientId, @paymentMethod, @taxCategory, @taxAmount, @invoiceId, @status, @isDeleted,
           '', @now, @now)`
      )
      .run({ ...values, isDeleted: values.isDeleted ? 1 : 0, now })
    return { id: Number(result.lastInsertRowid) }
  }

  update(id: number, values: CashRecordValues): void {
    this.database.sqlite
      .prepare(
        `UPDATE cash_records SET record_date = @recordDate, kind = @kind, amount = @amount,
           withholding_tax_amount = @withholdingTaxAmount, account_id = @accountId,
           description = @description, client_id = @clientId, payment_method = @paymentMethod,
           tax_category = @taxCategory, tax_amount = @taxAmount, invoice_id = @invoiceId,
           status = @status, is_deleted = @isDeleted, updated_at = @now
         WHERE id = @id`
      )
      .run({ ...values, id, isDeleted: values.isDeleted ? 1 : 0, now: nowIso() })
  }

  /** 変更なしと判明した更新を元に戻す際に、`updated_at`を復元する */
  restoreUpdatedAt(id: number, updatedAt: string): void {
    this.database.sqlite
      .prepare('UPDATE cash_records SET updated_at = ? WHERE id = ?')
      .run(updatedAt, id)
  }

  updateHash(id: number, recordHash: string): void {
    this.database.sqlite
      .prepare('UPDATE cash_records SET record_hash = ? WHERE id = ?')
      .run(recordHash, id)
  }

  /** 一覧・検索(削除済みを除く。取消済を含む)。日付降順・同日はid降順(詳細設計書4.19章) */
  search(filter: RecordListFilter): Paged<CashRecordSummary> {
    const conditions = ['r.is_deleted = 0']
    const params: Record<string, string | number> = {}
    if (filter.dateFrom) {
      conditions.push('r.record_date >= @dateFrom')
      params.dateFrom = filter.dateFrom
    }
    if (filter.dateTo) {
      conditions.push('r.record_date <= @dateTo')
      params.dateTo = filter.dateTo
    }
    if (filter.amountMin !== undefined) {
      conditions.push('r.amount >= @amountMin')
      params.amountMin = filter.amountMin
    }
    if (filter.amountMax !== undefined) {
      conditions.push('r.amount <= @amountMax')
      params.amountMax = filter.amountMax
    }
    if (filter.clientId !== undefined) {
      conditions.push('r.client_id = @clientId')
      params.clientId = filter.clientId
    }
    if (filter.accountId !== undefined) {
      conditions.push('r.account_id = @accountId')
      params.accountId = filter.accountId
    }
    if (filter.kind) {
      conditions.push('r.kind = @kind')
      params.kind = filter.kind
    }
    const where = conditions.join(' AND ')
    const page = filter.page ?? 1

    const total = this.database.sqlite
      .prepare(`SELECT COUNT(*) AS c FROM cash_records r WHERE ${where}`)
      .get(params) as { c: number }

    const rows = this.database.sqlite
      .prepare(
        `SELECT r.id, r.record_date, r.kind, r.amount, r.status, r.invoice_id,
                a.name AS account_name, c.name AS client_name, i.invoice_number, r.description,
                (SELECT COUNT(*) FROM receipts x WHERE x.record_id = r.id AND x.removed_at IS NULL) AS receipt_count
         FROM cash_records r
         JOIN accounts a ON a.id = r.account_id
         LEFT JOIN clients c ON c.id = r.client_id
         LEFT JOIN invoices i ON i.id = r.invoice_id
         WHERE ${where}
         ORDER BY r.record_date DESC, r.id DESC
         LIMIT @limit OFFSET @offset`
      )
      .all({ ...params, limit: RECORD_PAGE_SIZE, offset: (page - 1) * RECORD_PAGE_SIZE }) as Array<{
      id: number
      record_date: string
      kind: CashRecord['kind']
      amount: number
      status: CashRecord['status']
      invoice_id: number | null
      account_name: string
      client_name: string | null
      invoice_number: string | null
      description: string
      receipt_count: number
    }>

    return {
      items: rows.map((row) => ({
        id: row.id,
        recordDate: row.record_date,
        kind: row.kind,
        amount: row.amount,
        status: row.status,
        invoiceId: row.invoice_id,
        invoiceNumber: row.invoice_number,
        accountName: row.account_name,
        clientName: row.client_name,
        description: row.description,
        receiptCount: row.receipt_count
      })),
      totalCount: total.c,
      page,
      pageSize: RECORD_PAGE_SIZE
    }
  }
}
