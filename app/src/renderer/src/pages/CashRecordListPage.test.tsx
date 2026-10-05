// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CashRecordListPage } from './CashRecordListPage'
import type { CashRecordSummary } from '@shared/types/cash-record'

const expense: CashRecordSummary = {
  id: 1,
  recordDate: '2026-09-28',
  kind: 'expense',
  amount: 6600,
  status: 'active',
  invoiceId: null,
  invoiceNumber: null,
  accountName: '通信費',
  clientName: null,
  description: 'インターネット回線(9月分)',
  receiptCount: 1
}
const income: CashRecordSummary = {
  id: 2,
  recordDate: '2026-09-30',
  kind: 'income',
  amount: 332370,
  status: 'active',
  invoiceId: 7,
  invoiceNumber: '2026-012',
  accountName: '売上高',
  clientName: 'サンプル商事株式会社',
  description: '入金(請求書から自動作成)',
  receiptCount: 0
}
const cancelled: CashRecordSummary = { ...income, id: 3, status: 'cancelled' }

function setup(items: CashRecordSummary[] = [income, expense, cancelled], overrides = {}) {
  const listRecords = vi
    .fn()
    .mockResolvedValue({ items, totalCount: items.length, page: 1, pageSize: 50 })
  window.jimuhubApi = {
    listRecords,
    listClients: vi
      .fn()
      .mockResolvedValue([{ id: 1, name: 'サンプル商事株式会社', status: 'active' }]),
    listAccounts: vi.fn().mockResolvedValue([
      { id: 1, name: '通信費', kind: 'expense', status: 'active' },
      { id: 2, name: '売上高', kind: 'income', status: 'active' }
    ]),
    listRecordHistory: vi
      .fn()
      .mockResolvedValue({ items: [], totalCount: 0, page: 1, pageSize: 50 }),
    ...overrides
  } as unknown as Window['jimuhubApi']
  return listRecords
}

const props = () => ({
  onNewRecord: vi.fn(),
  onSelectRecord: vi.fn(),
  onOpenAccounts: vi.fn(),
  onOpenInvoice: vi.fn()
})

describe('CashRecordListPage(F-19)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('一覧を表示し、金額に+/−記号、取消済のバッジ、領収書件数、請求書番号を表示する', async () => {
    setup()
    render(<CashRecordListPage {...props()} />)
    expect(await screen.findAllByText('+¥332,370', { selector: '.sign' })).toHaveLength(2)
    expect(screen.getByText('−¥6,600')).toBeInTheDocument()
    expect(screen.getByText('取消済')).toBeInTheDocument()
    expect(screen.getByText('1件')).toBeInTheDocument()
    expect(screen.getAllByText('2026-012').length).toBeGreaterThan(0)
    expect(screen.getByText('全3件(1ページ50件)/ 1 / 1 ページ')).toBeInTheDocument()
  })

  it('0件の場合は案内を表示する', async () => {
    setup([])
    render(<CashRecordListPage {...props()} />)
    expect(await screen.findByText('該当する記録がありません')).toBeInTheDocument()
  })

  it('登録ボタン・勘定科目の管理・行クリック・請求書番号リンクのコールバックを呼ぶ', async () => {
    setup()
    const p = props()
    render(<CashRecordListPage {...p} />)
    await userEvent.click(await screen.findByText('+ 入金を登録'))
    await userEvent.click(screen.getByText('+ 経費を登録'))
    await userEvent.click(screen.getByText('勘定科目の管理'))
    expect(p.onNewRecord).toHaveBeenNthCalledWith(1, 'income')
    expect(p.onNewRecord).toHaveBeenNthCalledWith(2, 'expense')
    expect(p.onOpenAccounts).toHaveBeenCalled()
    await userEvent.click(screen.getAllByText('2026-012', { selector: 'button' })[0]!)
    expect(p.onOpenInvoice).toHaveBeenCalledWith(7)
    expect(p.onSelectRecord).not.toHaveBeenCalled()
    await userEvent.click(screen.getByText('インターネット回線(9月分)'))
    expect(p.onSelectRecord).toHaveBeenCalledWith(1, 'records')
  })

  it('検索条件の変更で条件つきに再取得し、ページを1へ戻す', async () => {
    const listRecords = setup()
    render(<CashRecordListPage {...props()} />)
    await screen.findByText('−¥6,600')
    await userEvent.selectOptions(screen.getByLabelText('種別'), 'expense')
    await waitFor(() =>
      expect(listRecords).toHaveBeenLastCalledWith(
        expect.objectContaining({ kind: 'expense', page: 1 })
      )
    )
    await userEvent.selectOptions(screen.getByLabelText('取引先'), '1')
    await waitFor(() =>
      expect(listRecords).toHaveBeenLastCalledWith(expect.objectContaining({ clientId: 1 }))
    )
  })

  it('日付・金額の範囲エラー中は文言を表示し、再取得しない', async () => {
    const listRecords = setup()
    render(<CashRecordListPage {...props()} />)
    await screen.findByText('−¥6,600')
    const calls = listRecords.mock.calls.length
    await userEvent.type(screen.getByLabelText('日付(開始)'), '2026-10-02')
    await userEvent.type(screen.getByLabelText('日付(終了)'), '2026-10-01')
    expect(
      await screen.findByText('日付の終了日は、開始日以降の日付を入力してください')
    ).toBeInTheDocument()
    const afterFrom = listRecords.mock.calls.length
    expect(afterFrom).toBeGreaterThanOrEqual(calls)
    await userEvent.type(screen.getByLabelText('金額(下限)'), '100')
    await userEvent.type(screen.getByLabelText('金額(上限)'), '10')
    expect(
      await screen.findByText('金額の上限は、下限以上の金額を入力してください')
    ).toBeInTheDocument()
    const last = listRecords.mock.calls.at(-1)![0]
    expect(last.dateTo === '2026-10-01' && last.dateFrom === '2026-10-02').toBe(false)
  })

  it('履歴タブへ切り替えて履歴を取得する', async () => {
    const listRecordHistory = vi.fn().mockResolvedValue({
      items: [
        {
          id: 1,
          recordId: 5,
          operation: 'update',
          operatedAt: '2026-09-29T00:05:00.000Z',
          reason: '金額訂正',
          recordDate: '2026-09-28',
          description: 'インターネット回線',
          changes: [{ label: '金額', before: '¥6,600', after: '¥7,000' }]
        }
      ],
      totalCount: 1,
      page: 1,
      pageSize: 50
    })
    setup(undefined, { listRecordHistory })
    const p = props()
    render(<CashRecordListPage {...p} />)
    await userEvent.click(await screen.findByText('履歴'))
    expect(await screen.findByText('2026-09-28 インターネット回線')).toBeInTheDocument()
    expect(screen.getByText('金額訂正')).toBeInTheDocument()
    await userEvent.click(screen.getByText('2026-09-28 インターネット回線'))
    expect(screen.getByText('¥7,000')).toBeInTheDocument()
    await userEvent.click(screen.getByText('記録を表示'))
    expect(p.onSelectRecord).toHaveBeenCalledWith(5, 'history')
  })

  it('[F-23・F-24]集計タブへ切り替えられ、CSV出力ボタンでダイアログを開く', async () => {
    setup(undefined, {
      getSummary: vi.fn().mockResolvedValue({
        years: [2026],
        period: { income: 0, expense: 0, balance: 0 },
        monthly: Array.from({ length: 12 }, (_, i) => ({
          month: i + 1,
          income: 0,
          expense: 0,
          balance: 0
        })),
        yearTotal: { income: 0, expense: 0, balance: 0 },
        yearly: [],
        expenseByAccount: []
      })
    })
    render(<CashRecordListPage {...props()} />)
    await userEvent.click(await screen.findByText('集計'))
    expect(await screen.findByText('月別(行を押すと、その月を選択します)')).toBeInTheDocument()
    await userEvent.click(screen.getByText('CSV出力'))
    expect(screen.getByRole('dialog', { name: 'CSV出力' })).toBeInTheDocument()
  })
})
