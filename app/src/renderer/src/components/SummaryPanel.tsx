import { useEffect, useState, type ReactElement } from 'react'
import type { SummaryResult } from '@shared/types/summary'
import { formatYen } from '../utils/format'
import { todayIso } from '../utils/format'

/** 入金は「+」、経費は「−」を付ける。0円は記号なし(例: ¥0)。差額は符号つき */
const plus = (value: number): string => (value === 0 ? formatYen(0) : `+${formatYen(value)}`)
const minus = (value: number): string => (value === 0 ? formatYen(0) : `−${formatYen(value)}`)
const balance = (value: number): string =>
  value === 0 ? formatYen(0) : value > 0 ? `+${formatYen(value)}` : `−${formatYen(-value)}`

/**
 * 集計タブ(月別・年別・勘定科目別。表のみ)[F-23]
 * 参照元: 詳細設計書3.19章・4.23章、5章(`SummaryPage`)
 */
export function SummaryPanel(): ReactElement {
  const now = Number(todayIso().slice(0, 4))
  const [year, setYear] = useState(now)
  const [month, setMonth] = useState<number | null>(null)
  const [summary, setSummary] = useState<SummaryResult | null>(null)

  useEffect(() => {
    let cancelled = false
    window.jimuhubApi.getSummary({ year, month }).then((r) => {
      if (!cancelled) setSummary(r)
    })
    return () => {
      cancelled = true
    }
  }, [year, month])

  const label = month === null ? `${year}年` : `${year}年${month}月`

  return (
    <>
      <div className="filter-bar">
        <div className="filter-field">
          <label htmlFor="summary-year">年</label>
          <select id="summary-year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {(summary?.years ?? [now]).map((y) => (
              <option key={y} value={y}>
                {y}年
              </option>
            ))}
          </select>
        </div>
        <div className="filter-field">
          <label htmlFor="summary-month">月</label>
          <select
            id="summary-month"
            value={month ?? ''}
            onChange={(e) => setMonth(e.target.value === '' ? null : Number(e.target.value))}
          >
            <option value="">年全体</option>
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {i + 1}月
              </option>
            ))}
          </select>
        </div>
      </div>

      {summary === null ? null : (
        <>
          <div className="summary-cards">
            <div className="summary-card">
              <div className="label">{`${label} 入金合計`}</div>
              <div className="value">{plus(summary.period.income)}</div>
            </div>
            <div className="summary-card">
              <div className="label">{`${label} 経費合計`}</div>
              <div className="value">{minus(summary.period.expense)}</div>
            </div>
            <div className="summary-card">
              <div className="label">差額(入金合計 − 経費合計)</div>
              <div className="value">{balance(summary.period.balance)}</div>
            </div>
          </div>

          <div className="summary-grid">
            <div>
              <div className="block-title">月別(行を押すと、その月を選択します)</div>
              <table className="table">
                <thead>
                  <tr>
                    <th>月</th>
                    <th className="num">入金合計</th>
                    <th className="num">経費合計</th>
                    <th className="num">差額</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.monthly.map((m) => (
                    <tr
                      key={m.month}
                      className={`clickable${month === m.month ? ' selected' : ''}`}
                      onClick={() => setMonth(m.month)}
                    >
                      <td>{m.month}月</td>
                      <td className="num">{plus(m.income)}</td>
                      <td className="num">{minus(m.expense)}</td>
                      <td className="num">{balance(m.balance)}</td>
                    </tr>
                  ))}
                  <tr className="total">
                    <td>{year}年 合計</td>
                    <td className="num">{plus(summary.yearTotal.income)}</td>
                    <td className="num">{minus(summary.yearTotal.expense)}</td>
                    <td className="num">{balance(summary.yearTotal.balance)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div>
              <div className="block-title">{`勘定科目別の経費合計(${label})`}</div>
              <table className="table">
                <thead>
                  <tr>
                    <th>勘定科目</th>
                    <th className="num">経費合計</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.expenseByAccount.map((a) => (
                    <tr key={a.accountId}>
                      <td>{a.accountName}</td>
                      <td className="num">{minus(a.total)}</td>
                    </tr>
                  ))}
                  <tr className="total">
                    <td>経費合計</td>
                    <td className="num">{minus(summary.period.expense)}</td>
                  </tr>
                </tbody>
              </table>
              <div className="block-title" style={{ marginTop: 20 }}>
                年別
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>年</th>
                    <th className="num">入金合計</th>
                    <th className="num">経費合計</th>
                    <th className="num">差額</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.yearly.map((y) => (
                    <tr
                      key={y.year}
                      className={`clickable${year === y.year ? ' selected' : ''}`}
                      onClick={() => setYear(y.year)}
                    >
                      <td>{y.year}年</td>
                      <td className="num">{plus(y.income)}</td>
                      <td className="num">{minus(y.expense)}</td>
                      <td className="num">{balance(y.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p
            style={{
              fontSize: 11,
              color: 'var(--color-text-secondary)',
              margin: '12px 0 0',
              lineHeight: 1.6
            }}
          >
            集計は表のみです(グラフなし)。取消済・削除済の記録は含みません。金額は税込で、請求書から自動作成した入金は源泉徴収後の実入金額です。
          </p>
        </>
      )}
    </>
  )
}
