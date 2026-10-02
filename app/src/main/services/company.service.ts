import {
  CompanyProfileInputSchema,
  type CompanyProfileInput
} from '@shared/schemas/company-profile.schema'
import type { CompanyProfile } from '@shared/types/company-profile'
import type { CompanyProfileRepository } from '../repositories/company-profile.repository'

function parseOrThrow(input: CompanyProfileInput): CompanyProfileInput {
  const result = CompanyProfileInputSchema.safeParse(input)
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? 'Invalid input')
  }
  return result.data
}

/**
 * 自社情報・振込先の取得・保存を担うApplication Service層。
 * 参照元: 詳細設計書 4.10章、5章(クラス設計 `CompanyService`)
 */
export class CompanyService {
  constructor(private readonly repository: CompanyProfileRepository) {}

  getProfile(): CompanyProfile | null {
    return this.repository.get()
  }

  saveProfile(input: CompanyProfileInput): { success: true } {
    const validated = parseOrThrow(input)
    this.repository.upsert(validated)
    return { success: true }
  }
}
