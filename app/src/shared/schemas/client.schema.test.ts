import { describe, expect, it } from 'vitest'
import { ClientInputSchema } from './client.schema'

const validInput = {
  name: '株式会社サンプル',
  furigana: 'カブシキガイシャサンプル',
  honorific: '御中',
  contactPerson: '山田太郎',
  postalCode: '123-4567',
  address: '東京都千代田区1-1-1',
  phone: '03-1234-5678',
  email: 'sample@example.com',
  invoiceRegistrationNumber: 'T1234567890123',
  memo: '備考'
}

describe('ClientInputSchema', () => {
  it('正しい入力を受け入れる', () => {
    const result = ClientInputSchema.safeParse(validInput)
    expect(result.success).toBe(true)
  })

  it('取引先名称が空欄の場合はエラーになる', () => {
    const result = ClientInputSchema.safeParse({ ...validInput, name: '' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('取引先名称を入力してください')
    }
  })

  it('取引先名称が空白のみの場合はエラーになる', () => {
    const result = ClientInputSchema.safeParse({ ...validInput, name: '   ' })
    expect(result.success).toBe(false)
  })

  it('取引先名称の前後の空白は除去される', () => {
    const result = ClientInputSchema.safeParse({ ...validInput, name: '  サンプル  ' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe('サンプル')
    }
  })

  it('取引先名称が101文字以上の場合はエラーになる', () => {
    const result = ClientInputSchema.safeParse({ ...validInput, name: 'あ'.repeat(101) })
    expect(result.success).toBe(false)
  })

  it('フリガナが未指定の場合は空文字を既定値にする', () => {
    const { furigana: _furigana, ...rest } = validInput
    const result = ClientInputSchema.safeParse(rest)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.furigana).toBe('')
    }
  })

  it('フリガナのひらがなは全角カタカナへ自動変換される', () => {
    const result = ClientInputSchema.safeParse({ ...validInput, furigana: 'かぶしきがいしゃ' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.furigana).toBe('カブシキガイシャ')
    }
  })

  it('フリガナの前後の空白は除去される', () => {
    const result = ClientInputSchema.safeParse({ ...validInput, furigana: '  サンプル  ' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.furigana).toBe('サンプル')
    }
  })

  it('フリガナに半角カナ・漢字・英数字が含まれる場合はエラーになる', () => {
    const halfWidth = ClientInputSchema.safeParse({ ...validInput, furigana: 'ｻﾝﾌﾟﾙ' })
    expect(halfWidth.success).toBe(false)
    if (!halfWidth.success) {
      expect(halfWidth.error.issues[0]?.message).toBe(
        'フリガナは全角カタカナで入力してください(ひらがなは自動的に変換されます)'
      )
    }

    const kanji = ClientInputSchema.safeParse({ ...validInput, furigana: 'サンプル商事' })
    expect(kanji.success).toBe(false)
  })

  it('フリガナが101文字以上の場合はエラーになる', () => {
    const result = ClientInputSchema.safeParse({ ...validInput, furigana: 'ア'.repeat(101) })
    expect(result.success).toBe(false)
  })

  it('敬称が未指定の場合は(なし)を既定値にする', () => {
    const { honorific: _honorific, ...rest } = validInput
    const result = ClientInputSchema.safeParse(rest)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.honorific).toBe('(なし)')
    }
  })

  it('敬称が列挙値以外の場合はエラーになる', () => {
    const result = ClientInputSchema.safeParse({ ...validInput, honorific: '殿' })
    expect(result.success).toBe(false)
  })

  it('担当者名が51文字以上の場合はエラーになる', () => {
    const result = ClientInputSchema.safeParse({ ...validInput, contactPerson: 'あ'.repeat(51) })
    expect(result.success).toBe(false)
  })

  it('郵便番号に数字・ハイフン以外を含む場合はエラーになる', () => {
    const result = ClientInputSchema.safeParse({ ...validInput, postalCode: '123-abcd' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('半角数字とハイフン')
    }
  })

  it('郵便番号が空欄の場合はエラーにならない', () => {
    const result = ClientInputSchema.safeParse({ ...validInput, postalCode: '' })
    expect(result.success).toBe(true)
  })

  it('住所が201文字以上の場合はエラーになる', () => {
    const result = ClientInputSchema.safeParse({ ...validInput, address: 'あ'.repeat(201) })
    expect(result.success).toBe(false)
  })

  it('電話番号に数字・ハイフン・括弧以外を含む場合はエラーになる', () => {
    const result = ClientInputSchema.safeParse({ ...validInput, phone: '03-1234-5678abc' })
    expect(result.success).toBe(false)
  })

  it('電話番号の括弧表記は許容する', () => {
    const result = ClientInputSchema.safeParse({ ...validInput, phone: '(03)1234-5678' })
    expect(result.success).toBe(true)
  })

  it('メールアドレスの形式が不正な場合はエラーになる', () => {
    const result = ClientInputSchema.safeParse({ ...validInput, email: 'invalid-email' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('メールアドレスの形式が正しくありません')
    }
  })

  it('メールアドレスが空欄の場合はエラーにならない', () => {
    const result = ClientInputSchema.safeParse({ ...validInput, email: '' })
    expect(result.success).toBe(true)
  })

  it('インボイス登録番号は形式を強制せず15文字以上のみエラーになる', () => {
    const okButUnusualFormat = ClientInputSchema.safeParse({
      ...validInput,
      invoiceRegistrationNumber: '登録番号未定'
    })
    expect(okButUnusualFormat.success).toBe(true)

    const tooLong = ClientInputSchema.safeParse({
      ...validInput,
      invoiceRegistrationNumber: 'T12345678901234'
    })
    expect(tooLong.success).toBe(false)
  })

  it('メモが2001文字以上の場合はエラーになる', () => {
    const result = ClientInputSchema.safeParse({ ...validInput, memo: 'あ'.repeat(2001) })
    expect(result.success).toBe(false)
  })
})
