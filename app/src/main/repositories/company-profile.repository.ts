import { eq } from 'drizzle-orm'
import type { Database } from '../db/db'
import { companyProfile } from '../db/schema'
import type { CompanyProfile, AccountType } from '@shared/types/company-profile'
import type { CompanyProfileInput } from '@shared/schemas/company-profile.schema'

type CompanyProfileRow = typeof companyProfile.$inferSelect

const PROFILE_ID = 1

function toNullable(value: string): string | null {
  return value === '' ? null : value
}

function mapRowToProfile(row: CompanyProfileRow): CompanyProfile {
  return {
    name: row.name,
    address: row.address,
    invoiceRegistrationNumber: row.invoiceRegistrationNumber,
    bankName: row.bankName,
    bankBranch: row.bankBranch,
    accountType: row.accountType as AccountType | null,
    accountNumber: row.accountNumber,
    accountHolder: row.accountHolder,
    updatedAt: row.updatedAt
  }
}

function nowIso(): string {
  return new Date().toISOString()
}

/**
 * company_profileテーブル(単一レコード)へのアクセスを担うRepository層。
 * 参照元: 詳細設計書 4.10章、5章(クラス設計 `CompanyProfileRepository`)、6.3章
 */
export class CompanyProfileRepository {
  constructor(private readonly database: Database) {}

  get(): CompanyProfile | null {
    const row = this.database.orm
      .select()
      .from(companyProfile)
      .where(eq(companyProfile.id, PROFILE_ID))
      .get()
    return row ? mapRowToProfile(row) : null
  }

  /** `INSERT ... ON CONFLICT(id) DO UPDATE`により、常にid=1の単一レコードを登録・更新する(詳細設計書4.10章手順5) */
  upsert(input: CompanyProfileInput): void {
    const timestamp = nowIso()
    const values = {
      name: input.name,
      address: input.address,
      invoiceRegistrationNumber: toNullable(input.invoiceRegistrationNumber),
      bankName: toNullable(input.bankName),
      bankBranch: toNullable(input.bankBranch),
      accountType: input.accountType === '' ? null : input.accountType,
      accountNumber: toNullable(input.accountNumber),
      accountHolder: toNullable(input.accountHolder),
      updatedAt: timestamp
    }

    this.database.orm
      .insert(companyProfile)
      .values({ id: PROFILE_ID, ...values })
      .onConflictDoUpdate({ target: companyProfile.id, set: values })
      .run()
  }
}
