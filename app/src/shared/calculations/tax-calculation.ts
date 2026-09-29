/**
 * 消費税額の計算ロジック(共有関数)。
 * 参照元: 詳細設計書4.12章手順2、5章(クラス設計 `TaxCalculationService`)、基本設計書2.2章
 *
 * Renderer(画面の即時再計算)・Main(`QuoteService`/`InvoiceService`確定処理)の双方が
 * この同一実装を参照することで、両者の計算結果を一致させる(コーディング規約.md 3章参照)。
 */

export const TAX_RATES = [10, 8] as const
export type TaxRate = (typeof TAX_RATES)[number]

export interface LineItemForTaxCalculation {
  quantity: number
  unitPrice: number
  taxRate: TaxRate
}

export interface TaxBreakdown {
  subtotal10: number
  taxAmount10: number
  subtotal8: number
  taxAmount8: number
  totalAmount: number
}

/** 明細行の金額(数量×単価、円未満切り捨て)を算出する */
export function calculateLineAmount(quantity: number, unitPrice: number): number {
  return Math.floor(quantity * unitPrice)
}

/**
 * 明細行群から、税率区分(10%/8%)ごとの小計・消費税額と合計金額を算出する。
 * 消費税額は区分ごとに1回のみ、円未満切り捨てで計算する(基本設計書2.2章)。
 */
export function calculateTaxBreakdown(lines: LineItemForTaxCalculation[]): TaxBreakdown {
  let subtotal10 = 0
  let subtotal8 = 0

  for (const line of lines) {
    const amount = calculateLineAmount(line.quantity, line.unitPrice)
    if (line.taxRate === 10) {
      subtotal10 += amount
    } else {
      subtotal8 += amount
    }
  }

  const taxAmount10 = Math.floor(subtotal10 * 0.1)
  const taxAmount8 = Math.floor(subtotal8 * 0.08)
  const totalAmount = subtotal10 + taxAmount10 + subtotal8 + taxAmount8

  return { subtotal10, taxAmount10, subtotal8, taxAmount8, totalAmount }
}

const WITHHOLDING_THRESHOLD = 1_000_000
const WITHHOLDING_RATE_UNDER_THRESHOLD = 0.1021
const WITHHOLDING_RATE_OVER_THRESHOLD = 0.2042

/**
 * 明細行(税抜金額)ごとの源泉徴収税額を算出する(詳細設計書4.16章、要件定義書10.2章R-11)。
 * 円未満切り捨てで、行ごとに計算する(基本設計書2.2章)。
 */
export function calculateWithholdingTax(amount: number): number {
  if (amount <= WITHHOLDING_THRESHOLD) {
    return Math.floor(amount * WITHHOLDING_RATE_UNDER_THRESHOLD)
  }
  return Math.floor(
    WITHHOLDING_THRESHOLD * WITHHOLDING_RATE_UNDER_THRESHOLD +
      (amount - WITHHOLDING_THRESHOLD) * WITHHOLDING_RATE_OVER_THRESHOLD
  )
}
