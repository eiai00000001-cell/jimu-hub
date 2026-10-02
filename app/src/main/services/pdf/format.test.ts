import { describe, expect, it } from 'vitest'
import {
  escapeHtml,
  formatYen,
  formatQuantity,
  formatDateJapanese,
  sanitizeFileNamePart
} from './format'

describe('escapeHtml', () => {
  it('HTMLの特殊文字をエスケープする', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'
    )
  })

  it('&・<・>・"・\'をエスケープする', () => {
    expect(escapeHtml(`A&B<C>D"E'F`)).toBe('A&amp;B&lt;C&gt;D&quot;E&#39;F')
  })
})

describe('formatYen', () => {
  it('3桁区切りのカンマと¥記号を付与する', () => {
    expect(formatYen(363000)).toBe('¥363,000')
  })

  it('0円も整形できる', () => {
    expect(formatYen(0)).toBe('¥0')
  })
})

describe('formatQuantity', () => {
  it('整数はそのまま表示する', () => {
    expect(formatQuantity(1)).toBe('1')
  })

  it('小数は最大2桁まで表示する', () => {
    expect(formatQuantity(1.5)).toBe('1.5')
    expect(formatQuantity(1.25)).toBe('1.25')
  })
})

describe('formatDateJapanese', () => {
  it('YYYY-MM-DDをYYYY年M月D日形式に変換する', () => {
    expect(formatDateJapanese('2026-09-20')).toBe('2026年9月20日')
  })

  it('月日が1桁の場合も0埋めせず表示する', () => {
    expect(formatDateJapanese('2026-01-05')).toBe('2026年1月5日')
  })

  it('不正な値でもHTMLをエスケープして返す(I1-02)', () => {
    expect(formatDateJapanese('<img src=x>')).toBe('&lt;img src=x&gt;')
    expect(formatDateJapanese('2026-<b>-01')).not.toContain('<b>')
  })
})

describe('sanitizeFileNamePart', () => {
  it('スラッシュ・コロンをアンダースコアへ置換する', () => {
    expect(sanitizeFileNamePart('サンプル/商事:株式会社')).toBe('サンプル_商事_株式会社')
  })

  it('前後の空白を除去する', () => {
    expect(sanitizeFileNamePart('  サンプル商事  ')).toBe('サンプル商事')
  })
})
