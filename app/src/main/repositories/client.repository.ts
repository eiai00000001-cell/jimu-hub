import { and, asc, desc, eq, like } from 'drizzle-orm'
import type { Database } from '../db/db'
import { clients } from '../db/schema'
import type { Client, ClientListFilter, ClientStatus } from '@shared/types/client'
import type { ClientInput } from '@shared/schemas/client.schema'
import type { BackupClientRecord } from '@shared/backup/backup-file'

type ClientRow = typeof clients.$inferSelect

function toNullable(value: string): string | null {
  return value === '' ? null : value
}

function mapRowToClient(row: ClientRow): Client {
  return {
    id: row.id,
    name: row.name,
    honorific: row.honorific as Client['honorific'],
    contactPerson: row.contactPerson,
    postalCode: row.postalCode,
    address: row.address,
    phone: row.phone,
    email: row.email,
    invoiceRegistrationNumber: row.invoiceRegistrationNumber,
    memo: row.memo,
    status: row.status as ClientStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

function nowIso(): string {
  return new Date().toISOString()
}

/**
 * clientsテーブルへのCRUDアクセスを担うRepository層。
 * 参照元: 詳細設計書 4.4〜4.8章、5章(クラス設計 `ClientRepository`)
 */
export class ClientRepository {
  constructor(private readonly database: Database) {}

  findAll(filter: ClientListFilter = {}): Client[] {
    const { keyword, sort = 'name_asc', statusFilter = 'active' } = filter

    const conditions = []
    if (keyword) {
      conditions.push(like(clients.name, `%${keyword}%`))
    }
    if (statusFilter === 'active') {
      conditions.push(eq(clients.status, 'active'))
    }

    const orderBy = {
      name_asc: [asc(clients.name), asc(clients.id)],
      name_desc: [desc(clients.name), desc(clients.id)],
      created_at_desc: [desc(clients.createdAt), desc(clients.id)],
      created_at_asc: [asc(clients.createdAt), asc(clients.id)]
    }[sort]

    const rows = this.database.orm
      .select()
      .from(clients)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(...orderBy)
      .all()

    return rows.map(mapRowToClient)
  }

  findById(id: number): Client | null {
    const row = this.database.orm.select().from(clients).where(eq(clients.id, id)).get()
    return row ? mapRowToClient(row) : null
  }

  insert(input: ClientInput): { id: number } {
    const timestamp = nowIso()
    const [row] = this.database.orm
      .insert(clients)
      .values({
        name: input.name,
        honorific: input.honorific,
        contactPerson: toNullable(input.contactPerson),
        postalCode: toNullable(input.postalCode),
        address: toNullable(input.address),
        phone: toNullable(input.phone),
        email: toNullable(input.email),
        invoiceRegistrationNumber: toNullable(input.invoiceRegistrationNumber),
        memo: toNullable(input.memo),
        status: 'active',
        createdAt: timestamp,
        updatedAt: timestamp
      })
      .returning({ id: clients.id })
      .all()

    if (!row) {
      throw new Error('取引先の登録に失敗しました(idを取得できませんでした)')
    }
    return { id: row.id }
  }

  update(id: number, input: ClientInput): void {
    this.database.orm
      .update(clients)
      .set({
        name: input.name,
        honorific: input.honorific,
        contactPerson: toNullable(input.contactPerson),
        postalCode: toNullable(input.postalCode),
        address: toNullable(input.address),
        phone: toNullable(input.phone),
        email: toNullable(input.email),
        invoiceRegistrationNumber: toNullable(input.invoiceRegistrationNumber),
        memo: toNullable(input.memo),
        updatedAt: nowIso()
      })
      .where(eq(clients.id, id))
      .run()
  }

  updateStatus(id: number, status: ClientStatus): void {
    this.database.orm
      .update(clients)
      .set({ status, updatedAt: nowIso() })
      .where(eq(clients.id, id))
      .run()
  }

  /** バックアップ(エクスポート)用に、状態を問わず全件をid昇順で取得する(詳細設計書4.2章) */
  findAllForBackup(): Client[] {
    const rows = this.database.orm.select().from(clients).orderBy(asc(clients.id)).all()
    return rows.map(mapRowToClient)
  }

  /** 復元処理の全置換で使用する(詳細設計書4.3章手順6) */
  deleteAll(): void {
    this.database.orm.delete(clients).run()
  }

  /** 復元処理で、エクスポートファイルに記録されたidを保持したまま再登録する(詳細設計書4.3章手順6) */
  insertWithId(record: BackupClientRecord): void {
    this.database.orm
      .insert(clients)
      .values({
        id: record.id,
        name: record.name,
        honorific: record.honorific,
        contactPerson: record.contactPerson,
        postalCode: record.postalCode,
        address: record.address,
        phone: record.phone,
        email: record.email,
        invoiceRegistrationNumber: record.invoiceRegistrationNumber,
        memo: record.memo,
        status: record.status,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt
      })
      .run()
  }
}
