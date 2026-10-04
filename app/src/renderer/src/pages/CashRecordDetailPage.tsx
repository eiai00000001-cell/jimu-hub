import { useEffect, useState, type ReactElement } from 'react'
import { AppShell } from '../layout/AppShell'
import { Button, TextLink } from '../components/Button'
import { Message } from '../components/Message'
import { KindBadge, RecordStatusBadge } from '../components/RecordBadges'
import {
  OPERATION_LABELS,
  PAYMENT_METHOD_LABELS,
  TAX_CATEGORY_LABELS
} from '@shared/constants/cash-record'
import { RECORD_MESSAGES } from '@shared/messages/messages'
import type { CashRecordDetail } from '@shared/types/cash-record'
import { formatDateTime, formatSignedAmount, formatYen } from '../utils/format'
import { toErrorMessage } from '../utils/error-message'

interface CashRecordDetailPageProps {
  recordId: number
  flashMessage?: string
  onBackToList: () => void
  onEdit: (id: number) => void
  onDeleted: () => void
  onOpenInvoice: (invoiceId: number) => void
}

/**
 * 入出金・経費の詳細画面[F-18・F-20]。領収書の表示・操作(F-22)は後続で追加する。
 * 削除済みの記録は読み取り専用(「削除済み」バッジ、編集・削除ボタンなし)で表示する。
 * 参照元: 詳細設計書3.17章・4.18〜4.20章、5章(`CashRecordDetailPage`)
 */
export function CashRecordDetailPage({
  recordId,
  flashMessage,
  onBackToList,
  onEdit,
  onDeleted,
  onOpenInvoice
}: CashRecordDetailPageProps): ReactElement {
  const [record, setRecord] = useState<CashRecordDetail | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<{ error: boolean; text: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [reason, setReason] = useState('')

  useEffect(() => {
    let cancelled = false
    window.jimuhubApi
      .getRecord(recordId)
      .then((r) => {
        if (!cancelled) setRecord(r)
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(toErrorMessage(error, RECORD_MESSAGES.notFound))
      })
    return () => {
      cancelled = true
    }
  }, [recordId])

  const editable = record !== null && record.status === 'active' && !record.isDeleted

  function handleDeleteClick(): void {
    if (record?.invoiceId != null) {
      // 請求書から自動作成した入金記録は削除せず、案内のみ表示する
      setActionMessage({ error: true, text: RECORD_MESSAGES.autoRecordDeleteBlocked })
      return
    }
    setActionMessage(null)
    setDeleting(true)
  }

  async function handleConfirmDelete(): Promise<void> {
    try {
      await window.jimuhubApi.deleteRecord({ id: recordId, reason: reason.trim() || undefined })
      onDeleted()
    } catch (error) {
      setDeleting(false)
      setActionMessage({ error: true, text: toErrorMessage(error, RECORD_MESSAGES.notFound) })
    }
  }

  return (
    <AppShell
      screenName="入出金・経費の詳細"
      activeMenu="cash"
      pageTitle="入出金・経費の詳細"
      pageTitleExtra={
        record ? (
          <>
            <KindBadge kind={record.kind} />
            {record.isDeleted ? (
              <span className="badge badge-deleted">削除済み</span>
            ) : (
              <RecordStatusBadge status={record.status} />
            )}
          </>
        ) : null
      }
      headerActions={
        editable ? (
          <>
            <Button onClick={() => onEdit(recordId)}>編集</Button>
            <Button onClick={handleDeleteClick}>削除</Button>
          </>
        ) : null
      }
    >
      {flashMessage ? <Message variant="success">{flashMessage}</Message> : null}
      {actionMessage ? (
        <Message variant={actionMessage.error ? 'error' : 'success'}>{actionMessage.text}</Message>
      ) : null}

      {loadError ? (
        <>
          <Message variant="error">{loadError}</Message>
          <div className="back-link">
            <TextLink onClick={onBackToList}>&larr; 一覧へ戻る</TextLink>
          </div>
        </>
      ) : record ? (
        <>
          {!record.integrity.recordHashOk || !record.integrity.historyHashOk ? (
            <div className="record-badges">
              <span className="badge badge-warning">{RECORD_MESSAGES.recordHashWarning}</span>
            </div>
          ) : null}
          <div className="panel" style={{ maxWidth: 900 }}>
            <dl className="info-grid">
              <dt>日付</dt>
              <dd>{record.recordDate}</dd>
              <dt>種別</dt>
              <dd>
                <KindBadge kind={record.kind} />
              </dd>
              <dt>金額(税込)</dt>
              <dd>
                <span className="sign">{formatSignedAmount(record.kind, record.amount)}</span>
              </dd>
              <dt>勘定科目</dt>
              <dd>{record.accountName}</dd>
              <dt>摘要・メモ</dt>
              <dd>{record.description}</dd>
              <dt>取引先</dt>
              <dd>{record.clientName ?? '-'}</dd>
              <dt>支払方法</dt>
              <dd>{record.paymentMethod ? PAYMENT_METHOD_LABELS[record.paymentMethod] : '-'}</dd>
              <dt>税区分</dt>
              <dd>{record.taxCategory ? TAX_CATEGORY_LABELS[record.taxCategory] : '-'}</dd>
              <dt>消費税額</dt>
              <dd>{formatYen(record.taxAmount)}</dd>
              {record.invoiceId !== null ? (
                <>
                  <dt>請求書番号</dt>
                  <dd>
                    <TextLink onClick={() => onOpenInvoice(record.invoiceId as number)}>
                      {record.invoiceNumber ?? '(未採番)'}
                    </TextLink>
                  </dd>
                </>
              ) : null}
              <dt>登録日時</dt>
              <dd>{formatDateTime(record.createdAt)}</dd>
              <dt>更新日時</dt>
              <dd>{formatDateTime(record.updatedAt)}</dd>
            </dl>

            <div className="section-title">履歴</div>
            <table className="table">
              <thead>
                <tr>
                  <th>操作日時</th>
                  <th>操作</th>
                  <th>変更理由</th>
                  <th>変更内容</th>
                </tr>
              </thead>
              <tbody>
                {record.history.map((h) => (
                  <tr key={h.id}>
                    <td>{formatDateTime(h.operatedAt)}</td>
                    <td>
                      <span
                        className={`badge ${
                          h.operation === 'delete' || h.operation === 'cancel'
                            ? 'badge-op-major'
                            : 'badge-op-minor'
                        }`}
                      >
                        {OPERATION_LABELS[h.operation]}
                      </span>
                    </td>
                    <td>{h.reason ?? '-'}</td>
                    <td>
                      {h.operation === 'create'
                        ? '新規登録'
                        : h.changes.map((c) => `${c.label}: ${c.before} → ${c.after}`).join(' / ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="back-link">
            <TextLink onClick={onBackToList}>&larr; 一覧へ戻る</TextLink>
          </div>
        </>
      ) : null}

      {deleting ? (
        <div className="overlay">
          <div className="modal">
            <h2>{RECORD_MESSAGES.confirmDeleteTitle}</h2>
            <p>{RECORD_MESSAGES.confirmDeleteDescription}</p>
            <div className="field">
              <label htmlFor="delete-reason">変更理由(任意)</label>
              <input
                id="delete-reason"
                type="text"
                maxLength={200}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            <div className="modal-actions">
              <Button onClick={() => setDeleting(false)}>いいえ</Button>
              <Button variant="primary" onClick={() => void handleConfirmDelete()}>
                はい
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  )
}
