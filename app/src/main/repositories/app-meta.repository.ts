import { eq } from 'drizzle-orm'
import type { Database } from '../db/db'
import { appMeta } from '../db/schema'

/**
 * app_metaテーブル(schema_version等)へのアクセスを担うRepository層。
 * 参照元: 詳細設計書 4.1章・4.3章、5章(クラス設計 `AppMetaRepository`)、6.2章
 */
export class AppMetaRepository {
  constructor(private readonly database: Database) {}

  get(key: string): string | null {
    const row = this.database.orm.select().from(appMeta).where(eq(appMeta.key, key)).get()
    return row ? row.value : null
  }

  set(key: string, value: string): void {
    this.database.orm
      .insert(appMeta)
      .values({ key, value })
      .onConflictDoUpdate({ target: appMeta.key, set: { value } })
      .run()
  }
}
