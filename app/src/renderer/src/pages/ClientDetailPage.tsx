import { useEffect, useState, type ReactElement } from 'react'
import { AppShell } from '../layout/AppShell'
import { Button, TextLink } from '../components/Button'
import { Badge } from '../components/Badge'
import { Message } from '../components/Message'
import type { Client } from '@shared/types/client'
import { CLIENT_MESSAGES } from '@shared/messages/messages'

function formatDateTime(iso: string): string {
  const date = new Date(iso)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`
}

interface ClientDetailPageProps {
  clientId: number
  flashMessage?: string
  onNavigateHome: () => void
  onBackToList: () => void
  onEdit: (id: number) => void
  onDeactivated: (id: number) => void
}

/**
 * 呼び出し側は `clientId` が変わるたびに `key={clientId}` を指定して再マウントさせること
 * (別の取引先へ遷移した際に前の表示内容が一瞬残らないようにするため)。
 *
 * 取引先詳細画面[F-06・F-08]
 * 参照元: 詳細設計書3.4章・4.6章・4.8章
 */
export function ClientDetailPage({
  clientId,
  flashMessage,
  onNavigateHome,
  onBackToList,
  onEdit,
  onDeactivated
}: ClientDetailPageProps): ReactElement {
  const [client, setClient] = useState<Client | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.jimuhubApi
      .getClient(clientId)
      .then((result) => {
        if (!cancelled) setClient(result)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : CLIENT_MESSAGES.notFound)
        }
      })
    return () => {
      cancelled = true
    }
  }, [clientId])

  async function handleConfirmDeactivate(): Promise<void> {
    await window.jimuhubApi.deactivateClient(clientId)
    setConfirming(false)
    try {
      // BUG-02修正: 利用停止後、同一の詳細画面インスタンス内でも最新の状態(バッジ・編集ボタンの活性/非活性)を
      // 反映できるよう、取引先を再取得してローカルstateを更新する(詳細設計書4.8章手順4)。
      const refreshed = await window.jimuhubApi.getClient(clientId)
      setClient(refreshed)
      onDeactivated(clientId)
    } catch (error) {
      // レビュー結果報告書 v0.2(BUG-02参考所見)対応: 利用停止自体は成功しているが、
      // 直後の再取得が失敗した場合(稀なタイミングでの競合等)に未処理のPromise rejectionと
      // ならないよう捕捉し、既存のMessage部品(エラー)+一覧への導線で案内する
      // (詳細設計書8章「詳細画面表示時に対象取引先が存在しない」の文言に合わせる)。
      setLoadError(error instanceof Error ? error.message : CLIENT_MESSAGES.notFound)
    }
  }

  return (
    <AppShell
      screenName="取引先詳細"
      activeMenu="clients"
      pageTitle="取引先詳細"
      pageTitleExtra={
        client ? <Badge variant={client.status === 'active' ? 'active' : 'inactive'} /> : null
      }
      headerActions={
        client ? (
          <>
            <Button onClick={() => onEdit(clientId)} disabled={client.status !== 'active'}>
              編集
            </Button>
            {client.status === 'active' ? (
              <Button onClick={() => setConfirming(true)}>利用停止にする</Button>
            ) : null}
          </>
        ) : null
      }
      onNavigateHome={onNavigateHome}
      onNavigateClients={() => {}}
      onComingSoon={() => {}}
    >
      {flashMessage ? <Message variant="success">{flashMessage}</Message> : null}

      {loadError ? (
        <>
          <Message variant="error">{loadError}</Message>
          <div className="back-link">
            <TextLink onClick={onBackToList}>&larr; 一覧へ戻る</TextLink>
          </div>
        </>
      ) : client ? (
        <>
          <div className="panel">
            <dl className="info-grid">
              <dt>取引先ID</dt>
              <dd>{client.id}</dd>
              <dt>取引先名称</dt>
              <dd>{client.name}</dd>
              <dt>フリガナ</dt>
              <dd>{client.furigana}</dd>
              <dt>敬称</dt>
              <dd>{client.honorific}</dd>
              <dt>担当者名</dt>
              <dd>{client.contactPerson}</dd>
              <dt>郵便番号</dt>
              <dd>{client.postalCode}</dd>
              <dt>住所</dt>
              <dd>{client.address}</dd>
              <dt>電話番号</dt>
              <dd>{client.phone}</dd>
              <dt>メールアドレス</dt>
              <dd>{client.email}</dd>
              <dt>インボイス登録番号</dt>
              <dd>{client.invoiceRegistrationNumber}</dd>
              <dt>メモ</dt>
              <dd>{client.memo}</dd>
              <dt>状態</dt>
              <dd>
                <Badge variant={client.status === 'active' ? 'active' : 'inactive'} />
              </dd>
              <dt>登録日時</dt>
              <dd>{formatDateTime(client.createdAt)}</dd>
              <dt>更新日時</dt>
              <dd>{formatDateTime(client.updatedAt)}</dd>
            </dl>
          </div>
          <div className="back-link">
            <TextLink onClick={onBackToList}>&larr; 一覧へ戻る</TextLink>
          </div>
        </>
      ) : null}

      {confirming ? (
        <div className="overlay">
          <div className="modal">
            <h2>本当に利用停止にしますか</h2>
            <p>
              利用停止にすると、一覧の既定表示から非表示になります(データは削除されません。「利用停止も表示」をONにすると引き続き確認できます)。
            </p>
            <div className="modal-actions">
              <Button onClick={() => setConfirming(false)}>いいえ</Button>
              <Button variant="primary" onClick={() => void handleConfirmDeactivate()}>
                はい
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  )
}
