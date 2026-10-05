import { useEffect, useState, type ReactElement } from 'react'
import { AppShell } from '../layout/AppShell'
import { Button } from '../components/Button'
import { Message } from '../components/Message'
import { calculateIncludedTax } from '@shared/calculations/included-tax'
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  TAX_CATEGORIES,
  TAX_CATEGORY_LABELS
} from '@shared/constants/cash-record'
import { CashRecordInputSchema } from '@shared/schemas/cash-record.schema'
import { RECEIPT_LIMITS } from '@shared/constants/receipt'
import { NAVIGATION_MESSAGES, RECEIPT_MESSAGES, RECORD_MESSAGES } from '@shared/messages/messages'
import type { PickedReceipt, ReceiptView } from '@shared/types/receipt'
import type { AccountView } from '@shared/types/account'
import type { Client } from '@shared/types/client'
import type {
  CashRecordDetail,
  PaymentMethod,
  RecordKind,
  TaxCategory
} from '@shared/types/cash-record'
import { formatFileSize, formatYen, todayIso } from '../utils/format'
import { toErrorMessage } from '../utils/error-message'

type FieldName = 'recordDate' | 'amount' | 'accountId' | 'description' | 'reason'

interface CashRecordFormPageProps {
  mode: 'new' | 'edit'
  /** 登録時の種別の初期値(遷移元のボタンで指定) */
  kind?: RecordKind
  /** 編集対象の記録ID */
  recordId?: number
  onSaved: (id: number, message: string) => void
  onCancel: () => void
}

/**
 * 入出金・経費の登録・編集画面[F-18]。領収書の追加・外す操作(F-22)は後続で追加する。
 * 参照元: 詳細設計書3.16章・4.18章、5章(`CashRecordFormPage`)
 */
export function CashRecordFormPage({
  mode,
  kind: initialKind = 'expense',
  recordId,
  onSaved,
  onCancel
}: CashRecordFormPageProps): ReactElement {
  const [kind, setKind] = useState<RecordKind>(initialKind)
  const [recordDate, setRecordDate] = useState(todayIso())
  const [amountText, setAmountText] = useState('')
  const [accountId, setAccountId] = useState('')
  const [description, setDescription] = useState('')
  const [clientId, setClientId] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>('')
  const [taxCategory, setTaxCategory] = useState<TaxCategory | ''>('')
  const [reason, setReason] = useState('')
  const [original, setOriginal] = useState<CashRecordDetail | null>(null)
  const [accounts, setAccounts] = useState<AccountView[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // 領収書: 保存済み(編集時)・外す予定のID・追加予定(選択済みのファイルの識別子)
  const [savedReceipts, setSavedReceipts] = useState<ReceiptView[]>([])
  const [removeIds, setRemoveIds] = useState<number[]>([])
  const [added, setAdded] = useState<PickedReceipt[]>([])
  const [receiptErrors, setReceiptErrors] = useState<string[]>([])

  useEffect(() => {
    window.jimuhubApi.listAccounts({ includeInactive: true }).then(setAccounts)
    window.jimuhubApi.listClients({ statusFilter: 'all' }).then(setClients)
  }, [])

  useEffect(() => {
    if (mode !== 'edit' || recordId === undefined) return
    let cancelled = false
    window.jimuhubApi
      .getRecord(recordId)
      .then((record) => {
        if (cancelled) return
        if (record.isDeleted) {
          setLoadError(RECORD_MESSAGES.notFound)
          return
        }
        if (record.status === 'cancelled') {
          setLoadError(RECORD_MESSAGES.notEditable)
          return
        }
        setOriginal(record)
        setSavedReceipts(record.receipts.filter((r) => !r.removed))
        setKind(record.kind)
        setRecordDate(record.recordDate)
        setAmountText(String(record.amount))
        setAccountId(String(record.accountId))
        setDescription(record.description)
        setClientId(record.clientId === null ? '' : String(record.clientId))
        setPaymentMethod(record.paymentMethod ?? '')
        setTaxCategory(record.taxCategory ?? '')
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(toErrorMessage(error, RECORD_MESSAGES.notFound))
      })
    return () => {
      cancelled = true
    }
  }, [mode, recordId])

  /** 請求書から自動作成された記録は、種別・金額・取引先を表示のみとする(基本設計書8.1章★E11) */
  const locked = original?.invoiceId != null

  const parseAmount = (): number => {
    const normalized = amountText.replace(/,/g, '').trim()
    return /^[0-9]+$/.test(normalized) ? Number(normalized) : Number.NaN
  }
  const amount = parseAmount()
  const taxAmount = Number.isFinite(amount)
    ? calculateIncludedTax(amount, taxCategory === '' ? null : taxCategory)
    : 0

  // 種別に合う区分の利用中の科目のみ。編集時は、現在選択済みの科目が利用停止でも選択肢に含める
  const accountOptions = accounts.filter(
    (a) => a.kind === kind && (a.status === 'active' || String(a.id) === accountId)
  )
  const clientOptions = clients.filter((c) => c.status === 'active' || String(c.id) === clientId)

  const activeReceiptCount = savedReceipts.length - removeIds.length + added.length

  /** 「ファイルを追加」: Mainがダイアログを開く。有効な領収書が上限を超える分は追加しない */
  async function handleAddReceipts(): Promise<void> {
    const picked = await window.jimuhubApi.pickReceipts()
    const errors = picked.errors.map((e) => `${e.fileName}: ${e.error}`)
    const room = RECEIPT_LIMITS.maxPerRecord - activeReceiptCount
    const accepted = picked.files.slice(0, Math.max(0, room))
    if (picked.files.length > accepted.length) errors.push(RECEIPT_MESSAGES.countExceeded)
    setAdded((prev) => [...prev, ...accepted])
    setReceiptErrors(errors)
  }

  function changeKind(next: RecordKind): void {
    setKind(next)
    setAccountId('')
  }

  async function handleSubmit(): Promise<void> {
    setFormError(null)
    const input = {
      kind,
      recordDate,
      amount,
      accountId: accountId === '' ? Number.NaN : Number(accountId),
      description,
      clientId: clientId === '' ? null : Number(clientId),
      paymentMethod: paymentMethod === '' ? null : paymentMethod,
      taxCategory: taxCategory === '' ? null : taxCategory
    }
    const addTokens = added.map((file) => file.token)
    const parsed = CashRecordInputSchema.safeParse(input)
    const nextErrors: Partial<Record<FieldName, string>> = {}
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as FieldName
        if (!nextErrors[field]) nextErrors[field] = issue.message
      }
    }
    if (mode === 'edit' && reason.trim().length > 200) {
      nextErrors.reason = RECORD_MESSAGES.reasonTooLong
    }
    setErrors(nextErrors)
    if (!parsed.success || Object.keys(nextErrors).length > 0) return

    setSaving(true)
    try {
      if (mode === 'new') {
        const { id } = await window.jimuhubApi.createRecord({
          ...parsed.data,
          receiptTokens: addTokens
        })
        onSaved(id, RECORD_MESSAGES.createSuccess)
      } else {
        const result = await window.jimuhubApi.updateRecord({
          ...parsed.data,
          id: recordId as number,
          reason: reason.trim() || undefined,
          addReceiptTokens: addTokens,
          removeReceiptIds: removeIds
        })
        onSaved(
          result.id,
          result.changed ? RECORD_MESSAGES.updateSuccess : RECORD_MESSAGES.noChange
        )
      }
    } catch (error) {
      setFormError(toErrorMessage(error, RECORD_MESSAGES.notFound))
      setSaving(false)
    }
  }

  const fieldClass = (name: FieldName): string => `field${errors[name] ? ' error' : ''}`
  const fieldError = (name: FieldName): ReactElement | null =>
    errors[name] ? <div className="error-message">{errors[name]}</div> : null
  const title = mode === 'new' ? (kind === 'income' ? '入金の登録' : '経費の登録') : '記録の編集'

  return (
    <AppShell
      screenName={title}
      activeMenu="cash"
      pageTitle={title}
      confirmLeave={() => window.confirm(NAVIGATION_MESSAGES.confirmLeave)}
    >
      {loadError ? (
        <>
          <Message variant="error">{loadError}</Message>
          <div className="form-actions">
            <Button onClick={onCancel}>一覧へ戻る</Button>
          </div>
        </>
      ) : (
        <>
          {formError ? <Message variant="error">{formError}</Message> : null}
          <div className="panel">
            <div className="form-columns">
              <div>
                <div className="field">
                  <label>
                    種別<span className="required">必須</span>
                  </label>
                  {mode === 'new' ? (
                    <div className="radio-row">
                      <label>
                        <input
                          type="radio"
                          name="record-kind"
                          checked={kind === 'income'}
                          onChange={() => changeKind('income')}
                        />{' '}
                        入金
                      </label>
                      <label>
                        <input
                          type="radio"
                          name="record-kind"
                          checked={kind === 'expense'}
                          onChange={() => changeKind('expense')}
                        />{' '}
                        経費
                      </label>
                    </div>
                  ) : (
                    <div className="readonly">{kind === 'income' ? '入金' : '経費'}</div>
                  )}
                </div>
                <div className={fieldClass('recordDate')}>
                  <label htmlFor="record-date">
                    日付<span className="required">必須</span>
                  </label>
                  <input
                    id="record-date"
                    type="date"
                    value={recordDate}
                    onChange={(e) => setRecordDate(e.target.value)}
                  />
                  {fieldError('recordDate')}
                </div>
                <div className={fieldClass('amount')}>
                  <label htmlFor="record-amount">
                    金額<span className="required">必須</span>
                  </label>
                  {locked ? (
                    <div className="readonly">{formatYen(original?.amount ?? 0)}</div>
                  ) : (
                    <input
                      id="record-amount"
                      type="text"
                      placeholder="例: 6,600"
                      value={amountText}
                      onChange={(e) => setAmountText(e.target.value)}
                    />
                  )}
                  <div className="hint">税込の金額を半角数字で入力します(カンマ区切り可)</div>
                  {fieldError('amount')}
                </div>
                <div className={fieldClass('accountId')}>
                  <label htmlFor="record-account">
                    勘定科目<span className="required">必須</span>
                  </label>
                  <select
                    id="record-account"
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                  >
                    <option value="">選択してください</option>
                    {accountOptions.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  <div className="hint">種別に合う区分の、利用中の科目のみ表示されます</div>
                  {fieldError('accountId')}
                </div>
                <div className={fieldClass('description')}>
                  <label htmlFor="record-description">
                    摘要・メモ<span className="required">必須</span>
                  </label>
                  <input
                    id="record-description"
                    type="text"
                    placeholder="例: 事務用品の購入(200文字まで)"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                  {fieldError('description')}
                </div>
              </div>
              <div>
                <div className="field">
                  <label htmlFor="record-client">取引先</label>
                  {locked ? (
                    <div className="readonly">{original?.clientName ?? '(未選択)'}</div>
                  ) : (
                    <select
                      id="record-client"
                      value={clientId}
                      onChange={(e) => setClientId(e.target.value)}
                    >
                      <option value="">(未選択)</option>
                      {clientOptions.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="field">
                  <label htmlFor="record-payment">支払方法</label>
                  <select
                    id="record-payment"
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod | '')}
                  >
                    <option value="">(未選択)</option>
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {PAYMENT_METHOD_LABELS[m]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="record-tax">税区分</label>
                  <select
                    id="record-tax"
                    value={taxCategory}
                    onChange={(e) => setTaxCategory(e.target.value as TaxCategory | '')}
                  >
                    <option value="">(未選択)</option>
                    {TAX_CATEGORIES.map((t) => (
                      <option key={t} value={t}>
                        {TAX_CATEGORY_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>消費税額</label>
                  <div className="readonly" aria-label="消費税額">
                    {formatYen(taxAmount)}
                  </div>
                  <div className="hint">金額と税区分から自動計算します(入力不可)</div>
                </div>
                <div className="field">
                  <label>領収書</label>
                  {savedReceipts.length + added.length === 0 ? (
                    <div className="receipt-empty">領収書は添付されていません。</div>
                  ) : (
                    <div className="receipt-list">
                      {savedReceipts.map((receipt) => {
                        const removing = removeIds.includes(receipt.id)
                        return (
                          <div key={`saved-${receipt.id}`} className="receipt-item">
                            <div
                              className={`thumb${receipt.mimeType === 'application/pdf' ? ' pdf' : ''}`}
                            />
                            <div className="receipt-meta">
                              <div
                                className="name"
                                style={removing ? { textDecoration: 'line-through' } : undefined}
                              >
                                {receipt.originalName}
                              </div>
                              <div className="info">
                                {`${formatFileSize(receipt.fileSize)} · ${removing ? '外す予定(保存時に外します)' : '保存済み'}`}
                              </div>
                            </div>
                            <Button
                              className="btn-sm"
                              onClick={() =>
                                setRemoveIds((prev) =>
                                  removing
                                    ? prev.filter((x) => x !== receipt.id)
                                    : [...prev, receipt.id]
                                )
                              }
                            >
                              {removing ? '取り消す' : '削除'}
                            </Button>
                          </div>
                        )
                      })}
                      {added.map((file) => (
                        <div key={file.token} className="receipt-item">
                          <div
                            className={`thumb${file.fileName.toLowerCase().endsWith('.pdf') ? ' pdf' : ''}`}
                          />
                          <div className="receipt-meta">
                            <div className="name">{file.fileName}</div>
                            <div className="info">
                              {`${formatFileSize(file.fileSize)} · 追加予定(保存時に添付します)`}
                            </div>
                          </div>
                          <Button
                            className="btn-sm"
                            onClick={() =>
                              setAdded((prev) => prev.filter((x) => x.token !== file.token))
                            }
                          >
                            削除
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ marginTop: 8 }}>
                    <Button
                      className="btn-sm"
                      disabled={activeReceiptCount >= RECEIPT_LIMITS.maxPerRecord}
                      onClick={() => void handleAddReceipts()}
                    >
                      ファイルを追加
                    </Button>
                  </div>
                  <div className="hint">
                    {`PDF・JPEG・PNG、1ファイル10MBまで、1つの記録につき5件まで(現在 ${activeReceiptCount} 件)`}
                  </div>
                  {receiptErrors.map((message) => (
                    <div key={message} className="error-message">
                      {message}
                    </div>
                  ))}
                </div>
                {mode === 'edit' ? (
                  <div className={fieldClass('reason')}>
                    <label htmlFor="record-reason">変更理由</label>
                    <input
                      id="record-reason"
                      type="text"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                    {fieldError('reason')}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
          <div className="form-actions">
            <Button variant="primary" disabled={saving} onClick={() => void handleSubmit()}>
              {mode === 'new' ? '登録' : '保存'}
            </Button>
            <Button onClick={onCancel}>キャンセル</Button>
          </div>
        </>
      )}
    </AppShell>
  )
}
