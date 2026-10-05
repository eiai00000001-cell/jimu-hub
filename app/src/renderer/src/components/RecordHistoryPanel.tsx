import { Fragment, useEffect, useState, type ReactElement } from 'react'
import { Button } from './Button'
import { Message } from './Message'
import { HISTORY_OPERATIONS, OPERATION_LABELS } from '@shared/constants/cash-record'
import { RECORD_MESSAGES } from '@shared/messages/messages'
import type { HistoryListItem, HistoryOperation, Paged } from '@shared/types/cash-record'
import { formatDateTime } from '../utils/format'

interface RecordHistoryPanelProps {
  onShowRecord: (recordId: number) => void
}

/**
 * 履歴タブ(全記録の履歴一覧)[F-20]
 * 参照元: 詳細設計書3.18章・4.20章
 */
export function RecordHistoryPanel({ onShowRecord }: RecordHistoryPanelProps): ReactElement {
  const [operation, setOperation] = useState<HistoryOperation | ''>('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<Paged<HistoryListItem> | null>(null)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  const rangeError = dateFrom !== '' && dateTo !== '' && dateTo < dateFrom

  useEffect(() => {
    if (rangeError) return
    let cancelled = false
    window.jimuhubApi
      .listRecordHistory({
        operation: operation || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        page
      })
      .then((r) => {
        if (!cancelled) setResult(r)
      })
    return () => {
      cancelled = true
    }
  }, [operation, dateFrom, dateTo, page, rangeError])

  const toggle = (id: number): void =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const totalPages = result ? Math.max(1, Math.ceil(result.totalCount / result.pageSize)) : 1

  return (
    <>
      <div className="filter-bar">
        <div className="filter-field">
          <label htmlFor="history-operation">操作の種別</label>
          <select
            id="history-operation"
            value={operation}
            onChange={(e) => {
              setOperation(e.target.value as HistoryOperation | '')
              setPage(1)
            }}
          >
            <option value="">すべて</option>
            {HISTORY_OPERATIONS.map((op) => (
              <option key={op} value={op}>
                {OPERATION_LABELS[op]}
              </option>
            ))}
          </select>
        </div>
        <div className={`filter-field${rangeError ? ' error' : ''}`}>
          <label>操作日</label>
          <div className="filter-range">
            <input
              type="date"
              aria-label="操作日(開始)"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value)
                setPage(1)
              }}
            />
            <span>〜</span>
            <input
              type="date"
              aria-label="操作日(終了)"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value)
                setPage(1)
              }}
            />
          </div>
        </div>
      </div>
      {rangeError ? <Message variant="error">{RECORD_MESSAGES.dateRangeInvalid}</Message> : null}

      {result === null ? null : result.items.length === 0 ? (
        <div className="empty-state">履歴がありません</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 24 }} />
              <th>操作日時</th>
              <th>操作</th>
              <th>記録(日付・摘要)</th>
              <th>変更理由</th>
              <th className="op">操作</th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((item) => {
              const open = expanded.has(item.id)
              return (
                <Fragment key={item.id}>
                  <tr className="clickable" onClick={() => toggle(item.id)}>
                    <td>{open ? '▾' : '▸'}</td>
                    <td>{formatDateTime(item.operatedAt)}</td>
                    <td>
                      <span
                        className={`badge ${
                          item.operation === 'delete' || item.operation === 'cancel'
                            ? 'badge-op-major'
                            : 'badge-op-minor'
                        }`}
                      >
                        {OPERATION_LABELS[item.operation]}
                      </span>
                    </td>
                    <td>{`${item.recordDate} ${item.description}`}</td>
                    <td>{item.reason ?? '-'}</td>
                    <td className="op">
                      <Button
                        className="btn-sm"
                        onClick={(event) => {
                          event.stopPropagation()
                          onShowRecord(item.recordId)
                        }}
                      >
                        記録を表示
                      </Button>
                    </td>
                  </tr>
                  {open ? (
                    <tr className="expand-row">
                      <td />
                      <td colSpan={5}>
                        <table className="table" style={{ maxWidth: 640 }}>
                          <thead>
                            <tr>
                              <th>項目</th>
                              <th>変更前</th>
                              <th>変更後</th>
                            </tr>
                          </thead>
                          <tbody>
                            {item.changes.map((change) => (
                              <tr key={change.label}>
                                <td>{change.label}</td>
                                <td>{change.before}</td>
                                <td>{change.after}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              )
            })}
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
  )
}
