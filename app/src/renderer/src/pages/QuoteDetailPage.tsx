import { useEffect, useState, type ReactElement } from 'react'
import { AppShell } from '../layout/AppShell'
import { Button, TextLink } from '../components/Button'
import { Badge } from '../components/Badge'
import { Message } from '../components/Message'
import type { Quote } from '@shared/types/quote'
import { QUOTE_MESSAGES } from '@shared/messages/messages'
import { toErrorMessage } from '../utils/error-message'

function formatYen(amount: number): string {
  return `¥${amount.toLocaleString('ja-JP')}`
}

interface QuoteDetailPageProps {
  quoteId: number
  flashMessage?: string
  onNavigateHome: () => void
  onNavigateClients: () => void
  onBackToList: () => void
  onEdit: (id: number) => void
  /** 「請求書に変換」成功時に、作成された請求書(下書き)の詳細画面へ遷移する */
  onConvertedToInvoice: (invoiceId: number) => void
}

/**
 * 見積書詳細画面[F-12・F-13]
 * 参照元: 基本設計書4.12章、詳細設計書3.12章・4.12・4.13章、5章(クラス設計 `QuoteDetailPage`)
 */
export function QuoteDetailPage({
  quoteId,
  flashMessage,
  onNavigateHome,
  onNavigateClients,
  onBackToList,
  onEdit,
  onConvertedToInvoice
}: QuoteDetailPageProps): ReactElement {
  const [quote, setQuote] = useState<Quote | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.jimuhubApi
      .getQuote(quoteId)
      .then((result) => {
        if (!cancelled) {
          setQuote(result)
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(toErrorMessage(error, QUOTE_MESSAGES.notFound))
        }
      })
    return () => {
      cancelled = true
    }
  }, [quoteId])

  async function handleOpenPdf(): Promise<void> {
    setActionError(null)
    const result = await window.jimuhubApi.openQuotePdf(quoteId)
    if (!result.success) {
      setActionError(result.error)
    }
  }

  async function handleConvertToInvoice(): Promise<void> {
    setActionError(null)
    try {
      const result = await window.jimuhubApi.convertQuoteToInvoice(quoteId)
      onConvertedToInvoice(result.invoiceId)
    } catch (error) {
      setActionError(toErrorMessage(error, QUOTE_MESSAGES.notFound))
    }
  }

  async function handleShowInFolder(): Promise<void> {
    setActionError(null)
    const result = await window.jimuhubApi.showQuotePdfInFolder(quoteId)
    if (!result.success) {
      setActionError(result.error)
    }
  }

  return (
    <AppShell
      screenName="見積書詳細"
      activeMenu="documents"
      pageTitle="見積書詳細"
      pageTitleExtra={
        quote ? (
          <>
            <Badge variant={quote.status === 'finalized' ? 'finalized' : 'draft'} />
            {quote.pdfHashMismatch ? <Badge variant="warning" /> : null}
          </>
        ) : null
      }
      headerActions={
        quote ? (
          quote.status === 'draft' ? (
            <Button onClick={() => onEdit(quoteId)}>編集</Button>
          ) : (
            <>
              <Button onClick={() => void handleOpenPdf()}>PDFを開く</Button>
              <Button onClick={() => void handleShowInFolder()}>Finderで表示</Button>
              <Button variant="primary" onClick={() => void handleConvertToInvoice()}>
                請求書に変換
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
      {actionError ? <Message variant="error">{actionError}</Message> : null}

      {loadError ? (
        <>
          <Message variant="error">{loadError}</Message>
          <div className="back-link">
            <TextLink onClick={onBackToList}>&larr; 一覧へ戻る</TextLink>
          </div>
        </>
      ) : quote ? (
        <>
          <div className="panel">
            <dl className="info-grid">
              <dt>見積書番号</dt>
              <dd>{quote.quoteNumber ?? '(未採番)'}</dd>
              <dt>取引先</dt>
              <dd>
                {quote.clientName}
                {quote.clientHonorific === '(なし)' ? '' : ` ${quote.clientHonorific}`}
              </dd>
              <dt>発行日</dt>
              <dd>{quote.issueDate}</dd>
              <dt>有効期限</dt>
              <dd>{quote.validUntil ?? ''}</dd>
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
                {quote.lineItems.map((line) => (
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
                <span className="val">{formatYen(quote.subtotal10)}</span>
              </div>
              <div className="totals-row">
                <span>10%対象 消費税額</span>
                <span className="val">{formatYen(quote.taxAmount10)}</span>
              </div>
              <div className="totals-row">
                <span>8%対象 小計</span>
                <span className="val">{formatYen(quote.subtotal8)}</span>
              </div>
              <div className="totals-row">
                <span>8%対象 消費税額</span>
                <span className="val">{formatYen(quote.taxAmount8)}</span>
              </div>
              <div className="totals-row grand">
                <span>合計金額</span>
                <span className="val">{formatYen(quote.totalAmount)}</span>
              </div>
            </div>

            {quote.remarks ? (
              <dl className="info-grid" style={{ marginTop: 24, marginBottom: 0 }}>
                <dt>備考</dt>
                <dd>{quote.remarks}</dd>
              </dl>
            ) : null}
          </div>
          <div className="back-link">
            <TextLink onClick={onBackToList}>&larr; 一覧へ戻る</TextLink>
          </div>
        </>
      ) : null}
    </AppShell>
  )
}
