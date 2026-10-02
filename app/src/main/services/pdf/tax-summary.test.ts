import { describe, expect, it } from 'vitest'
import { renderTaxSummaryRows, collectPresentTaxRates } from './tax-summary'

const breakdown = {
  subtotal10: 330000,
  taxAmount10: 33000,
  subtotal8: 2000,
  taxAmount8: 160,
  totalAmount: 365160
}

describe('collectPresentTaxRates', () => {
  it('明細行に出現する税率の集合を返す', () => {
    expect(collectPresentTaxRates([{ taxRate: 10 }, { taxRate: 10 }, { taxRate: 8 }])).toEqual(
      new Set([10, 8])
    )
  })
})

describe('renderTaxSummaryRows', () => {
  it('10%・8%の両方に明細がある場合は両方の行を表示する', () => {
    const html = renderTaxSummaryRows(breakdown, new Set([10, 8]))
    expect(html).toContain('10%対象 小計')
    expect(html).toContain('8%対象 小計')
  })

  it('8%の明細が無い場合は8%対象の行を表示しない', () => {
    const html = renderTaxSummaryRows(breakdown, new Set([10]))
    expect(html).toContain('10%対象 小計')
    expect(html).not.toContain('8%対象 小計')
    expect(html).not.toContain('8%対象 消費税額')
  })

  it('10%の明細が無い場合は10%対象の行を表示しない', () => {
    const html = renderTaxSummaryRows(breakdown, new Set([8]))
    expect(html).not.toContain('10%対象 小計')
    expect(html).not.toContain('10%対象 消費税額')
    expect(html).toContain('8%対象 小計')
  })
})
