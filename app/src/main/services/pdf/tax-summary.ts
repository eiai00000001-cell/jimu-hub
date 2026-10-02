import type { TaxBreakdown, TaxRate } from '@shared/calculations/tax-calculation'
import { formatYen } from './format'

/**
 * 見積書・請求書PDF共通: 税率区分(10%/8%)ごとの小計・消費税額の内訳行を組み立てる。
 * 参照元: 基本設計書4.15章「税率区分(10%/8%)ごとの小計・消費税額の内訳」
 *
 * 明細が存在しない税率区分の行は表示しない(インボイス制度上、記載が必要なのは
 * 実際に取引があった税率区分のみのため。ユーザー指摘によりT-20で確定)。
 */
export function renderTaxSummaryRows(breakdown: TaxBreakdown, presentRates: Set<TaxRate>): string {
  const rows: string[] = []
  if (presentRates.has(10)) {
    rows.push(
      `<div class="row"><span>10%対象 小計</span><span>${formatYen(breakdown.subtotal10)}</span></div>`
    )
    rows.push(
      `<div class="row"><span>10%対象 消費税額</span><span>${formatYen(breakdown.taxAmount10)}</span></div>`
    )
  }
  if (presentRates.has(8)) {
    rows.push(
      `<div class="row"><span>8%対象 小計</span><span>${formatYen(breakdown.subtotal8)}</span></div>`
    )
    rows.push(
      `<div class="row"><span>8%対象 消費税額</span><span>${formatYen(breakdown.taxAmount8)}</span></div>`
    )
  }
  return rows.join('\n')
}

/** 明細行の配列から、実際に使用されている税率区分の集合を求める */
export function collectPresentTaxRates(lines: ReadonlyArray<{ taxRate: TaxRate }>): Set<TaxRate> {
  return new Set(lines.map((line) => line.taxRate))
}
