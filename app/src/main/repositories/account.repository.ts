import { and, asc, eq, ne, sql, type SQL } from 'drizzle-orm'
import type { Database } from '../db/db'
import { accounts } from '../db/schema'
import type { Account, AccountKind, AccountListFilter } from '@shared/types/account'

function nowIso(): string {
  return new Date().toISOString()
}

function mapRow(row: typeof accounts.$inferSelect): Account {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as AccountKind,
    status: row.status as Account['status'],
    isDefault: row.isDefault === 1,
    defaultKey: row.defaultKey,
    sortOrder: row.sortOrder
  }
}

/**
 * accountsテーブルへのアクセスを担うRepository層。
 * 参照元: 詳細設計書 4.17章、5章(`AccountRepository`)、6.10章
 */
export class AccountRepository {
  constructor(private readonly database: Database) {}

  /** 経費→収入、表示順、idの順で返す(詳細設計書4.17章手順2) */
  findAll(filter: AccountListFilter = {}): Account[] {
    const conditions: SQL[] = []
    if (filter.kind) conditions.push(eq(accounts.kind, filter.kind))
    if (!filter.includeInactive) conditions.push(eq(accounts.status, 'active'))
    return this.database.orm
      .select()
      .from(accounts)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(
        sql`CASE ${accounts.kind} WHEN 'expense' THEN 0 ELSE 1 END`,
        asc(accounts.sortOrder),
        asc(accounts.id)
      )
      .all()
      .map(mapRow)
  }

  findById(id: number): Account | null {
    const row = this.database.orm.select().from(accounts).where(eq(accounts.id, id)).get()
    return row ? mapRow(row) : null
  }

  /** システム参照用キー(`default_key`)から科目を取得する(名称を変更していても参照できる) */
  findByDefaultKey(defaultKey: string): Account | null {
    const row = this.database.orm
      .select()
      .from(accounts)
      .where(eq(accounts.defaultKey, defaultKey))
      .get()
    return row ? mapRow(row) : null
  }

  /** 同じ区分に同名(利用停止を含む)の科目があるか。`excludeId`は名称変更時の自身 */
  existsByName(kind: AccountKind, name: string, excludeId?: number): boolean {
    const conditions = [eq(accounts.kind, kind), eq(accounts.name, name)]
    if (excludeId !== undefined) conditions.push(ne(accounts.id, excludeId))
    return (
      this.database.orm
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(...conditions))
        .limit(1)
        .get() !== undefined
    )
  }

  /** 記録で使用されているか(削除済み・取消済の記録も含む。詳細設計書4.17章手順7) */
  isUsed(id: number): boolean {
    const row = this.database.sqlite
      .prepare('SELECT 1 AS used FROM cash_records WHERE account_id = ? LIMIT 1')
      .get(id)
    return row !== undefined
  }

  insert(name: string, kind: AccountKind): { id: number } {
    const max = this.database.orm
      .select({ value: sql<number | null>`MAX(${accounts.sortOrder})` })
      .from(accounts)
      .where(eq(accounts.kind, kind))
      .get()
    const now = nowIso()
    const result = this.database.orm
      .insert(accounts)
      .values({
        name,
        kind,
        status: 'active',
        isDefault: 0,
        sortOrder: (max?.value ?? 0) + 10,
        createdAt: now,
        updatedAt: now
      })
      .run()
    return { id: Number(result.lastInsertRowid) }
  }

  updateName(id: number, name: string): void {
    this.database.orm
      .update(accounts)
      .set({ name, updatedAt: nowIso() })
      .where(eq(accounts.id, id))
      .run()
  }

  updateStatus(id: number, status: Account['status']): void {
    this.database.orm
      .update(accounts)
      .set({ status, updatedAt: nowIso() })
      .where(eq(accounts.id, id))
      .run()
  }

  delete(id: number): void {
    this.database.orm.delete(accounts).where(eq(accounts.id, id)).run()
  }
}
