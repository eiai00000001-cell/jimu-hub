import { describe, expect, it } from 'vitest'
import { convertHiraganaToKatakana, isValidFurigana } from './furigana'

describe('convertHiraganaToKatakana', () => {
  it('ひらがなを全角カタカナへ変換する', () => {
    expect(convertHiraganaToKatakana('さんぷる')).toBe('サンプル')
  })

  it('既に全角カタカナの場合はそのまま返す', () => {
    expect(convertHiraganaToKatakana('サンプル')).toBe('サンプル')
  })

  it('ひらがなとカタカナが混在する場合はひらがなのみ変換する', () => {
    expect(convertHiraganaToKatakana('サンプルしょうじ')).toBe('サンプルショウジ')
  })

  it('長音符・カタカナ以外の文字はそのまま維持する', () => {
    expect(convertHiraganaToKatakana('カブシキガイシャABC123')).toBe('カブシキガイシャABC123')
  })

  it('空文字はそのまま返す', () => {
    expect(convertHiraganaToKatakana('')).toBe('')
  })
})

describe('isValidFurigana', () => {
  it('全角カタカナ(長音符含む)を許容する', () => {
    expect(isValidFurigana('サンプルショウジカブシキガイシャ')).toBe(true)
    expect(isValidFurigana('ワカバショウカイ')).toBe(true)
  })

  it('空文字を許容する(任意項目)', () => {
    expect(isValidFurigana('')).toBe(true)
  })

  it('ひらがなが残っている場合は不正とする', () => {
    expect(isValidFurigana('さんぷる')).toBe(false)
  })

  it('半角カナは不正とする', () => {
    expect(isValidFurigana('ｻﾝﾌﾟﾙ')).toBe(false)
  })

  it('漢字・英数字は不正とする', () => {
    expect(isValidFurigana('サンプル商事')).toBe(false)
    expect(isValidFurigana('ABC')).toBe(false)
  })
})
