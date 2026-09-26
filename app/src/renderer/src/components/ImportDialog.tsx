import { useState, type ReactElement } from 'react'
import { Button } from './Button'
import { Message } from './Message'
import { BACKUP_MESSAGES } from '@shared/messages/messages'

interface ImportDialogProps {
  onClose: () => void
  onImported: (count: number) => void
}

type Step = 'initial' | 'confirm'

/**
 * データ復元(ダイアログ)[F-03]
 * 詳細設計書3.7章の操作定義表どおり、次の2段階フローで実装する(レビュー結果報告書 v0.0 No.6再修正)。
 *   1. 初期状態: 「ファイルを選択して復元」ボタン(副ボタン)を押すと、警告を表示する確認状態へ切り替わる
 *      (この時点ではOS標準ダイアログは開かない。データも一切変更しない)
 *   2. 確認状態: 警告メッセージ(左に赤帯+アイコン)と「キャンセル」(副ボタン)・「続行」(危険ボタン)を表示する
 *      「キャンセル」押下で1.の初期状態に戻る(何も実行しない)
 *      「続行」押下でOS標準のファイル選択ダイアログを開く(全置換の復元処理を実際に開始する唯一の操作のため、
 *      デザインガイド5.1章の危険ボタン(赤)を使用する。赤はこのボタンにのみ使用する)
 * 参照元: 詳細設計書3.7章・4.3章、デザインガイド5.1章(部品カテゴリーのルール)
 */
export function ImportDialog({ onClose, onImported }: ImportDialogProps): ReactElement {
  const [step, setStep] = useState<Step>('initial')
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleImport(): Promise<void> {
    setSubmitting(true)
    try {
      const response = await window.jimuhubApi.importData()
      if (response.success && response.importedCount !== undefined) {
        setResult({
          success: true,
          message: BACKUP_MESSAGES.importSuccess(response.importedCount)
        })
        onImported(response.importedCount)
      } else if (!response.success && response.error) {
        setResult({ success: false, message: response.error })
      }
      // success:false かつ error未設定 = OS標準ダイアログのキャンセル。何も表示しない
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="overlay">
      <div className="modal">
        <button type="button" className="modal-close" aria-label="閉じる" onClick={onClose}>
          &times;
        </button>
        <h2>データを復元</h2>

        {step === 'initial' ? (
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
              <Button variant="danger" disabled={submitting} onClick={() => void handleImport()}>
                続行
              </Button>
            </div>
          </>
        )}

        {result ? (
          <Message variant={result.success ? 'success' : 'error'}>{result.message}</Message>
        ) : null}
      </div>
    </div>
  )
}
