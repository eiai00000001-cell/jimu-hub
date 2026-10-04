import { describe, expect, it } from 'vitest'
import { calculateIncludedTax } from './included-tax'

describe('calculateIncludedTax(詳細設計書4.18章)', () => {
  it('10%は税込額×10/110を切り捨てる', () => {
    expect(calculateIncludedTax(6600, 'standard_10')).toBe(600)
    expect(calculateIncludedTax(3278, 'standard_10')).toBe(298)
    expect(calculateIncludedTax(1, 'standard_10')).toBe(0)
  })
  it('軽減8%は税込額×8/108を切り捨てる', () => {
    expect(calculateIncludedTax(1080, 'reduced_8')).toBe(80)
    expect(calculateIncludedTax(1000, 'reduced_8')).toBe(74)
  })
  it('非課税・対象外・未選択は0', () => {
    expect(calculateIncludedTax(5000, 'tax_exempt')).toBe(0)
    expect(calculateIncludedTax(5000, 'not_applicable')).toBe(0)
    expect(calculateIncludedTax(5000, null)).toBe(0)
  })
  it('上限額でも安全な整数で計算できる', () => {
    expect(calculateIncludedTax(9_999_999_999, 'standard_10')).toBe(909_090_909)
    expect(Number.isSafeInteger(9_999_999_999 * 10)).toBe(true)
  })
})
