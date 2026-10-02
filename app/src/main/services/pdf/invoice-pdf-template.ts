import type { Invoice } from '@shared/types/invoice'
import type { CompanyProfile } from '@shared/types/company-profile'
import { PDF_STYLES } from './pdf-styles'
import { escapeHtml, formatDateJapanese, formatQuantity, formatYen } from './format'
import { collectPresentTaxRates, renderTaxSummaryRows } from './tax-summary'

function renderAddressee(invoice: Invoice): string {
  const suffix =
    invoice.clientHonorific === '(なし)' ? '' : ` ${escapeHtml(invoice.clientHonorific)}`
  return `${escapeHtml(invoice.clientName)}${suffix}`
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

/** 振込先(銀行名・支店名・口座種別・口座番号・口座名義)のうち入力のある項目のみを行にする。全て未入力なら空文字 */
function renderBankBlock(companyProfile: CompanyProfile): string {
  const bankLine = [companyProfile.bankName, companyProfile.bankBranch]
    .filter((v): v is string => Boolean(v))
    .map(escapeHtml)
    .join(' ')
  const accountLine = [companyProfile.accountType, companyProfile.accountNumber]
    .filter((v): v is string => Boolean(v))
    .map(escapeHtml)
    .join(' ')
  const holderLine = companyProfile.accountHolder ? escapeHtml(companyProfile.accountHolder) : ''
  const lines = [bankLine, accountLine, holderLine].filter((line) => line !== '')
  if (lines.length === 0) {
    return ''
  }
  return `
      <div class="bank-block">
        <div class="bank-title">お振込先</div>
        <div class="bank-body">${lines.join('<br>')}</div>
      </div>
  `
}

function renderRemarksBlock(invoice: Invoice): string {
  if (!invoice.remarks) {
    return ''
  }
  return `
      <div class="remarks-block">
        <div class="remarks-title">備考</div>
        <div class="remarks-body">${escapeHtml(invoice.remarks)}</div>
      </div>
  `
}

/**
 * 請求書PDFのHTMLを組み立てる。
 * 参照元: 基本設計書4.15章、mockups/F-14_invoice-pdf.html
 *
 * 源泉徴収対象の明細行がある場合のみ「源泉徴収税額」列・内訳行を表示し、
 * 振込先は入力のある項目のみを表示する(全て未入力なら「お振込先」ブロック自体を出力しない)。
 */
export function buildInvoicePdfHtml(invoice: Invoice, companyProfile: CompanyProfile): string {
  const hasWithholding = invoice.lineItems.some((line) => line.withholdingTarget)
  const dueDateRow = invoice.dueDate
    ? `<div class="sub-info-row"><div>支払期限: ${formatDateJapanese(invoice.dueDate)}</div></div>`
    : ''

  const nameWidth = 38
  const amountWidth = 20

  const rows = invoice.lineItems
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

  const withholdingSummaryRow = hasWithholding
    ? `<div class="row"><span>源泉徴収税額(合計)</span><span>−${formatYen(invoice.withholdingTaxAmount)}</span></div>`
    : ''

  const bankBlock = renderBankBlock(companyProfile)
  const remarksBlock = renderRemarksBlock(invoice)
  const bottomColumns =
    bankBlock || remarksBlock ? `<div class="bottom-columns">${bankBlock}${remarksBlock}</div>` : ''

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
        発行日: ${formatDateJapanese(invoice.issueDate)}<br>
        請求書番号: ${escapeHtml(invoice.invoiceNumber ?? '')}
      </div>
    </div>
    <div class="doc-title">御 請 求 書</div>

    <div class="top-block">
      <div class="addressee">
        <div class="name">${renderAddressee(invoice)}</div>
      </div>
      ${renderIssuer(companyProfile)}
    </div>

    <div class="total-emphasis">
      <span class="label">ご請求金額</span>
      <span class="value">${formatYen(invoice.billingAmount)}</span>
    </div>

    ${dueDateRow}

    <table class="items">
      <thead>
        <tr>
          <th style="width:${nameWidth}%;">品名</th>
          <th class="num" style="width:8%;">数量</th>
          <th style="width:7%;">単位</th>
          <th class="num" style="width:13%;">単価</th>
          <th class="num" style="width:8%;">税率</th>
          <th class="num" style="width:${amountWidth}%;">金額</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>

    <div class="tax-summary">
      ${renderTaxSummaryRows(invoice, collectPresentTaxRates(invoice.lineItems))}
      <div class="row"><span>合計金額(税込)</span><span>${formatYen(invoice.totalAmount)}</span></div>
      ${withholdingSummaryRow}
      <div class="row grand"><span>ご請求金額</span><span>${formatYen(invoice.billingAmount)}</span></div>
    </div>

    ${bottomColumns}
  </div>
</body>
</html>`
}
