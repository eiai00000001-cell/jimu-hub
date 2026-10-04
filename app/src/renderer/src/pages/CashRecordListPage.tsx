import { useEffect, useState, type ReactElement } from 'react'
import { AppShell } from '../layout/AppShell'
import { Button, TextLink } from '../components/Button'
import { Message } from '../components/Message'
import { KindBadge, RecordStatusBadge } from '../components/RecordBadges'
import { RecordHistoryPanel } from '../components/RecordHistoryPanel'
import { formatSignedAmount } from '../utils/format'
import type { Client } from '@shared/types/client'
import type { AccountView } from '@shared/types/account'
import type {
  CashRecordSummary,
  Paged,
  RecordKind,
  RecordListFilter
} from '@shared/types/cash-record'
import { RECORD_MESSAGES, VALIDATION_MESSAGES } from '@shared/messages/messages'

export type CashTab = 'records' | 'history'

interface CashRecordListPageProps {
  initialTab?: CashTab
  flashMessage?: string
  onNewRecord: (kind: RecordKind) => void
  onSelectRecord: (id: number, from: CashTab) => void
  onOpenAccounts: () => void
  onOpenInvoice: (invoiceId: number) => void
}

/**
 * 入出金・経費一覧画面[F-19]。タブ(記録一覧/履歴)を持つ。集計タブ(F-23)・CSV出力(F-24)は後続で追加する。
 * 参照元: 詳細設計書3.15章・3.18章・4.19章、5章(`CashRecordListPage`)
 */
export function CashRecordListPage({
  initialTab = 'records',
  flashMessage,
  onNewRecord,
  onSelectRecord,
  onOpenAccounts,
  onOpenInvoice
}: CashRecordListPageProps): ReactElement {
  const [tab, setTab] = useState<CashTab>(initialTab)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [amountMin, setAmountMin] = useState('')
  const [amountMax, setAmountMax] = useState('')
  const [clientId, setClientId] = useState('')
  const [accountId, setAccountId] = useState('')
  const [kind, setKind] = useState<RecordKind | ''>('')
  const [page, setPage] = useState(1)
  const [clients, setClients] = useState<Client[]>([])
  const [accounts, setAccounts] = useState<AccountView[]>([])
  const [result, setResult] = useState<Paged<CashRecordSummary> | null>(null)

  useEffect(() => {
    window.jimuhubApi.listClients({ statusFilter: 'all' }).then(setClients)
    window.jimuhubApi.listAccounts({ includeInactive: true }).then(setAccounts)
  }, [])

  const toNumber = (value: string): number | undefined =>
    value.trim() === '' ? undefined : Number(value)
  const dateError =
    dateFrom !== '' && dateTo !== '' && dateTo < dateFrom ? RECORD_MESSAGES.dateRangeInvalid : null
  const min = toNumber(amountMin)
  const max = toNumber(amountMax)
  const amountError =
    min !== undefined && max !== undefined && max < min
      ? VALIDATION_MESSAGES.amountRangeInvalid
      : null
  const hasError = dateError !== null || amountError !== null

  useEffect(() => {
    if (tab !== 'records' || hasError) return
    let cancelled = false
    const filter: RecordListFilter = {
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      amountMin: min,
      amountMax: max,
      clientId: clientId ? Number(clientId) : undefined,
      accountId: accountId ? Number(accountId) : undefined,
      kind: kind || undefined,
      page
    }
    window.jimuhubApi.listRecords(filter).then((r) => {
      if (!cancelled) setResult(r)
    })
    return () => {
      cancelled = true
    }
    // min・maxはamountMin・amountMaxから導出される値のため、依存配列には元の文字列を指定する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, dateFrom, dateTo, amountMin, amountMax, clientId, accountId, kind, page, hasError])

  /** 検索条件の変更時はページを1へ戻す */
  const change =
    <T,>(setter: (value: T) => void) =>
    (value: T): void => {
      setter(value)
      setPage(1)
    }

  const totalPages = result ? Math.max(1, Math.ceil(result.totalCount / result.pageSize)) : 1

  return (
    <AppShell
      screenName="入出金・経費"
      activeMenu="cash"
      pageTitle="入出金・経費"
      headerActions={
        <>
          <Button onClick={onOpenAccounts}>勘定科目の管理</Button>
          <Button onClick={() => onNewRecord('expense')}>+ 経費を登録</Button>
          <Button variant="primary" onClick={() => onNewRecord('income')}>
            + 入金を登録
          </Button>
        </>
      }
    >
      {flashMessage ? <Message variant="success">{flashMessage}</Message> : null}

      <div className="tabs">
        <button
          type="button"
          className={`tab${tab === 'records' ? ' active' : ''}`}
          onClick={() => setTab('records')}
        >
          記録一覧
        </button>
        <button
          type="button"
          className={`tab${tab === 'history' ? ' active' : ''}`}
          onClick={() => setTab('history')}
        >
          履歴
        </button>
      </div>

      {tab === 'history' ? (
        <RecordHistoryPanel onShowRecord={(id) => onSelectRecord(id, 'history')} />
      ) : (
        <>
          <div className="filter-bar">
            <div className={`filter-field${dateError ? ' error' : ''}`}>
              <label>日付</label>
              <div className="filter-range">
                <input
                  type="date"
                  aria-label="日付(開始)"
                  value={dateFrom}
                  onChange={(e) => change(setDateFrom)(e.target.value)}
                />
                <span>〜</span>
                <input
                  type="date"
                  aria-label="日付(終了)"
                  value={dateTo}
                  onChange={(e) => change(setDateTo)(e.target.value)}
                />
              </div>
            </div>
            <div className={`filter-field${amountError ? ' error' : ''}`}>
              <label>金額</label>
              <div className="filter-range amount">
                <input
                  type="number"
                  min={0}
                  placeholder="下限"
                  aria-label="金額(下限)"
                  value={amountMin}
                  onChange={(e) => change(setAmountMin)(e.target.value)}
                />
                <span>〜</span>
                <input
                  type="number"
                  min={0}
                  placeholder="上限"
                  aria-label="金額(上限)"
                  value={amountMax}
                  onChange={(e) => change(setAmountMax)(e.target.value)}
                />
              </div>
            </div>
            <div className="filter-field">
              <label htmlFor="cash-filter-client">取引先</label>
              <select
                id="cash-filter-client"
                style={{ width: 180 }}
                value={clientId}
                onChange={(e) => change(setClientId)(e.target.value)}
              >
                <option value="">すべて</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="filter-field">
              <label htmlFor="cash-filter-account">勘定科目</label>
              <select
                id="cash-filter-account"
                style={{ width: 150 }}
                value={accountId}
                onChange={(e) => change(setAccountId)(e.target.value)}
              >
                <option value="">すべて</option>
                <optgroup label="経費">
                  {accounts
                    .filter((a) => a.kind === 'expense')
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </optgroup>
                <optgroup label="収入">
                  {accounts
                    .filter((a) => a.kind === 'income')
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </optgroup>
              </select>
            </div>
            <div className="filter-field">
              <label htmlFor="cash-filter-kind">種別</label>
              <select
                id="cash-filter-kind"
                value={kind}
                onChange={(e) => change(setKind)(e.target.value as RecordKind | '')}
              >
                <option value="">すべて</option>
                <option value="income">入金</option>
                <option value="expense">経費</option>
              </select>
            </div>
          </div>
          {dateError ? <Message variant="error">{dateError}</Message> : null}
          {amountError ? <Message variant="error">{amountError}</Message> : null}

          {result === null ? null : result.items.length === 0 ? (
            <div className="empty-state">{RECORD_MESSAGES.emptyList}</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>日付</th>
                  <th>種別</th>
                  <th>勘定科目</th>
                  <th>摘要・メモ</th>
                  <th>取引先</th>
                  <th className="num">金額</th>
                  <th>状態</th>
                  <th>領収書</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((item) => (
                  <tr
                    key={item.id}
                    className={`clickable${item.status === 'cancelled' ? ' cancelled' : ''}`}
                    onClick={() => onSelectRecord(item.id, 'records')}
                  >
                    <td>{item.recordDate}</td>
                    <td>
                      <KindBadge kind={item.kind} />
                    </td>
                    <td>{item.accountName}</td>
                    <td>
                      {item.description}
                      {item.invoiceId !== null ? (
                        <span className="sub">
                          請求書{' '}
                          <TextLink
                            onClick={(event) => {
                              event.stopPropagation()
                              onOpenInvoice(item.invoiceId as number)
                            }}
                          >
                            {item.invoiceNumber ?? '(未採番)'}
                          </TextLink>
                        </span>
                      ) : null}
                    </td>
                    <td>{item.clientName ?? '-'}</td>
                    <td className="num">
                      <span className="sign">{formatSignedAmount(item.kind, item.amount)}</span>
                    </td>
                    <td>
                      <RecordStatusBadge status={item.status} />
                    </td>
                    <td>{item.receiptCount > 0 ? `${item.receiptCount}件` : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {result ? (
            <div className="pager">
              <span>{`全${result.totalCount}件(1ページ${result.pageSize}件)/ ${result.page} / ${totalPages} ページ`}</span>
              <div className="btns">
                <Button className="btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  前へ
                </Button>
                <Button
                  className="btn-sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage(page + 1)}
                >
                  次へ
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </AppShell>
  )
}
