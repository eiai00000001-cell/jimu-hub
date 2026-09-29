import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { Database } from '../db/db'
import { CompanyProfileRepository } from '../repositories/company-profile.repository'
import { CompanyService } from './company.service'
import type { CompanyProfileInput } from '@shared/schemas/company-profile.schema'

const baseInput: CompanyProfileInput = {
  name: 'サンプル商店 山田太郎',
  address: '東京都千代田区千代田1-1-1',
  invoiceRegistrationNumber: 'T1234567890123',
  bankName: 'サンプル銀行',
  bankBranch: '本店営業部',
  accountType: '普通',
  accountNumber: '1234567',
  accountHolder: 'ヤマダ タロウ'
}

describe('CompanyService', () => {
  let db: Database
  let service: CompanyService

  beforeEach(() => {
    db = new Database(':memory:')
    db.initialize()
    service = new CompanyService(new CompanyProfileRepository(db))
  })

  afterEach(() => {
    db.close()
  })

  it('未設定の場合、getProfileはnullを返す', () => {
    expect(service.getProfile()).toBeNull()
  })

  it('saveProfileで保存した内容をgetProfileで取得できる', () => {
    const result = service.saveProfile(baseInput)
    expect(result).toEqual({ success: true })

    const found = service.getProfile()
    expect(found?.name).toBe('サンプル商店 山田太郎')
  })

  it('saveProfileは必須項目(氏名・屋号)が空欄の場合はエラーを投げる', () => {
    expect(() => service.saveProfile({ ...baseInput, name: '' })).toThrow(
      '氏名・屋号を入力してください'
    )
  })

  it('saveProfileは必須項目(住所)が空欄の場合はエラーを投げる', () => {
    expect(() => service.saveProfile({ ...baseInput, address: '' })).toThrow(
      '住所を入力してください'
    )
  })

  it('saveProfileを複数回実行すると内容が上書きされる', () => {
    service.saveProfile(baseInput)
    service.saveProfile({ ...baseInput, name: '更新後の屋号' })

    expect(service.getProfile()?.name).toBe('更新後の屋号')
  })
})
