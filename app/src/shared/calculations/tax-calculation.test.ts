import { describe, expect, it } from 'vitest'
import {
  calculateLineAmount,
  calculateTaxBreakdown,
  calculateWithholdingTax,
  calculateInvoiceWithholdingTax
} from './tax-calculation'

describe('calculateLineAmount', () => {
  it('数量×単価を算出する', () => {
    expect(calculateLineAmount(2, 1000)).toBe(2000)
  })

  it('円未満は切り捨てる', () => {
    expect(calculateLineAmount(1.5, 999)).toBe(1498)
  })

  it('小数第2位までの数量を扱える', () => {
    expect(calculateLineAmount(0.25, 1000)).toBe(250)
  })

  it('浮動小数点誤差が出る組み合わせでも正しい金額になる(I1-01)', () => {
    expect(calculateLineAmount(0.29, 100)).toBe(29)
    expect(calculateLineAmount(0.57, 100)).toBe(57)
    expect(calculateLineAmount(1.15, 100)).toBe(115)
  })

  it('数量(小数第2位まで)×単価の総当たりで整数演算の結果と一致する', () => {
    for (const unitPrice of [1, 7, 100, 999, 1000, 12345]) {
      for (let hundredths = 1; hundredths <= 10000; hundredths++) {
        const expected = Math.floor((hundredths * unitPrice) / 100)
        const quantity = Number((hundredths / 100).toFixed(2))
        expect(calculateLineAmount(quantity, unitPrice)).toBe(expected)
      }
    }
  })
})

describe('calculateTaxBreakdown', () => {
  it('単一の税率区分(10%)の小計・消費税額・合計金額を算出する', () => {
    const result = calculateTaxBreakdown([
      { quantity: 1, unitPrice: 300000, taxRate: 10 },
      { quantity: 1, unitPrice: 30000, taxRate: 10 }
    ])
    expect(result).toEqual({
      subtotal10: 330000,
      taxAmount10: 33000,
      subtotal8: 0,
      taxAmount8: 0,
      totalAmount: 363000
    })
  })

  it('税率区分ごとに小計を分けて集計する', () => {
    const result = calculateTaxBreakdown([
      { quantity: 1, unitPrice: 10000, taxRate: 10 },
      { quantity: 1, unitPrice: 2000, taxRate: 8 }
    ])
    expect(result.subtotal10).toBe(10000)
    expect(result.subtotal8).toBe(2000)
    expect(result.taxAmount10).toBe(1000)
    expect(result.taxAmount8).toBe(160)
    expect(result.totalAmount).toBe(13160)
  })

  it('消費税額は区分ごとに1回のみ、円未満切り捨てで計算する(端数が丸められて累積しない)', () => {
    // 1円の行を11件(小計11円)→ 11×0.1=1.1 を1回だけ切り捨てて1円になることを確認する
    // (行ごとに端数処理すると 1×0.1=0.1→0円 が11回で合計0円になり、区分ごと1回の処理と結果が異なる)
    const lines = Array.from({ length: 11 }, () => ({
      quantity: 1,
      unitPrice: 1,
      taxRate: 10 as const
    }))
    const result = calculateTaxBreakdown(lines)
    expect(result.subtotal10).toBe(11)
    expect(result.taxAmount10).toBe(1)
  })

  it('明細行が0件の場合は全て0を返す', () => {
    expect(calculateTaxBreakdown([])).toEqual({
      subtotal10: 0,
      taxAmount10: 0,
      subtotal8: 0,
      taxAmount8: 0,
      totalAmount: 0
    })
  })
})

describe('calculateWithholdingTax', () => {
  it('100万円以下の場合は floor(金額 × 0.1021) を返す(詳細設計書4.16章)', () => {
    expect(calculateWithholdingTax(300000)).toBe(30630)
    expect(calculateWithholdingTax(0)).toBe(0)
  })

  it('境界値(ちょうど100万円)は100万円以下の式で計算する', () => {
    expect(calculateWithholdingTax(1000000)).toBe(102100)
  })

  it('100万円を超える場合は floor(100万円×0.1021 + (金額-100万円)×0.2042) を返す', () => {
    expect(calculateWithholdingTax(1100000)).toBe(122520)
  })

  it('端数は切り捨てる', () => {
    // 999 × 0.1021 = 101.9979 → 101円
    expect(calculateWithholdingTax(999)).toBe(101)
  })
})

describe('calculateInvoiceWithholdingTax(対象行の合計に1回だけ段階計算)', () => {
  const target = (unitPrice: number, withholdingTarget = true, quantity = 1) => ({
    quantity,
    unitPrice,
    withholdingTarget
  })

  it('対象合計がちょうど100万円の場合は100万円以下の式で計算する', () => {
    expect(calculateInvoiceWithholdingTax([target(500000), target(500000)])).toBe(102100)
  })

  it('対象合計が100万円+1円の場合は超過分に0.2042を適用する', () => {
    expect(calculateInvoiceWithholdingTax([target(500000), target(500001)])).toBe(102100)
    // floor(102,100 + 1 x 0.2042) = 102,100(端数切り捨て)
    expect(calculateInvoiceWithholdingTax([target(1000010)])).toBe(102102)
  })

  it('複数行で合計が100万円超の場合、行ごとではなく合計に段階計算する(80万+80万 → 224,620円)', () => {
    expect(calculateInvoiceWithholdingTax([target(800000), target(800000)])).toBe(224620)
    // 行ごとに計算すると 81,680 x 2 = 163,360 となり異なる
  })

  it('対象外の行は合計に含めない', () => {
    expect(calculateInvoiceWithholdingTax([target(300000), target(900000, false)])).toBe(30630)
  })

  it('対象行がない場合は0', () => {
    expect(calculateInvoiceWithholdingTax([target(300000, false)])).toBe(0)
    expect(calculateInvoiceWithholdingTax([])).toBe(0)
  })
})
