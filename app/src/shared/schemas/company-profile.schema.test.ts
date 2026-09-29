import { describe, expect, it } from 'vitest'
import { CompanyProfileInputSchema } from './company-profile.schema'

const validInput = {
  name: 'サンプル商店 山田太郎',
  address: '東京都千代田区千代田1-1-1',
  invoiceRegistrationNumber: 'T1234567890123',
  bankName: 'サンプル銀行',
  bankBranch: '本店営業部',
  accountType: '普通',
  accountNumber: '1234567',
  accountHolder: 'ヤマダ タロウ'
}

describe('CompanyProfileInputSchema', () => {
  it('正しい入力を受け入れる', () => {
    const result = CompanyProfileInputSchema.safeParse(validInput)
    expect(result.success).toBe(true)
  })

  it('氏名・屋号が空欄の場合はエラーになる', () => {
    const result = CompanyProfileInputSchema.safeParse({ ...validInput, name: '' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('氏名・屋号を入力してください')
    }
  })

  it('氏名・屋号の前後の空白は除去される', () => {
    const result = CompanyProfileInputSchema.safeParse({ ...validInput, name: '  サンプル  ' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe('サンプル')
    }
  })

  it('氏名・屋号が101文字以上の場合はエラーになる', () => {
    const result = CompanyProfileInputSchema.safeParse({ ...validInput, name: 'あ'.repeat(101) })
    expect(result.success).toBe(false)
  })

  it('住所が空欄の場合はエラーになる', () => {
    const result = CompanyProfileInputSchema.safeParse({ ...validInput, address: '' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('住所を入力してください')
    }
  })

  it('住所が201文字以上の場合はエラーになる', () => {
    const result = CompanyProfileInputSchema.safeParse({
      ...validInput,
      address: 'あ'.repeat(201)
    })
    expect(result.success).toBe(false)
  })

  it('インボイス登録番号は形式を強制せず15文字以上のみエラーになる', () => {
    const okButUnusualFormat = CompanyProfileInputSchema.safeParse({
      ...validInput,
      invoiceRegistrationNumber: '登録番号未定'
    })
    expect(okButUnusualFormat.success).toBe(true)

    const tooLong = CompanyProfileInputSchema.safeParse({
      ...validInput,
      invoiceRegistrationNumber: 'T12345678901234'
    })
    expect(tooLong.success).toBe(false)
  })

  it('口座種別は未選択(空文字)・普通・当座のいずれかのみ許容する', () => {
    const unselected = CompanyProfileInputSchema.safeParse({ ...validInput, accountType: '' })
    expect(unselected.success).toBe(true)

    const invalid = CompanyProfileInputSchema.safeParse({ ...validInput, accountType: '定期' })
    expect(invalid.success).toBe(false)
  })

  it('口座種別が未指定の場合は空文字(未選択)を既定値にする', () => {
    const { accountType: _accountType, ...rest } = validInput
    const result = CompanyProfileInputSchema.safeParse(rest)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.accountType).toBe('')
    }
  })

  it('口座番号が11文字以上の場合はエラーになる', () => {
    const result = CompanyProfileInputSchema.safeParse({
      ...validInput,
      accountNumber: '12345678901'
    })
    expect(result.success).toBe(false)
  })

  it('振込先銀行名・支店名・口座番号・口座名義が空欄の場合はエラーにならない(任意項目)', () => {
    const result = CompanyProfileInputSchema.safeParse({
      ...validInput,
      bankName: '',
      bankBranch: '',
      accountType: '',
      accountNumber: '',
      accountHolder: ''
    })
    expect(result.success).toBe(true)
  })
})
