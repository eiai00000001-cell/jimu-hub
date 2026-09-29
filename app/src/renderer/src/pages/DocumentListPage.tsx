import { useEffect, useState, type ReactElement } from 'react'
import { AppShell } from '../layout/AppShell'
import { Button } from '../components/Button'
import { Badge } from '../components/Badge'
import { Message } from '../components/Message'
import type { Client } from '@shared/types/client'
import type { QuoteSummary } from '@shared/types/quote'
import { QUOTE_MESSAGES } from '@shared/messages/messages'

type Tab = 'quote' | 'invoice'

interface DocumentListPageProps {
  onNavigateHome: () => void
  onNavigateClients: () => void
  onNewQuote: () => void
  onSelectQuote: (id: number) => void
}

/**
 * 見積書・請求書一覧画面[F-12・F-14]
 * 参照元: 基本設計書4.10章、詳細設計書3.10章・4.12・4.14章、5章(クラス設計 `DocumentListPage`)
 *
 * 請求書タブは請求書機能(T-20)実装まで「準備中」表示とする(サイドメニューの他「準備中」項目と同じ扱い)。
 */
export function DocumentListPage({
  onNavigateHome,
  onNavigateClients,
  onNewQuote,
  onSelectQuote
}: DocumentListPageProps): ReactElement {
  const [tab, setTab] = useState<Tab>('quote')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [clientId, setClientId] = useState<number | ''>('')
  const [amountMin, setAmountMin] = useState('')
  const [amountMax, setAmountMax] = useState('')
  const [clients, setClients] = useState<Client[]>([])
  const [quotes, setQuotes] = useState<QuoteSummary[] | null>(null)

  useEffect(() => {
    window.jimuhubApi.listClients({ statusFilter: 'active' }).then(setClients)
  }, [])

  useEffect(() => {
    if (tab !== 'quote') {
      return
    }
    let cancelled = false
    window.jimuhubApi
      .listQuotes({
        clientId: clientId === '' ? undefined : clientId,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        amountMin: amountMin === '' ? undefined : Number(amountMin),
        amountMax: amountMax === '' ? undefined : Number(amountMax)
      })
      .then((result) => {
        if (!cancelled) {
          setQuotes(result)
        }
      })
    return () => {
      cancelled = true
    }
  }, [tab, clientId, dateFrom, dateTo, amountMin, amountMax])

  return (
    <AppShell
      screenName="見積書・請求書"
      activeMenu="documents"
      pageTitle="見積書・請求書"
      headerActions={
        tab === 'quote' ? (
          <Button variant="primary" onClick={onNewQuote}>
            + 見積書を新規作成
          </Button>
        ) : (
          <Button variant="primary" disabled>
            + 請求書を新規作成
          </Button>
        )
      }
      onNavigateHome={onNavigateHome}
      onNavigateClients={onNavigateClients}
      onNavigateDocuments={() => {}}
      onComingSoon={() => {}}
    >
      <div className="tabs">
        <button
          type="button"
          className={`tab${tab === 'quote' ? ' active' : ''}`}
          onClick={() => setTab('quote')}
        >
          見積書
        </button>
        <button
          type="button"
          className={`tab${tab === 'invoice' ? ' active' : ''}`}
          onClick={() => setTab('invoice')}
        >
          請求書
        </button>
      </div>

      {tab === 'invoice' ? (
        <Message variant="warning">「請求書」は以降のイテレーションで実装予定です。</Message>
      ) : (
        <>
          <div className="filter-bar">
            <div className="filter-field">
              <label htmlFor="doc-list-date-from">発行日</label>
              <div className="filter-range">
                <input
                  id="doc-list-date-from"
                  type="date"
                  aria-label="発行日(開始)"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
                <span>〜</span>
                <input
                  type="date"
                  aria-label="発行日(終了)"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>
            </div>
            <div className="filter-field">
              <label htmlFor="doc-list-client">取引先</label>
              <select
                id="doc-list-client"
                style={{ width: 200 }}
                value={clientId}
                onChange={(e) => setClientId(e.target.value === '' ? '' : Number(e.target.value))}
              >
                <option value="">すべて</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="filter-field">
              <label htmlFor="doc-list-amount-min">金額</label>
              <div className="filter-range amount-range">
                <input
                  id="doc-list-amount-min"
                  type="number"
                  placeholder="下限"
                  aria-label="金額(下限)"
                  value={amountMin}
                  onChange={(e) => setAmountMin(e.target.value)}
                />
                <span>〜</span>
                <input
                  type="number"
                  placeholder="上限"
                  aria-label="金額(上限)"
                  value={amountMax}
                  onChange={(e) => setAmountMax(e.target.value)}
                />
              </div>
            </div>
          </div>

          {quotes === null ? null : quotes.length === 0 ? (
            <div className="empty-state">{QUOTE_MESSAGES.emptyList}</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>書類番号</th>
                  <th>取引先</th>
                  <th>発行日</th>
                  <th className="amount">合計金額</th>
                  <th>状態</th>
                </tr>
              </thead>
              <tbody>
                {quotes.map((quote) => (
                  <tr key={quote.id} className="clickable" onClick={() => onSelectQuote(quote.id)}>
                    <td>{quote.quoteNumber ?? '(未採番)'}</td>
                    <td>{quote.clientName}</td>
                    <td>{quote.issueDate}</td>
                    <td className="amount">{`¥${quote.totalAmount.toLocaleString('ja-JP')}`}</td>
                    <td>
                      <Badge variant={quote.status === 'finalized' ? 'finalized' : 'draft'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </AppShell>
  )
}
