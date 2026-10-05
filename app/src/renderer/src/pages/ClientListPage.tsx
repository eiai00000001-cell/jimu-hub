import { useEffect, useState, type ReactElement } from 'react'
import { AppShell } from '../layout/AppShell'
import { Button } from '../components/Button'
import { Badge } from '../components/Badge'
import { Message } from '../components/Message'
import type { Client, ClientSortKey } from '@shared/types/client'
import { CLIENT_MESSAGES } from '@shared/messages/messages'

const SORT_OPTIONS: Array<{ value: ClientSortKey; label: string }> = [
  { value: 'furigana_asc', label: 'フリガナ昇順' },
  { value: 'name_asc', label: '名称昇順' },
  { value: 'name_desc', label: '名称降順' },
  { value: 'created_at_desc', label: '登録日新しい順' },
  { value: 'created_at_asc', label: '登録日古い順' }
]

interface ClientListPageProps {
  flashMessage?: string
  onNavigateHome: () => void
  onNavigateDocuments: () => void
  onNewClient: () => void
  onSelectClient: (id: number) => void
}

/**
 * 取引先一覧画面[F-05]
 * 参照元: 基本設計書4.2章、詳細設計書3.2章・4.5章
 */
export function ClientListPage({
  flashMessage,
  onNavigateHome,
  onNavigateDocuments,
  onNewClient,
  onSelectClient
}: ClientListPageProps): ReactElement {
  const [keyword, setKeyword] = useState('')
  const [sort, setSort] = useState<ClientSortKey>('furigana_asc')
  const [showInactive, setShowInactive] = useState(false)
  const [clients, setClients] = useState<Client[] | null>(null)
  const [reactivated, setReactivated] = useState(false)
  const [reloadCount, setReloadCount] = useState(0)
  const [comingSoonLabel, setComingSoonLabel] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.jimuhubApi
      .listClients({ keyword, sort, statusFilter: showInactive ? 'all' : 'active' })
      .then((result) => {
        if (!cancelled) {
          setClients(result)
        }
      })
    return () => {
      cancelled = true
    }
  }, [keyword, sort, showInactive, reloadCount])

  async function handleReactivate(id: number): Promise<void> {
    if (!window.confirm(CLIENT_MESSAGES.confirmReactivate)) return
    await window.jimuhubApi.reactivateClient(id)
    setReactivated(true)
    setReloadCount((count) => count + 1)
  }

  const hasInactive = clients?.some((client) => client.status === 'inactive') ?? false

  return (
    <AppShell
      screenName="取引先一覧"
      activeMenu="clients"
      pageTitle="取引先管理"
      headerActions={
        <Button variant="primary" onClick={onNewClient}>
          + 新規登録
        </Button>
      }
      onNavigateHome={onNavigateHome}
      onNavigateClients={() => {}}
      onNavigateDocuments={onNavigateDocuments}
      onComingSoon={(label) => setComingSoonLabel(label)}
    >
      {flashMessage ? <Message variant="success">{flashMessage}</Message> : null}
      {reactivated ? (
        <Message variant="success">{CLIENT_MESSAGES.reactivateSuccess}</Message>
      ) : null}
      {comingSoonLabel ? (
        <Message variant="warning">
          「{comingSoonLabel}」は以降のイテレーションで実装予定です。
        </Message>
      ) : null}

      <div className="toolbar">
        <input
          type="text"
          placeholder="取引先名で検索"
          aria-label="取引先名で検索"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
        <select
          aria-label="並べ替え"
          value={sort}
          onChange={(event) => setSort(event.target.value as ClientSortKey)}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <div className="spacer" />
        <button
          type="button"
          className="toggle"
          role="switch"
          aria-checked={showInactive}
          aria-label="利用停止も表示"
          onClick={() => setShowInactive((prev) => !prev)}
        >
          <span>利用停止も表示</span>
          <div className={`switch${showInactive ? ' on' : ''}`} />
        </button>
      </div>

      {clients === null ? null : clients.length === 0 ? (
        <div className="empty-state">{CLIENT_MESSAGES.emptyList}</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>名称</th>
              <th>フリガナ</th>
              <th>敬称</th>
              <th>担当者名</th>
              <th>電話番号</th>
              <th>状態</th>
              {hasInactive ? <th className="op">操作</th> : null}
            </tr>
          </thead>
          <tbody>
            {clients.map((client) => (
              <tr
                key={client.id}
                className={`clickable${client.status === 'inactive' ? ' inactive' : ''}`}
                onClick={() => onSelectClient(client.id)}
              >
                <td>{client.name}</td>
                <td className={client.furigana ? undefined : 'furigana-empty'}>
                  {client.furigana || '(未入力)'}
                </td>
                <td>{client.honorific}</td>
                <td>{client.contactPerson ?? ''}</td>
                <td>{client.phone ?? ''}</td>
                <td>
                  <Badge variant={client.status === 'active' ? 'active' : 'inactive'} />
                </td>
                {hasInactive ? (
                  <td className="op">
                    {client.status === 'inactive' ? (
                      <Button
                        className="btn-sm"
                        onClick={(event) => {
                          event.stopPropagation()
                          void handleReactivate(client.id)
                        }}
                      >
                        利用中に戻す
                      </Button>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {clients && clients.length > 0 ? (
        <p className="table-note">
          フリガナ昇順で並べ替えた場合、フリガナが未入力の取引先は五十音順対象から外し、一覧の末尾にまとめて表示します。
        </p>
      ) : null}
    </AppShell>
  )
}
