// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SummaryPanel } from './SummaryPanel'
import type { SummaryResult } from '@shared/types/summary'

const thisYear = new Date().getFullYear()
const zero = { income: 0, expense: 0, balance: 0 }
const result = (over: Partial<SummaryResult> = {}): SummaryResult => ({
  years: [thisYear - 1, thisYear],
  period: { income: 300000, expense: 6600, balance: 293400 },
  monthly: Array.from({ length: 12 }, (_, i) =>
    i === 8
      ? { month: 9, income: 300000, expense: 6600, balance: 293400 }
      : { month: i + 1, ...zero }
  ),
  yearTotal: { income: 300000, expense: 56600, balance: 243400 },
  yearly: [{ year: thisYear - 1, income: 100, expense: 400, balance: -300 }],
  expenseByAccount: [{ accountId: 1, accountName: '通信費', total: 6600 }],
  ...over
})

describe('SummaryPanel(F-23)', () => {
  let getSummary: ReturnType<typeof vi.fn>
  beforeEach(() => {
    getSummary = vi.fn().mockResolvedValue(result())
    window.jimuhubApi = { getSummary } as unknown as Window['jimuhubApi']
  })

  it('当年・年全体で取得し、合計カード・月別(12行+合計)・科目別・年別を表示する', async () => {
    render(<SummaryPanel />)
    await waitFor(() => expect(getSummary).toHaveBeenCalledWith({ year: thisYear, month: null }))
    expect(await screen.findByText(`${thisYear}年 入金合計`)).toBeInTheDocument()
    expect(screen.getAllByText('+¥300,000').length).toBeGreaterThan(0)
    expect(screen.getAllByText('−¥6,600').length).toBeGreaterThan(0)
    expect(screen.getByText(`${thisYear}年 合計`)).toBeInTheDocument()
    expect(screen.getByText('−¥300')).toBeInTheDocument()
    expect(screen.getByText('通信費')).toBeInTheDocument()
    expect(screen.getAllByText('¥0').length).toBeGreaterThan(0)
  })

  it('月別の行を押すとその月を選択して再取得し、年・月の選択でも再取得する', async () => {
    render(<SummaryPanel />)
    await screen.findByText('9月', { selector: 'td' })
    await userEvent.click(screen.getByText('9月', { selector: 'td' }))
    await waitFor(() => expect(getSummary).toHaveBeenLastCalledWith({ year: thisYear, month: 9 }))
    expect(await screen.findByText(`${thisYear}年9月 入金合計`)).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('年'), String(thisYear - 1))
    await waitFor(() =>
      expect(getSummary).toHaveBeenLastCalledWith({ year: thisYear - 1, month: 9 })
    )
    await userEvent.selectOptions(screen.getByLabelText('月'), '')
    await waitFor(() =>
      expect(getSummary).toHaveBeenLastCalledWith({ year: thisYear - 1, month: null })
    )
  })

  it('記録が無い期間は0円で表示する', async () => {
    getSummary.mockResolvedValue(
      result({
        period: zero,
        yearTotal: zero,
        yearly: [],
        expenseByAccount: [],
        monthly: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, ...zero }))
      })
    )
    render(<SummaryPanel />)
    const total = await screen.findByText(`${thisYear}年 合計`)
    expect(within(total.closest('tr')!).getAllByText('¥0')).toHaveLength(3)
  })
})
