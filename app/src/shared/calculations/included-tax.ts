import type { TaxCategory } from '../types/cash-record'

/**
 * 税込金額に含まれる消費税額を算出する(円未満切り捨て)。
 * 参照元: 詳細設計書4.18章、基本設計書2.3章★E6。画面表示(Renderer)と保存(Main)で同一実装を使う。
 */
export function calculateIncludedTax(amount: number, taxCategory: TaxCategory | null): number {
  if (taxCategory === 'standard_10') return Math.floor((amount * 10) / 110)
  if (taxCategory === 'reduced_8') return Math.floor((amount * 8) / 108)
  return 0
}
