// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CashRecordDetailPage } from './CashRecordDetailPage'
import type { CashRecordDetail } from '@shared/types/cash-record'

const base: CashRecordDetail = {
  id: 5,
  recordDate: '2026-09-28',
  kind: 'expense',
  amount: 6600,
  withholdingTaxAmount: 0,
  accountId: 1,
  accountName: '通信費',
  description: 'インターネット回線(9月分)',
  clientId: null,
  clientName: null,
  paymentMethod: 'credit_card',
  taxCategory: 'standard_10',
  taxAmount: 600,
  invoiceId: null,
  invoiceNumber: null,
  status: 'active',
  isDeleted: false,
  createdAt: '2026-09-28T09:20:00.000Z',
  updatedAt: '2026-09-29T00:05:00.000Z',
  history: [
    {
      id: 2,
      recordId: 5,
      operation: 'update',
      operatedAt: '2026-09-29T00:05:00.000Z',
      reason: '税区分の追加',
      changes: [{ label: '税区分', before: '(未選択)', after: '10%' }]
    },
    {
      id: 1,
      recordId: 5,
      operation: 'create',
      operatedAt: '2026-09-28T09:20:00.000Z',
      reason: null,
      changes: []
    }
  ],
  integrity: { recordHashOk: true, historyHashOk: true }
}

const props = () => ({
  recordId: 5,
  onBackToList: vi.fn(),
  onEdit: vi.fn(),
  onDeleted: vi.fn(),
  onOpenInvoice: vi.fn()
})

function setup(record: CashRecordDetail, overrides = {}) {
  const api = {
    getRecord: vi.fn().mockResolvedValue(record),
    deleteRecord: vi.fn().mockResolvedValue({ success: true }),
    ...overrides
  }
  window.jimuhubApi = api as unknown as Window['jimuhubApi']
  return api
}

describe('CashRecordDetailPage(F-18・F-20)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('記録の全項目と履歴を表示する', async () => {
    setup(base)
    render(<CashRecordDetailPage {...props()} />)
    expect(
      await screen.findByText('インターネット回線(9月分)', { selector: 'dd' })
    ).toBeInTheDocument()
    expect(screen.getByText('−¥6,600')).toBeInTheDocument()
    expect(screen.getByText('クレジットカード')).toBeInTheDocument()
    expect(screen.getByText('10%', { selector: 'dd' })).toBeInTheDocument()
    expect(screen.getByText('¥600')).toBeInTheDocument()
    expect(screen.getByText('新規登録')).toBeInTheDocument()
    expect(screen.getByText('税区分: (未選択) → 10%')).toBeInTheDocument()
    expect(screen.queryByText('この記録の改変が疑われます')).not.toBeInTheDocument()
  })

  it('記録ハッシュ不一致の場合は改変の警告を表示する', async () => {
    setup({ ...base, integrity: { recordHashOk: false, historyHashOk: true } })
    render(<CashRecordDetailPage {...props()} />)
    expect(await screen.findByText('この記録の改変が疑われます')).toBeInTheDocument()
  })

  it('編集ボタンでonEditを呼ぶ', async () => {
    setup(base)
    const p = props()
    render(<CashRecordDetailPage {...p} />)
    await userEvent.click(await screen.findByText('編集'))
    expect(p.onEdit).toHaveBeenCalledWith(5)
  })

  it('削除: 確認ダイアログで変更理由(任意)を入力して削除し、onDeletedを呼ぶ。いいえでは削除しない', async () => {
    const api = setup(base)
    const p = props()
    render(<CashRecordDetailPage {...p} />)
    await userEvent.click(await screen.findByText('削除'))
    expect(screen.getByText('この記録を削除しますか')).toBeInTheDocument()
    await userEvent.click(screen.getByText('いいえ'))
    expect(api.deleteRecord).not.toHaveBeenCalled()
    await userEvent.click(screen.getByText('削除'))
    await userEvent.type(screen.getByLabelText('変更理由(任意)'), '二重登録')
    await userEvent.click(screen.getByText('はい'))
    await waitFor(() =>
      expect(api.deleteRecord).toHaveBeenCalledWith({ id: 5, reason: '二重登録' })
    )
    expect(p.onDeleted).toHaveBeenCalled()
  })

  it('請求書から作成された入金記録は削除せず案内を表示し、請求書番号のリンクで請求書へ遷移する', async () => {
    const api = setup({
      ...base,
      kind: 'income',
      invoiceId: 7,
      invoiceNumber: '2026-012',
      accountName: '売上高'
    })
    const p = props()
    render(<CashRecordDetailPage {...p} />)
    await userEvent.click(await screen.findByText('削除'))
    expect(
      await screen.findByText('請求書側で入金済みを取り消すと、この入金記録は取消済になります')
    ).toBeInTheDocument()
    expect(api.deleteRecord).not.toHaveBeenCalled()
    await userEvent.click(screen.getByText('2026-012'))
    expect(p.onOpenInvoice).toHaveBeenCalledWith(7)
  })

  it('取消済・削除済みの記録は編集・削除ボタンを表示しない', async () => {
    setup({ ...base, status: 'cancelled' })
    const { unmount } = render(<CashRecordDetailPage {...props()} />)
    expect(await screen.findByText('取消済', { selector: '.badge' })).toBeInTheDocument()
    expect(screen.queryByText('編集')).not.toBeInTheDocument()
    unmount()
    setup({ ...base, isDeleted: true })
    render(<CashRecordDetailPage {...props()} />)
    expect(await screen.findByText('削除済み')).toBeInTheDocument()
    expect(screen.queryByText('編集')).not.toBeInTheDocument()
    expect(screen.queryByText('削除', { selector: 'button' })).not.toBeInTheDocument()
  })

  it('存在しない記録はエラーを表示する', async () => {
    window.jimuhubApi = {
      getRecord: vi.fn().mockRejectedValue(new Error('対象の記録が見つかりません'))
    } as unknown as Window['jimuhubApi']
    render(<CashRecordDetailPage {...props()} />)
    expect(await screen.findByText('対象の記録が見つかりません')).toBeInTheDocument()
  })
})
