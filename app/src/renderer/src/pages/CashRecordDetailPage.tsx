import { useEffect, useState, type ReactElement } from 'react'
import { AppShell } from '../layout/AppShell'
import { Button, TextLink } from '../components/Button'
import { Message } from '../components/Message'
import { ProjectLinkPanel } from '../components/ProjectLinkPanel'
import { KindBadge, RecordStatusBadge } from '../components/RecordBadges'
import {
  OPERATION_LABELS,
  PAYMENT_METHOD_LABELS,
  TAX_CATEGORY_LABELS
} from '@shared/constants/cash-record'
import { RECEIPT_MESSAGES, RECORD_MESSAGES } from '@shared/messages/messages'
import { ReceiptThumbnail } from '../components/ReceiptThumbnail'
import { ReceiptPreviewDialog } from '../components/ReceiptPreviewDialog'
import type { ReceiptView } from '@shared/types/receipt'
import type { CashRecordDetail } from '@shared/types/cash-record'
import { formatDateTime, formatFileSize, formatSignedAmount, formatYen } from '../utils/format'
import { toErrorMessage } from '../utils/error-message'

interface CashRecordDetailPageProps {
  recordId: number
  flashMessage?: string
  onBackToList: () => void
  onEdit: (id: number) => void
  onDeleted: () => void
  onOpenInvoice: (invoiceId: number) => void
  /** 紐づく案件の名称押下時に、案件詳細画面へ遷移する */
  onOpenProject?: (id: number) => void
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
  onOpenInvoice,
  onOpenProject
}: CashRecordDetailPageProps): ReactElement {
  const [record, setRecord] = useState<CashRecordDetail | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<{ error: boolean; text: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [reason, setReason] = useState('')
  const [previewing, setPreviewing] = useState<ReceiptView | null>(null)

  const [reloadCount, setReloadCount] = useState(0)

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
  }, [recordId, reloadCount])

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

  /** 領収書を開く・Finderで表示する。失敗時(ファイルが見つからない等)は画面に表示する */
  async function handleReceiptAction(
    action: (id: number) => Promise<{ success: true } | { success: false; error: string }>,
    id: number
  ): Promise<void> {
    const result = await action(id)
    setActionMessage(result.success ? null : { error: true, text: result.error })
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

            {record.receipts.length > 0 ? (
              <>
                <div className="section-title">
                  領収書(サムネイルをクリックすると拡大して確認できます)
                </div>
                <div className="receipt-cards">
                  {record.receipts.map((receipt) => (
                    <div
                      key={receipt.id}
                      className={`receipt-card${receipt.removed ? ' removed' : ''}`}
                    >
                      <ReceiptThumbnail receipt={receipt} onClick={() => setPreviewing(receipt)} />
                      <div className="name">{receipt.originalName}</div>
                      <div className="info">
                        {`${receipt.mimeType === 'application/pdf' ? 'PDF' : receipt.mimeType === 'image/png' ? 'PNG' : 'JPEG'} · ${formatFileSize(receipt.fileSize)}`}
                        {receipt.removed ? (
                          <>
                            {' · '}
                            <span className="badge badge-cancelled">外した領収書</span>
                          </>
                        ) : null}
                      </div>
                      {receipt.state !== 'ok' ? (
                        <span className="badge badge-warning">
                          {receipt.state === 'mismatch'
                            ? RECEIPT_MESSAGES.mismatchWarning
                            : RECEIPT_MESSAGES.missingWarning}
                        </span>
                      ) : null}
                      <div className="btns">
                        <Button
                          className="btn-sm"
                          onClick={() =>
                            void handleReceiptAction(window.jimuhubApi.openReceipt, receipt.id)
                          }
                        >
                          開く
                        </Button>
                        <Button
                          className="btn-sm"
                          onClick={() =>
                            void handleReceiptAction(
                              window.jimuhubApi.showReceiptInFolder,
                              receipt.id
                            )
                          }
                        >
                          Finderで表示
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : null}

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
          <ProjectLinkPanel
            targetType="cash_record"
            targetId={recordId}
            targetLabel={`${record.recordDate} ${record.kind === 'income' ? '入金' : '経費'} ${record.description}`}
            project={record.project ?? null}
            canChange={!record.isDeleted}
            onOpenProject={onOpenProject}
            onChanged={() => setReloadCount((count) => count + 1)}
          />
          <div className="back-link">
            <TextLink onClick={onBackToList}>&larr; 一覧へ戻る</TextLink>
          </div>
        </>
      ) : null}

      {previewing ? (
        <ReceiptPreviewDialog
          receiptId={previewing.id}
          fileName={previewing.originalName}
          onOpenExternal={() =>
            void handleReceiptAction(window.jimuhubApi.openReceipt, previewing.id)
          }
          onClose={() => setPreviewing(null)}
        />
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
