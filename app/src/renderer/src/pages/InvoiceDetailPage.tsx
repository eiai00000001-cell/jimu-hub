import { useEffect, useState, type ReactElement } from 'react'
import { AppShell } from '../layout/AppShell'
import { Button, TextLink } from '../components/Button'
import { Badge } from '../components/Badge'
import { Message } from '../components/Message'
import type { Invoice } from '@shared/types/invoice'
import { INVOICE_MESSAGES } from '@shared/messages/messages'

function formatYen(amount: number): string {
  return `¥${amount.toLocaleString('ja-JP')}`
}

interface InvoiceDetailPageProps {
  invoiceId: number
  flashMessage?: string
  onNavigateHome: () => void
  onNavigateClients: () => void
  onBackToList: () => void
  onEdit: (id: number) => void
  /** 「元の見積書」リンク押下時に、変換元の見積書詳細画面へ遷移する */
  onOpenQuote: (quoteId: number) => void
}

/**
 * 請求書詳細画面[F-14・F-15]
 * 参照元: 基本設計書4.14章、詳細設計書3.14章・4.14・4.15章、5章(クラス設計 `InvoiceDetailPage`)
 *
 * 入金ステータスは現在の状態を表示する。「入金済みにする」等の変更操作(T-22)は
 * 実装まで「準備中」表示とする。
 */
export function InvoiceDetailPage({
  invoiceId,
  flashMessage,
  onNavigateHome,
  onNavigateClients,
  onBackToList,
  onEdit,
  onOpenQuote
}: InvoiceDetailPageProps): ReactElement {
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [comingSoon, setComingSoon] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.jimuhubApi
      .getInvoice(invoiceId)
      .then((result) => {
        if (!cancelled) setInvoice(result)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : INVOICE_MESSAGES.notFound)
        }
      })
    return () => {
      cancelled = true
    }
  }, [invoiceId])

  const hasWithholding = invoice?.lineItems.some((line) => line.withholdingTarget) ?? false

  return (
    <AppShell
      screenName="請求書詳細"
      activeMenu="documents"
      pageTitle="請求書詳細"
      pageTitleExtra={
        invoice ? (
          <>
            <Badge variant={invoice.status === 'finalized' ? 'finalized' : 'draft'} />
            {invoice.status === 'finalized' ? (
              <Badge variant={invoice.paymentStatus === 'paid' ? 'paid' : 'unpaid'} />
            ) : null}
            {invoice.pdfHashMismatch ? <Badge variant="warning" /> : null}
          </>
        ) : null
      }
      headerActions={
        invoice ? (
          invoice.status === 'draft' ? (
            <Button onClick={() => onEdit(invoiceId)}>編集</Button>
          ) : (
            <>
              <Button onClick={() => void window.jimuhubApi.openInvoicePdf(invoiceId)}>
                PDFを開く
              </Button>
              <Button onClick={() => void window.jimuhubApi.showInvoicePdfInFolder(invoiceId)}>
                Finderで表示
              </Button>
            </>
          )
        ) : null
      }
      onNavigateHome={onNavigateHome}
      onNavigateClients={onNavigateClients}
      onNavigateDocuments={() => {}}
      onComingSoon={() => {}}
    >
      {flashMessage ? <Message variant="success">{flashMessage}</Message> : null}
      {comingSoon ? (
        <Message variant="warning">
          「入金ステータスの変更」は以降のイテレーションで実装予定です。
        </Message>
      ) : null}

      {loadError ? (
        <>
          <Message variant="error">{loadError}</Message>
          <div className="back-link">
            <TextLink onClick={onBackToList}>&larr; 一覧へ戻る</TextLink>
          </div>
        </>
      ) : invoice ? (
        <>
          <div className="panel">
            <dl className="info-grid">
              <dt>請求書番号</dt>
              <dd>{invoice.invoiceNumber ?? '(未採番)'}</dd>
              <dt>取引先</dt>
              <dd>
                {invoice.clientName}
                {invoice.clientHonorific === '(なし)' ? '' : ` ${invoice.clientHonorific}`}
              </dd>
              <dt>発行日</dt>
              <dd>{invoice.issueDate}</dd>
              <dt>支払期限</dt>
              <dd>{invoice.dueDate ?? ''}</dd>
              {invoice.sourceQuoteId !== null ? (
                <>
                  <dt>元の見積書</dt>
                  <dd>
                    <TextLink onClick={() => onOpenQuote(invoice.sourceQuoteId as number)}>
                      {`${invoice.sourceQuoteNumber ?? '(未採番)'} を見る`}
                    </TextLink>
                  </dd>
                </>
              ) : null}
            </dl>

            <table className="line-table">
              <thead>
                <tr>
                  <th>品名</th>
                  <th>数量</th>
                  <th>単位</th>
                  <th>単価</th>
                  <th>税率</th>
                  <th className="amount">金額</th>
                </tr>
              </thead>
              <tbody>
                {invoice.lineItems.map((line) => (
                  <tr key={line.id}>
                    <td>{line.name}</td>
                    <td>{line.quantity}</td>
                    <td>{line.unit}</td>
                    <td>{formatYen(line.unitPrice)}</td>
                    <td>{line.taxRate}%</td>
                    <td className="amount">{formatYen(line.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="totals-block">
              <div className="totals-row">
                <span>10%対象 小計</span>
                <span className="val">{formatYen(invoice.subtotal10)}</span>
              </div>
              <div className="totals-row">
                <span>10%対象 消費税額</span>
                <span className="val">{formatYen(invoice.taxAmount10)}</span>
              </div>
              <div className="totals-row">
                <span>8%対象 小計</span>
                <span className="val">{formatYen(invoice.subtotal8)}</span>
              </div>
              <div className="totals-row">
                <span>8%対象 消費税額</span>
                <span className="val">{formatYen(invoice.taxAmount8)}</span>
              </div>
              <div className="totals-row">
                <span>合計金額(税込)</span>
                <span className="val">{formatYen(invoice.totalAmount)}</span>
              </div>
              {hasWithholding ? (
                <div className="totals-row">
                  <span>源泉徴収税額(合計)</span>
                  <span className="val">{`-${formatYen(invoice.withholdingTaxAmount)}`}</span>
                </div>
              ) : null}
              <div className="totals-row grand">
                <span>請求金額</span>
                <span className="val">{formatYen(invoice.billingAmount)}</span>
              </div>
            </div>

            {invoice.remarks ? (
              <dl className="info-grid" style={{ marginTop: 24, marginBottom: 0 }}>
                <dt>備考</dt>
                <dd>{invoice.remarks}</dd>
              </dl>
            ) : null}
          </div>

          {invoice.status === 'finalized' ? (
            <div className="payment-block">
              <span className="payment-label">入金ステータス</span>
              <Badge variant={invoice.paymentStatus === 'paid' ? 'paid' : 'unpaid'} />
              {invoice.paymentStatus === 'paid' && invoice.paymentDate ? (
                <span className="payment-label">入金日: {invoice.paymentDate}</span>
              ) : null}
              <Button style={{ marginLeft: 'auto' }} onClick={() => setComingSoon(true)}>
                {invoice.paymentStatus === 'paid' ? '未収に戻す' : '入金済みにする'}
              </Button>
            </div>
          ) : null}

          <div className="back-link">
            <TextLink onClick={onBackToList}>&larr; 一覧へ戻る</TextLink>
          </div>
        </>
      ) : null}
    </AppShell>
  )
}
