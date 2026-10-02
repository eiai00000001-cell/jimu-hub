import { useState, type ReactElement } from 'react'
import { Button } from '../components/Button'
import { Message } from '../components/Message'
import { BACKUP_MESSAGES } from '@shared/messages/messages'
import { toErrorMessage } from '../utils/error-message'

interface StartupErrorPageProps {
  message?: string
}

type Step = 'initial' | 'confirm' | 'done'

/**
 * 起動エラー画面[F-09]。データベースを開けない場合に、エクスポートファイルから復元する導線を提供する。
 * 参照元: 詳細設計書3.8・4.9章、5章(クラス設計 `StartupErrorPage`)
 *
 * 復元処理は通常のデータ復元(F-03)と同一の`importData()`(ZIP・旧JSON両対応)を呼び出す。
 * 復元前に警告を確認し(キャンセル/続行)、成功時は再起動ボタンを表示する。
 * 失敗時は画面を維持し、再度ファイルを選び直せる。
 */
export function StartupErrorPage({ message }: StartupErrorPageProps): ReactElement {
  const [step, setStep] = useState<Step>('initial')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleRestore(): Promise<void> {
    setSubmitting(true)
    setError(null)
    try {
      const response = await window.jimuhubApi.importData()
      if (response.success) {
        setStep('done')
      } else if (response.error) {
        setError(response.error)
        setStep('initial')
      } else {
        // OS標準のファイル選択ダイアログのキャンセル。警告確認の状態に戻す
        setStep('initial')
      }
    } catch (caught) {
      // 想定外の例外でも無反応にならないよう、失敗文言を表示して初期状態へ戻す
      setError(toErrorMessage(caught, BACKUP_MESSAGES.importTransactionFailure))
      setStep('initial')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="window">
      <div className="titlebar">
        <div className="titlebar-title">事務HUB - 起動エラー</div>
      </div>
      <div className="error-body">
        <div className="error-card">
          <Message variant="error">{message}</Message>
          <h1 className="error-title">アプリを起動できませんでした</h1>
          <p className="error-desc">
            エクスポートファイル(.zip または
            .json)から、以前の状態にデータを復元できます。復元前に警告文をご確認いただきます。
          </p>

          {step === 'done' ? (
            <>
              <Message variant="success">復元が完了しました。アプリを再起動してください。</Message>
              <Button variant="primary" onClick={() => void window.jimuhubApi.relaunchApp()}>
                アプリを再起動
              </Button>
            </>
          ) : step === 'confirm' ? (
            <>
              <Message variant="warning">{BACKUP_MESSAGES.importWarning}</Message>
              <div className="error-actions">
                <Button
                  variant="secondary"
                  disabled={submitting}
                  onClick={() => setStep('initial')}
                >
                  キャンセル
                </Button>
                <Button variant="danger" disabled={submitting} onClick={() => void handleRestore()}>
                  続行
                </Button>
              </div>
            </>
          ) : (
            <>
              {error ? <Message variant="error">{error}</Message> : null}
              <Button variant="danger" onClick={() => setStep('confirm')}>
                エクスポートファイルから復元する
              </Button>
            </>
          )}

          <p className="support-note">
            解決しない場合は、操作マニュアルのトラブルシューティングをご参照ください。
          </p>
        </div>
      </div>
    </div>
  )
}
