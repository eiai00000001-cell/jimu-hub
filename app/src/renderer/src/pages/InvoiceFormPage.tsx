import { useEffect, useState, type ReactElement } from 'react'
import { AppShell } from '../layout/AppShell'
import { Button, TextLink } from '../components/Button'
import { Message } from '../components/Message'
import { TextAreaField } from '../components/FormField'
import { QuickClientRegisterModal } from '../components/QuickClientRegisterModal'
import {
  InvoiceInputSchema,
  type InvoiceInput,
  type InvoiceLineItemInput
} from '@shared/schemas/invoice.schema'
import {
  calculateLineAmount,
  calculateTaxBreakdown,
  calculateInvoiceWithholdingTax
} from '@shared/calculations/tax-calculation'
import { INVOICE_MESSAGES, VALIDATION_MESSAGES } from '@shared/messages/messages'
import type { CompanyProfile } from '@shared/types/company-profile'
import { toErrorMessage } from '../utils/error-message'

interface ClientOption {
  id: number
  name: string
}

type LineItemFormRow = {
  name: string
  quantity: string
  unit: string
  unitPrice: string
  taxRate: 10 | 8
  withholdingTarget: boolean
}

const EMPTY_ROW: LineItemFormRow = {
  name: '',
  quantity: '1',
  unit: '',
  unitPrice: '0',
  taxRate: 10,
  withholdingTarget: false
}

function todayIsoDate(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function toLineItemInputs(rows: LineItemFormRow[]): InvoiceLineItemInput[] {
  return rows.map((row) => ({
    name: row.name,
    quantity: Number(row.quantity),
    unit: row.unit,
    unitPrice: Number(row.unitPrice),
    taxRate: row.taxRate,
    withholdingTarget: row.withholdingTarget
  }))
}

interface RowErrors {
  name?: string
  quantity?: string
  unitPrice?: string
}

interface FormErrors {
  clientId?: string
  issueDate?: string
  lineItems?: string
  remarks?: string
  rows: RowErrors[]
}

interface InvoiceFormPageProps {
  mode: 'new' | 'edit'
  invoiceId?: number
  /** 自社情報・振込先設定画面から遷移元へ戻ってきた際の完了メッセージ(詳細設計書4.10章手順6) */
  flashMessage?: string
  onSavedDraft: (id: number) => void
  onFinalized: (id: number) => void
  onCancel: () => void
  onNavigateCompanyProfile: () => void
  /** 変換元の見積書がある場合の「元の見積書を見る」リンク押下時 */
  onOpenSourceQuote?: (quoteId: number) => void
}

/**
 * 請求書作成画面[F-11・F-13・F-14・F-16](新規作成・編集共通)
 * 参照元: 基本設計書4.13章、詳細設計書3.13章・4.14・4.16章、5章(クラス設計 `InvoiceFormPage`)
 *
 * 見積書からの変換(F-13)で作成された請求書は、元の見積書へのリンクを画面上部に表示する。
 */
export function InvoiceFormPage({
  mode,
  invoiceId,
  flashMessage,
  onSavedDraft,
  onFinalized,
  onCancel,
  onNavigateCompanyProfile,
  onOpenSourceQuote
}: InvoiceFormPageProps): ReactElement {
  const [clientId, setClientId] = useState<number | ''>('')
  const [clients, setClients] = useState<ClientOption[]>([])
  const [issueDate, setIssueDate] = useState(todayIsoDate())
  const [dueDate, setDueDate] = useState('')
  const [source, setSource] = useState<{ id: number; number: string | null } | null>(null)
  const [remarks, setRemarks] = useState('')
  const [rows, setRows] = useState<LineItemFormRow[]>([{ ...EMPTY_ROW }])
  const [errors, setErrors] = useState<FormErrors>({ rows: [] })
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile | null | undefined>(undefined)
  const [showQuickRegister, setShowQuickRegister] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [finalizedNotice, setFinalizedNotice] = useState(false)

  useEffect(() => {
    window.jimuhubApi.listClients({ statusFilter: 'active' }).then(setClients)
    window.jimuhubApi.getCompanyProfile().then(setCompanyProfile)
  }, [])

  useEffect(() => {
    if (mode !== 'edit' || invoiceId === undefined) {
      return
    }
    window.jimuhubApi
      .getInvoice(invoiceId)
      .then((invoice) => {
        if (invoice.status === 'finalized') {
          setFinalizedNotice(true)
          return
        }
        setSource(
          invoice.sourceQuoteId === null
            ? null
            : { id: invoice.sourceQuoteId, number: invoice.sourceQuoteNumber }
        )
        setClientId(invoice.clientId)
        setIssueDate(invoice.issueDate)
        setDueDate(invoice.dueDate ?? '')
        setRemarks(invoice.remarks ?? '')
        setRows(
          invoice.lineItems.map((line) => ({
            name: line.name,
            quantity: String(line.quantity),
            unit: line.unit ?? '',
            unitPrice: String(line.unitPrice),
            taxRate: line.taxRate,
            withholdingTarget: line.withholdingTarget
          }))
        )
      })
      .catch((error: unknown) => {
        setLoadError(toErrorMessage(error, INVOICE_MESSAGES.notFound))
      })
  }, [mode, invoiceId])

  function updateRow<K extends keyof LineItemFormRow>(
    index: number,
    key: K,
    value: LineItemFormRow[K]
  ): void {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, [key]: value } : row)))
  }

  function addRow(): void {
    setRows((prev) => [...prev, { ...EMPTY_ROW }])
  }

  function removeRow(index: number): void {
    setRows((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev))
  }

  function buildInput(): InvoiceInput {
    return {
      clientId: clientId === '' ? 0 : clientId,
      issueDate,
      dueDate,
      remarks,
      lineItems: toLineItemInputs(rows)
    }
  }

  function validate(): InvoiceInput | null {
    const result = InvoiceInputSchema.safeParse(buildInput())
    if (result.success) {
      setErrors({ rows: [] })
      return result.data
    }

    const nextErrors: FormErrors = { rows: rows.map(() => ({})) }
    for (const issue of result.error.issues) {
      const [field, index, rowField] = issue.path
      if (field === 'lineItems' && typeof index === 'number') {
        const target = nextErrors.rows[index]
        if (target && typeof rowField === 'string' && !(rowField in target)) {
          ;(target as Record<string, string>)[rowField] = issue.message
        }
      } else if (field === 'lineItems') {
        nextErrors.lineItems = issue.message
      } else if (typeof field === 'string' && !(field in nextErrors)) {
        ;(nextErrors as unknown as Record<string, string>)[field] = issue.message
      }
    }
    setErrors(nextErrors)
    return null
  }

  async function handleSaveDraft(): Promise<void> {
    const validated = validate()
    if (!validated) {
      return
    }
    setSubmitError(null)
    setSubmitting(true)
    try {
      const result = await window.jimuhubApi.saveInvoiceDraft({
        id: mode === 'edit' ? invoiceId : undefined,
        ...validated
      })
      onSavedDraft(result.id)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleFinalize(): Promise<void> {
    const validated = validate()
    if (!validated) {
      return
    }
    if (!companyProfile) {
      setSubmitError(INVOICE_MESSAGES.companyProfileNotSet)
      return
    }
    setSubmitError(null)
    setSubmitting(true)
    try {
      const result = await window.jimuhubApi.finalizeInvoice({
        id: mode === 'edit' ? invoiceId : undefined,
        ...validated
      })
      onFinalized(result.id)
    } catch (error) {
      setSubmitError(toErrorMessage(error, INVOICE_MESSAGES.pdfSaveFailure))
    } finally {
      setSubmitting(false)
    }
  }

  const lineItemInputs = toLineItemInputs(rows)
  const breakdown = calculateTaxBreakdown(lineItemInputs)
  const lineAmounts = rows.map((row) =>
    calculateLineAmount(Number(row.quantity) || 0, Number(row.unitPrice) || 0)
  )
  // 源泉徴収税額は対象行の税抜金額合計に対して1回だけ段階計算する(行ごとには算出しない)
  const withholdingTotal = calculateInvoiceWithholdingTax(lineItemInputs)
  const billingAmount = breakdown.totalAmount - withholdingTotal
  const dueDateWarning =
    dueDate !== '' && issueDate !== '' && dueDate < issueDate
      ? VALIDATION_MESSAGES.validUntilBeforeIssueDate
      : undefined

  const bankSummary = companyProfile
    ? [
        companyProfile.bankName,
        companyProfile.bankBranch,
        companyProfile.accountType,
        companyProfile.accountNumber,
        companyProfile.accountHolder
      ]
        .filter(Boolean)
        .join(' ')
    : ''

  if (loadError) {
    return (
      <AppShell
        screenName="請求書を作成"
        activeMenu="documents"
        pageTitle="請求書を作成"
        onNavigateHome={() => {}}
        onNavigateClients={() => {}}
        onNavigateDocuments={() => {}}
        onComingSoon={() => {}}
      >
        <Message variant="error">{loadError}</Message>
        <div className="back-link">
          <TextLink onClick={onCancel}>&larr; 一覧へ戻る</TextLink>
        </div>
      </AppShell>
    )
  }

  if (finalizedNotice) {
    return (
      <AppShell
        screenName="請求書を作成"
        activeMenu="documents"
        pageTitle="請求書を作成"
        onNavigateHome={() => {}}
        onNavigateClients={() => {}}
        onNavigateDocuments={() => {}}
        onComingSoon={() => {}}
      >
        <Message variant="error">{INVOICE_MESSAGES.finalizedNotEditable}</Message>
        <div className="back-link">
          <TextLink onClick={onCancel}>&larr; 一覧へ戻る</TextLink>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell
      screenName="請求書を作成"
      activeMenu="documents"
      pageTitle="請求書を作成"
      onNavigateHome={() => {}}
      onNavigateClients={() => {}}
      onNavigateDocuments={() => {}}
      onComingSoon={() => {}}
    >
      {flashMessage ? <Message variant="success">{flashMessage}</Message> : null}
      {submitError ? <Message variant="error">{submitError}</Message> : null}
      {source && onOpenSourceQuote ? (
        <p className="source-note">
          {`見積書 ${source.number ?? '(未採番)'} から変換して作成しています。`}
          <button type="button" className="link" onClick={() => onOpenSourceQuote(source.id)}>
            元の見積書を見る
          </button>
        </p>
      ) : null}

      <div className="form-columns-3">
        <div>
          <div className={`field${errors.clientId ? ' error' : ''}`}>
            <label htmlFor="invoice-client">
              取引先<span className="required">必須</span>
            </label>
            <select
              id="invoice-client"
              aria-label="取引先"
              value={clientId}
              onChange={(e) => setClientId(e.target.value === '' ? '' : Number(e.target.value))}
            >
              <option value="">(選択してください)</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
            <div className="hint">
              <button type="button" className="link" onClick={() => setShowQuickRegister(true)}>
                + 取引先を新規登録
              </button>
            </div>
            {errors.clientId ? <div className="error-message">{errors.clientId}</div> : null}
          </div>
        </div>
        <div>
          <div className="field">
            <label>請求書番号</label>
            <div className="readonly-value">PDF保存時に採番されます</div>
          </div>
        </div>
      </div>

      <div className="form-columns-3">
        <div>
          <div className={`field${errors.issueDate ? ' error' : ''}`}>
            <label htmlFor="invoice-issue-date">
              発行日<span className="required">必須</span>
            </label>
            <input
              id="invoice-issue-date"
              type="date"
              aria-label="発行日"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
            />
            {errors.issueDate ? <div className="error-message">{errors.issueDate}</div> : null}
          </div>
        </div>
        <div>
          <div className="field">
            <label htmlFor="invoice-due-date">支払期限</label>
            <input
              id="invoice-due-date"
              type="date"
              aria-label="支払期限"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
            {dueDateWarning ? <div className="hint">{dueDateWarning}</div> : null}
          </div>
        </div>
      </div>

      <div className="form-section-heading">明細行</div>
      <table className="line-table">
        <thead>
          <tr>
            <th>品名</th>
            <th>数量</th>
            <th>単位</th>
            <th>単価</th>
            <th>税率</th>
            <th style={{ textAlign: 'center' }}>源泉徴収対象</th>
            <th style={{ textAlign: 'right' }}>金額</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const rowError = errors.rows[index]
            const amount = lineAmounts[index] ?? 0
            return (
              <tr key={index}>
                <td className="col-name">
                  <input
                    type="text"
                    aria-label={`品名${index + 1}`}
                    value={row.name}
                    onChange={(e) => updateRow(index, 'name', e.target.value)}
                  />
                  {rowError?.name ? <div className="error-message">{rowError.name}</div> : null}
                </td>
                <td className="col-qty">
                  <input
                    type="number"
                    aria-label={`数量${index + 1}`}
                    value={row.quantity}
                    onChange={(e) => updateRow(index, 'quantity', e.target.value)}
                  />
                  {rowError?.quantity ? (
                    <div className="error-message">{rowError.quantity}</div>
                  ) : null}
                </td>
                <td className="col-unit">
                  <input
                    type="text"
                    aria-label={`単位${index + 1}`}
                    value={row.unit}
                    onChange={(e) => updateRow(index, 'unit', e.target.value)}
                  />
                </td>
                <td className="col-price">
                  <input
                    type="number"
                    aria-label={`単価${index + 1}`}
                    value={row.unitPrice}
                    onChange={(e) => updateRow(index, 'unitPrice', e.target.value)}
                  />
                  {rowError?.unitPrice ? (
                    <div className="error-message">{rowError.unitPrice}</div>
                  ) : null}
                </td>
                <td className="col-tax">
                  <select
                    aria-label={`税率${index + 1}`}
                    value={row.taxRate}
                    onChange={(e) => updateRow(index, 'taxRate', Number(e.target.value) as 10 | 8)}
                  >
                    <option value={10}>10%</option>
                    <option value={8}>8%</option>
                  </select>
                </td>
                <td className="col-wh">
                  <input
                    type="checkbox"
                    aria-label={`源泉徴収対象${index + 1}`}
                    checked={row.withholdingTarget}
                    onChange={(e) => updateRow(index, 'withholdingTarget', e.target.checked)}
                  />
                </td>
                <td className="col-amount">{`¥${amount.toLocaleString('ja-JP')}`}</td>
                <td className="col-del">
                  <Button
                    variant="secondary"
                    className="btn-sm"
                    disabled={rows.length <= 1}
                    onClick={() => removeRow(index)}
                  >
                    削除
                  </Button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {errors.lineItems ? <div className="error-message">{errors.lineItems}</div> : null}
      <Button variant="secondary" className="add-row-btn" onClick={addRow}>
        + 行を追加
      </Button>

      <div className="totals-block">
        <div className="totals-row">
          <span>10%対象 小計</span>
          <span className="val">{`¥${breakdown.subtotal10.toLocaleString('ja-JP')}`}</span>
        </div>
        <div className="totals-row">
          <span>10%対象 消費税額</span>
          <span className="val">{`¥${breakdown.taxAmount10.toLocaleString('ja-JP')}`}</span>
        </div>
        <div className="totals-row">
          <span>8%対象 小計</span>
          <span className="val">{`¥${breakdown.subtotal8.toLocaleString('ja-JP')}`}</span>
        </div>
        <div className="totals-row">
          <span>8%対象 消費税額</span>
          <span className="val">{`¥${breakdown.taxAmount8.toLocaleString('ja-JP')}`}</span>
        </div>
        <div className="totals-row">
          <span>合計金額(税込)</span>
          <span className="val">{`¥${breakdown.totalAmount.toLocaleString('ja-JP')}`}</span>
        </div>
        <div className="totals-row">
          <span>源泉徴収税額(合計)</span>
          <span className="val">{`-¥${withholdingTotal.toLocaleString('ja-JP')}`}</span>
        </div>
        <div className="totals-row grand">
          <span>請求金額</span>
          <span className="val">{`¥${billingAmount.toLocaleString('ja-JP')}`}</span>
        </div>
      </div>

      <div className="form-section-heading">備考</div>
      <div style={{ maxWidth: 900 }}>
        <TextAreaField
          label="備考"
          rows={3}
          placeholder="請求書に記載する備考があれば入力してください"
          value={remarks}
          error={errors.remarks}
          onChange={(e) => setRemarks(e.target.value)}
        />
      </div>

      <div className="form-section-heading">自社情報・振込先(F-10で設定済みの内容・編集不可)</div>
      {companyProfile === undefined ? null : companyProfile === null ? (
        <Message variant="error">
          {INVOICE_MESSAGES.companyProfileNotSet}
          <button type="button" className="link" onClick={onNavigateCompanyProfile}>
            自社情報・振込先の設定へ
          </button>
        </Message>
      ) : (
        <div className="panel" style={{ maxWidth: 900 }}>
          <dl className="info-grid" style={{ marginBottom: 0 }}>
            <dt>氏名・屋号</dt>
            <dd>{companyProfile.name}</dd>
            <dt>住所</dt>
            <dd>{companyProfile.address}</dd>
            {companyProfile.invoiceRegistrationNumber ? (
              <>
                <dt>インボイス登録番号</dt>
                <dd>{companyProfile.invoiceRegistrationNumber}</dd>
              </>
            ) : null}
            {bankSummary ? (
              <>
                <dt>振込先</dt>
                <dd>{bankSummary}</dd>
              </>
            ) : null}
          </dl>
        </div>
      )}

      <div className="form-actions">
        <Button variant="secondary" disabled={submitting} onClick={() => void handleSaveDraft()}>
          下書き保存
        </Button>
        <Button variant="primary" disabled={submitting} onClick={() => void handleFinalize()}>
          PDFとして保存
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          キャンセル
        </Button>
      </div>

      {showQuickRegister ? (
        <QuickClientRegisterModal
          onCancel={() => setShowQuickRegister(false)}
          onRegistered={(client) => {
            setClients((prev) => [...prev, client])
            setClientId(client.id)
            setShowQuickRegister(false)
          }}
        />
      ) : null}
    </AppShell>
  )
}
