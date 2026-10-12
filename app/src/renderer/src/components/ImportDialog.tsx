import { useEffect, useState, type ReactElement } from 'react'
import { Button } from './Button'
import { Message } from './Message'
import { BACKUP_MESSAGES } from '@shared/messages/messages'
import type { BackupInspection, DataProgress } from '@shared/ipc/api'
import { toErrorMessage } from '../utils/error-message'

interface ImportDialogProps {
  onClose: () => void
  onImported: (count: number) => void
}

type Step = 'initial' | 'confirm' | 'restoreConfirm'

/**
 * データ復元(ダイアログ)[F-03]
 * 詳細設計書3.7章の操作定義表どおり、次の2段階フローで実装する(レビュー結果報告書 v0.0 No.6再修正)。
 *   1. 初期状態: 「ファイルを選択して復元」ボタン(副ボタン)を押すと、警告を表示する確認状態へ切り替わる
 *      (この時点ではOS標準ダイアログは開かない。データも一切変更しない)
 *   2. 確認状態: 警告メッセージ(左に赤帯+アイコン)と「キャンセル」(副ボタン)・「続行」(危険ボタン)を表示する
 *      「キャンセル」押下で1.の初期状態に戻る(何も実行しない)
 *      「続行」押下でOS標準のファイル選択ダイアログを開き、選択したファイルの内容を確認する(現在のデータは変更しない)
 *      確認の結果、領収書・案件が消える場合のみ、3.の確認画面を表示する。それ以外は、すぐに復元を実行する
 *   3. 復元前の確認(F-33): 消えるデータの件数を表示し、「キャンセル」(初期フォーカス)・「復元する」(危険ボタン)を表示する
 *      全置換の復元処理を実際に開始する操作のため、デザインガイド5.1章の危険ボタン(赤)を使用する
 * 参照元: 詳細設計書3.7章・4.3章・4.33章、デザインガイド5.1章(部品カテゴリーのルール)
 */
export function ImportDialog({ onClose, onImported }: ImportDialogProps): ReactElement {
  const [step, setStep] = useState<Step>('initial')
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [inspection, setInspection] = useState<BackupInspection | null>(null)
  const [progress, setProgress] = useState<Pick<
    DataProgress,
    'stage' | 'current' | 'total'
  > | null>(null)

  // 進捗(`data:progress`)の購読。実行中のみ表示する
  useEffect(() => {
    return window.jimuhubApi.onDataProgress?.((p) => {
      if (p.phase === 'import') setProgress({ stage: p.stage, current: p.current, total: p.total })
    })
  }, [])

  /** ファイルを選択して内容を確認し、確認画面が不要な場合はそのまま復元する */
  async function handleSelectFile(): Promise<void> {
    setSubmitting(true)
    try {
      const response = await window.jimuhubApi.inspectBackup()
      if (!response.success) {
        // canceledの場合は、OS標準ダイアログのキャンセル。何も表示しない
        if (response.error) setResult({ success: false, message: response.error })
        return
      }
      if (response.inspection.needsConfirmation) {
        setInspection(response.inspection)
        setStep('restoreConfirm')
        return
      }
      await runImport(response.inspection.token)
    } catch (caught) {
      setResult({
        success: false,
        message: toErrorMessage(caught, BACKUP_MESSAGES.importTransactionFailure)
      })
    } finally {
      setSubmitting(false)
      setProgress(null)
    }
  }

  async function handleConfirmRestore(): Promise<void> {
    if (!inspection) return
    setSubmitting(true)
    try {
      await runImport(inspection.token)
    } catch (caught) {
      setResult({
        success: false,
        message: toErrorMessage(caught, BACKUP_MESSAGES.importTransactionFailure)
      })
    } finally {
      // 復元の実行後は、選択済みファイルの識別子が使えなくなるため、確認画面を閉じる
      setInspection(null)
      setStep('initial')
      setSubmitting(false)
      setProgress(null)
    }
  }

  async function handleCancelRestore(): Promise<void> {
    if (inspection) {
      await window.jimuhubApi.discardBackup(inspection.token)
    }
    setInspection(null)
    setStep('initial')
  }

  async function runImport(token: string): Promise<void> {
    const response = await window.jimuhubApi.importData({ token })
    if (response.success && response.importedCount !== undefined) {
      setResult({
        success: true,
        message: BACKUP_MESSAGES.importSuccess(
          response.importedCount,
          response.pdfHashMismatchCount,
          response.receiptHashMismatchCount,
          response.recordHashMismatchCount,
          response.projectLinkFixCount
        )
      })
      onImported(response.importedCount)
    } else if (!response.success && response.error) {
      setResult({ success: false, message: response.error })
    }
  }

  if (step === 'restoreConfirm' && inspection && !result?.success) {
    return (
      <div className="overlay">
        <div className="modal wide">
          <button type="button" className="modal-close" aria-label="閉じる" onClick={onClose}>
            &times;
          </button>
          <h2>{BACKUP_MESSAGES.confirmTitle}</h2>
          <p className="lead">{BACKUP_MESSAGES.confirmLead}</p>
          {!inspection.hasReceipts && inspection.currentReceiptCount >= 1 ? (
            <Message variant="warning">
              {BACKUP_MESSAGES.confirmNoReceipts(inspection.currentReceiptCount)}
            </Message>
          ) : null}
          {!inspection.hasProjects && inspection.currentProjectCount >= 1 ? (
            <Message variant="warning">
              {BACKUP_MESSAGES.confirmNoProjects(inspection.currentProjectCount)}
            </Message>
          ) : null}
          <p className="note">{BACKUP_MESSAGES.confirmBackupNotice}</p>
          <div className="modal-actions">
            <Button
              variant="secondary"
              autoFocus
              disabled={submitting}
              onClick={() => void handleCancelRestore()}
            >
              キャンセル
            </Button>
            <Button
              variant="danger"
              disabled={submitting}
              onClick={() => void handleConfirmRestore()}
            >
              {BACKUP_MESSAGES.confirmRestore}
            </Button>
          </div>
          {submitting && progress ? (
            <p role="status">
              {progress.stage === 'verify'
                ? BACKUP_MESSAGES.importVerify(progress.current, progress.total)
                : BACKUP_MESSAGES.importProgress(progress.current, progress.total)}
            </p>
          ) : null}
          {result ? <Message variant="error">{result.message}</Message> : null}
        </div>
      </div>
    )
  }

  return (
    <div className="overlay">
      <div className="modal">
        <button type="button" className="modal-close" aria-label="閉じる" onClick={onClose}>
          &times;
        </button>
        <h2>データを復元</h2>

        {result?.success ? null : step === 'initial' ? (
          <>
            <p>{BACKUP_MESSAGES.importIntro}</p>
            <div className="modal-actions">
              <Button variant="secondary" onClick={() => setStep('confirm')}>
                ファイルを選択して復元
              </Button>
            </div>
          </>
        ) : (
          <>
            <Message variant="warning">{BACKUP_MESSAGES.importWarning}</Message>
            <div className="modal-actions">
              <Button variant="secondary" disabled={submitting} onClick={() => setStep('initial')}>
                キャンセル
              </Button>
              <Button
                variant="danger"
                disabled={submitting}
                onClick={() => void handleSelectFile()}
              >
                続行
              </Button>
            </div>
          </>
        )}

        {submitting && progress ? (
          <p role="status">
            {progress.stage === 'verify'
              ? BACKUP_MESSAGES.importVerify(progress.current, progress.total)
              : BACKUP_MESSAGES.importProgress(progress.current, progress.total)}
          </p>
        ) : null}
        {result ? (
          <Message variant={result.success ? 'success' : 'error'}>{result.message}</Message>
        ) : null}
      </div>
    </div>
  )
}
