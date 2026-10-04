import { useEffect, useState, type ReactElement } from 'react'
import { AppShell } from '../layout/AppShell'
import { Button, TextLink } from '../components/Button'
import { Badge } from '../components/Badge'
import { Message } from '../components/Message'
import type { InvoiceDetail } from '@shared/types/invoice'
import { INVOICE_MESSAGES, VALIDATION_MESSAGES } from '@shared/messages/messages'
import type { OpenPdfResult } from '@shared/ipc/api'
import { toErrorMessage } from '../utils/error-message'

function todayIsoDate(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

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
  /** 下書きの削除成功時に呼ぶ。省略時は`onBackToList` */
  onDeleted?: () => void
  /** 紐づく入金記録の「入金記録を見る」リンク押下時に、入金記録の詳細画面へ遷移する */
  onOpenCashRecord?: (recordId: number) => void
}

/**
 * 請求書詳細画面[F-14・F-15]
 * 参照元: 基本設計書4.14章、詳細設計書3.14章・4.14・4.15章、5章(クラス設計 `InvoiceDetailPage`)
 *
 * 入金ステータス(未収/入金済み)の変更は、「入金済みにする」(入金日必須)・「未収に戻す」(確認ダイアログ)で行う(F-15)。
 */
export function InvoiceDetailPage({
  invoiceId,
  flashMessage,
  onNavigateHome,
  onNavigateClients,
  onBackToList,
  onEdit,
  onOpenQuote,
  onDeleted,
  onOpenCashRecord
}: InvoiceDetailPageProps): ReactElement {
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [paymentMode, setPaymentMode] = useState<'view' | 'enterDate' | 'confirmUnpaid'>('view')
  const [paymentDate, setPaymentDate] = useState(todayIsoDate())
  const [paymentError, setPaymentError] = useState<string | null>(null)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [paymentNotice, setPaymentNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.jimuhubApi
      .getInvoice(invoiceId)
      .then((result) => {
        if (!cancelled) setInvoice(result)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(toErrorMessage(error, INVOICE_MESSAGES.notFound))
        }
      })
    return () => {
      cancelled = true
    }
  }, [invoiceId])

  async function updatePayment(
    paymentStatus: 'paid' | 'unpaid',
    date: string | null,
    notice: string
  ): Promise<void> {
    setPaymentError(null)
    try {
      await window.jimuhubApi.updateInvoicePaymentStatus(invoiceId, {
        paymentStatus,
        paymentDate: date
      })
      setInvoice(await window.jimuhubApi.getInvoice(invoiceId))
      setPaymentMode('view')
      setPaymentNotice(notice)
    } catch (error) {
      setPaymentMode('view')
      setPaymentError(toErrorMessage(error, INVOICE_MESSAGES.notFound))
    }
  }

  function handleConfirmPaid(): void {
    if (paymentDate.trim() === '') {
      setPaymentError(VALIDATION_MESSAGES.paymentDateRequired)
      return
    }
    void updatePayment('paid', paymentDate, INVOICE_MESSAGES.markAsPaidSuccess)
  }

  const hasWithholding = invoice?.lineItems.some((line) => line.withholdingTarget) ?? false

  /** [F-26]下書きの削除(詳細設計書4.26章) */
  async function handleDeleteDraft(): Promise<void> {
    if (!window.confirm(INVOICE_MESSAGES.confirmDeleteDraft)) return
    try {
      await window.jimuhubApi.deleteInvoiceDraft(invoiceId)
      ;(onDeleted ?? onBackToList)()
    } catch (error) {
      setPdfError(toErrorMessage(error, INVOICE_MESSAGES.notFound))
    }
  }

  async function handlePdfAction(action: (id: number) => Promise<OpenPdfResult>): Promise<void> {
    setPdfError(null)
    const result = await action(invoiceId)
    if (!result.success) {
      setPdfError(result.error)
    }
  }

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
            <>
              <Button onClick={() => onEdit(invoiceId)}>編集</Button>
              <Button onClick={() => void handleDeleteDraft()}>削除</Button>
            </>
          ) : (
            <>
              <Button onClick={() => void handlePdfAction(window.jimuhubApi.openInvoicePdf)}>
                PDFを開く
              </Button>
              <Button
                onClick={() => void handlePdfAction(window.jimuhubApi.showInvoicePdfInFolder)}
              >
                Finderで表示
              </Button>
            </>
          )
        ) : null
      }
      onNavigateHome={onNavigateHome}
      onNavigateClients={onNavigateClients}
    >
      {flashMessage ? <Message variant="success">{flashMessage}</Message> : null}
      {paymentNotice ? <Message variant="success">{paymentNotice}</Message> : null}
      {pdfError ? <Message variant="error">{pdfError}</Message> : null}

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
              {invoice.paymentStatus === 'paid' ? (
                <>
                  {invoice.paymentDate ? (
                    <span className="payment-label">入金日: {invoice.paymentDate}</span>
                  ) : null}
                  <Button
                    style={{ marginLeft: 'auto' }}
                    onClick={() => setPaymentMode('confirmUnpaid')}
                  >
                    未収に戻す
                  </Button>
                </>
              ) : paymentMode === 'enterDate' ? (
                <>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label htmlFor="payment-date">
                      入金日<span className="required">必須</span>
                    </label>
                    <input
                      id="payment-date"
                      type="date"
                      aria-label="入金日"
                      value={paymentDate}
                      onChange={(e) => setPaymentDate(e.target.value)}
                    />
                  </div>
                  <Button
                    variant="primary"
                    style={{ marginLeft: 'auto' }}
                    onClick={handleConfirmPaid}
                  >
                    確定
                  </Button>
                  <Button onClick={() => setPaymentMode('view')}>キャンセル</Button>
                </>
              ) : (
                <Button
                  style={{ marginLeft: 'auto' }}
                  onClick={() => {
                    setPaymentError(null)
                    setPaymentNotice(null)
                    setPaymentMode('enterDate')
                  }}
                >
                  入金済みにする
                </Button>
              )}
            </div>
          ) : null}
          {paymentError ? <Message variant="error">{paymentError}</Message> : null}

          {(invoice.linkedRecords ?? []).length > 0 ? (
            <div className="payment-block" style={{ display: 'block' }}>
              <div className="payment-label" style={{ marginBottom: 8 }}>
                紐づく入金記録
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>入金日</th>
                    <th className="num">金額</th>
                    <th>状態</th>
                    <th className="op">詳細</th>
                  </tr>
                </thead>
                <tbody>
                  {(invoice.linkedRecords ?? []).map((record) => (
                    <tr key={record.id}>
                      <td>{record.recordDate}</td>
                      <td className="num">{`+${formatYen(record.amount)}`}</td>
                      <td>
                        <span
                          className={`badge ${record.status === 'active' ? 'badge-active' : 'badge-cancelled'}`}
                        >
                          {record.status === 'active' ? '有効' : '取消済'}
                        </span>
                      </td>
                      <td className="op">
                        <TextLink onClick={() => onOpenCashRecord?.(record.id)}>
                          入金記録を見る
                        </TextLink>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="back-link">
            <TextLink onClick={onBackToList}>&larr; 一覧へ戻る</TextLink>
          </div>
        </>
      ) : null}
      {paymentMode === 'confirmUnpaid' ? (
        <div className="overlay">
          <div className="modal">
            <h2>{INVOICE_MESSAGES.markAsUnpaidTitle}</h2>
            <p>{INVOICE_MESSAGES.markAsUnpaidDescription}</p>
            <div className="modal-actions">
              <Button onClick={() => setPaymentMode('view')}>いいえ</Button>
              <Button
                variant="primary"
                onClick={() =>
                  void updatePayment('unpaid', null, INVOICE_MESSAGES.markAsUnpaidSuccess)
                }
              >
                はい
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  )
}
