import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { Database } from '../db/db'
import { CompanyProfileRepository } from './company-profile.repository'
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

describe('CompanyProfileRepository', () => {
  let db: Database
  let repository: CompanyProfileRepository

  beforeEach(() => {
    db = new Database(':memory:')
    db.initialize()
    repository = new CompanyProfileRepository(db)
  })

  afterEach(() => {
    db.close()
  })

  it('未設定の場合、getはnullを返す', () => {
    expect(repository.get()).toBeNull()
  })

  it('upsertで登録した内容をgetで取得できる', () => {
    repository.upsert(baseInput)
    const found = repository.get()

    expect(found).not.toBeNull()
    expect(found?.name).toBe('サンプル商店 山田太郎')
    expect(found?.address).toBe('東京都千代田区千代田1-1-1')
    expect(found?.invoiceRegistrationNumber).toBe('T1234567890123')
    expect(found?.bankName).toBe('サンプル銀行')
    expect(found?.accountType).toBe('普通')
    expect(found?.updatedAt).toEqual(expect.any(String))
  })

  it('任意項目が空欄の場合はnullとして保存される', () => {
    repository.upsert({
      ...baseInput,
      invoiceRegistrationNumber: '',
      bankName: '',
      bankBranch: '',
      accountType: '',
      accountNumber: '',
      accountHolder: ''
    })
    const found = repository.get()

    expect(found?.invoiceRegistrationNumber).toBeNull()
    expect(found?.bankName).toBeNull()
    expect(found?.accountType).toBeNull()
  })

  it('upsertを複数回実行すると、常に単一レコード(id=1)のまま内容が更新される', () => {
    repository.upsert(baseInput)
    repository.upsert({ ...baseInput, name: '更新後の屋号' })

    const found = repository.get()
    expect(found?.name).toBe('更新後の屋号')

    const count = db.sqlite.prepare('SELECT COUNT(*) as count FROM company_profile').get() as {
      count: number
    }
    expect(count.count).toBe(1)
  })
})
