import type { Quote } from '@shared/types/quote'
import type { CompanyProfile } from '@shared/types/company-profile'
import { PDF_STYLES } from './pdf-styles'
import { escapeHtml, formatDateJapanese, formatQuantity, formatYen } from './format'
import { collectPresentTaxRates, renderTaxSummaryRows } from './tax-summary'

function renderAddressee(quote: Quote): string {
  const suffix = quote.clientHonorific === '(なし)' ? '' : ` ${escapeHtml(quote.clientHonorific)}`
  return `${escapeHtml(quote.clientName)}${suffix}`
}

function renderIssuer(companyProfile: CompanyProfile): string {
  const registrationLine = companyProfile.invoiceRegistrationNumber
    ? `登録番号: ${escapeHtml(companyProfile.invoiceRegistrationNumber)}<br>`
    : ''
  return `
    <div class="issuer">
      <div class="issuer-name">${escapeHtml(companyProfile.name)}</div>
      ${escapeHtml(companyProfile.address)}<br>
      ${registrationLine}
    </div>
  `
}

function renderLineItemRows(quote: Quote): string {
  return quote.lineItems
    .map(
      (line) => `
        <tr>
          <td>${escapeHtml(line.name)}</td>
          <td class="num">${formatQuantity(line.quantity)}</td>
          <td>${escapeHtml(line.unit ?? '')}</td>
          <td class="num">${formatQuantity(line.unitPrice)}</td>
          <td class="num">${line.taxRate}%</td>
          <td class="num">${formatQuantity(line.amount)}</td>
        </tr>
      `
    )
    .join('')
}

/**
 * 見積書PDFのHTMLを組み立てる。
 * 参照元: 基本設計書4.15章、mockups/F-12_quote-pdf.html
 *
 * `webContents.printToPDF()`でA4 PDF化する前提のHTML/CSSであり、
 * Renderer側の画面表示用コンポーネント(QuoteFormPage等)とは独立したPDF専用テンプレートである
 * (コーディング規約.md 7.1章、PdfService参照)。
 */
export function buildQuotePdfHtml(quote: Quote, companyProfile: CompanyProfile): string {
  const validUntilRow = quote.validUntil
    ? `<div class="sub-info-row"><div>有効期限: ${formatDateJapanese(quote.validUntil)}</div></div>`
    : ''
  const remarksBlock = quote.remarks
    ? `
      <div class="remarks-block">
        <div class="remarks-title">備考</div>
        <div class="remarks-body">${escapeHtml(quote.remarks)}</div>
      </div>
    `
    : ''

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<style>${PDF_STYLES}</style>
</head>
<body>
  <div class="page">
    <div class="doc-meta">
      <div></div>
      <div class="doc-meta-right">
        発行日: ${formatDateJapanese(quote.issueDate)}<br>
        見積書番号: ${escapeHtml(quote.quoteNumber ?? '')}
      </div>
    </div>
    <div class="doc-title">御 見 積 書</div>

    <div class="top-block">
      <div class="addressee">
        <div class="name">${renderAddressee(quote)}</div>
      </div>
      ${renderIssuer(companyProfile)}
    </div>

    <div class="total-emphasis">
      <span class="label">御見積金額(税込)</span>
      <span class="value">${formatYen(quote.totalAmount)}</span>
    </div>

    ${validUntilRow}

    <table class="items">
      <thead>
        <tr>
          <th style="width:38%;">品名</th>
          <th class="num" style="width:10%;">数量</th>
          <th style="width:8%;">単位</th>
          <th class="num" style="width:15%;">単価</th>
          <th class="num" style="width:9%;">税率</th>
          <th class="num" style="width:20%;">金額</th>
        </tr>
      </thead>
      <tbody>
        ${renderLineItemRows(quote)}
      </tbody>
    </table>

    <div class="tax-summary">
      ${renderTaxSummaryRows(quote, collectPresentTaxRates(quote.lineItems))}
      <div class="row grand"><span>合計金額</span><span>${formatYen(quote.totalAmount)}</span></div>
    </div>

    ${remarksBlock}
  </div>
</body>
</html>`
}
