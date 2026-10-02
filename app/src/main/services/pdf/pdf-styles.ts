/**
 * 見積書・請求書PDF共通のCSS。
 * 参照元: デザインガイド.md v1.2、mockups/F-12_quote-pdf.html(モノクロ配色、白黒印刷でも視認性を保つ構成)。
 * `webContents.printToPDF()`でA4サイズの紙面としてレンダリングするため、
 * 画面(Renderer)側の6色パレットとは独立したPDF専用の配色を用いる。
 */
export const PDF_STYLES = `
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Helvetica Neue", Arial, sans-serif;
    color: #1A1A1A;
    font-size: 12px;
    line-height: 1.6;
  }
  .page { padding: 0 4px; }
  .doc-meta { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
  .doc-meta-right { text-align: right; font-size: 12px; color: #4D4D4D; }
  .doc-title { text-align: center; font-size: 26px; font-weight: 700; letter-spacing: 0.3em; margin: 8px 0 32px; color: #1A1A1A; }
  .top-block { display: flex; justify-content: space-between; margin-bottom: 28px; }
  .addressee .name { font-size: 17px; font-weight: 700; border-bottom: 1px solid #1A1A1A; padding-bottom: 6px; display: inline-block; min-width: 260px; }
  .issuer { text-align: right; font-size: 11px; color: #1A1A1A; line-height: 1.8; }
  .issuer .issuer-name { font-size: 13px; font-weight: 700; }
  .total-emphasis { border: 2px solid #1A1A1A; padding: 14px 20px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 28px; }
  .total-emphasis .label { font-size: 13px; font-weight: 700; }
  .total-emphasis .value { font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .sub-info-row { display: flex; gap: 40px; margin-bottom: 20px; font-size: 11px; color: #4D4D4D; }
  table.items { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
  table.items th { border-top: 2px solid #1A1A1A; border-bottom: 1px solid #1A1A1A; background: #F2F2F2; padding: 6px 8px; font-size: 10.5px; font-weight: 700; text-align: left; }
  table.items td { border-bottom: 1px solid #CCCCCC; padding: 6px 8px; font-size: 11px; }
  table.items td.num, table.items th.num { text-align: right; font-variant-numeric: tabular-nums; }
  table.items tbody tr:last-child td { border-bottom: 1px solid #1A1A1A; }
  .tax-summary { width: 320px; margin-left: auto; margin-top: 12px; }
  .tax-summary .row { display: flex; justify-content: space-between; padding: 4px 8px; font-size: 11px; border-bottom: 1px solid #CCCCCC; }
  .tax-summary .row.grand { border-bottom: none; border-top: 1px solid #1A1A1A; font-weight: 700; font-size: 12.5px; padding-top: 8px; }
  .remarks-block { margin-top: 32px; }
  .remarks-title { font-size: 11px; font-weight: 700; margin-bottom: 6px; border-bottom: 1px solid #999999; padding-bottom: 4px; }
  .remarks-body { font-size: 11px; color: #1A1A1A; white-space: pre-line; }
  .bottom-columns { display: flex; gap: 40px; margin-top: 32px; }
  .bottom-columns .bank-block { flex: 1; }
  .bottom-columns .remarks-block { flex: 1; margin-top: 0; }
  .bank-block { margin-top: 24px; }
  .bank-title { font-size: 11px; font-weight: 700; margin-bottom: 6px; border-bottom: 1px solid #999999; padding-bottom: 4px; }
  .bank-body { font-size: 11px; color: #1A1A1A; line-height: 1.9; }
  table.items tr { page-break-inside: avoid; }
`
