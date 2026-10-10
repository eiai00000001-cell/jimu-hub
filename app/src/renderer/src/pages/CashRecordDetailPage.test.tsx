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
  receipts: [],
  integrity: { recordHashOk: true, historyHashOk: true, receipts: [] }
}

const props = () => ({
  recordId: 5,
  onBackToList: vi.fn(),
  onEdit: vi.fn(),
  onDeleted: vi.fn(),
  onOpenInvoice: vi.fn()
})

function setup(
  record: CashRecordDetail,
  overrides: Record<string, unknown> = {}
): Record<string, ReturnType<typeof vi.fn>> {
  const api = {
    getRecord: vi.fn().mockResolvedValue(record),
    listProjectLinkHistory: vi.fn().mockResolvedValue([]),
    deleteRecord: vi.fn().mockResolvedValue({ success: true }),
    ...overrides
  }
  window.jimuhubApi = api as unknown as Window['jimuhubApi']
  return api as unknown as Record<string, ReturnType<typeof vi.fn>>
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
    setup({
      ...base,
      receipts: [],
      integrity: { recordHashOk: false, historyHashOk: true, receipts: [] }
    })
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

  describe('領収書(F-22)', () => {
    const receipt = (over = {}) => ({
      id: 11,
      originalName: 'receipt.jpg',
      mimeType: 'image/jpeg' as const,
      fileSize: 412 * 1024,
      removed: false,
      state: 'ok' as const,
      ...over
    })
    const withReceipts = (receipts: ReturnType<typeof receipt>[]) => ({
      ...base,
      receipts,
      integrity: {
        recordHashOk: true,
        historyHashOk: true,
        receipts: receipts.map((r) => ({ id: r.id, state: r.state }))
      }
    })
    const apiWith = (record: unknown, overrides = {}) =>
      setup(record as CashRecordDetail, {
        getReceiptThumbnail: vi.fn().mockResolvedValue({
          success: true,
          state: 'ok',
          kind: 'image',
          mimeType: 'image/jpeg',
          dataUrl: 'data:image/jpeg;base64,AAAA'
        }),
        getReceiptPreview: vi.fn().mockResolvedValue({
          success: true,
          state: 'ok',
          kind: 'image',
          mimeType: 'image/jpeg',
          dataUrl: 'data:image/jpeg;base64,BBBB'
        }),
        openReceipt: vi.fn().mockResolvedValue({ success: true }),
        showReceiptInFolder: vi.fn().mockResolvedValue({ success: true }),
        ...overrides
      })

    it('領収書のカード(名前・形式・サイズ・サムネイル)を表示し、開く・Finderで表示を呼べる', async () => {
      const api = apiWith(withReceipts([receipt()]))
      render(<CashRecordDetailPage {...props()} />)
      expect(await screen.findByText('receipt.jpg')).toBeInTheDocument()
      expect(screen.getByText('JPEG · 412 KB')).toBeInTheDocument()
      const img = await screen.findByAltText('')
      expect(img).toHaveAttribute('src', 'data:image/jpeg;base64,AAAA')
      await userEvent.click(screen.getByText('開く'))
      await userEvent.click(screen.getByText('Finderで表示'))
      await waitFor(() => expect(api['openReceipt']).toHaveBeenCalledWith(11))
      expect(api['showReceiptInFolder']).toHaveBeenCalledWith(11)
    })

    it('サムネイル押下で拡大表示ダイアログを開き、Escで閉じる。「開く(OS標準アプリ)」で外部アプリを開く', async () => {
      const api = apiWith(withReceipts([receipt()]))
      render(<CashRecordDetailPage {...props()} />)
      await userEvent.click(await screen.findByLabelText('receipt.jpgを拡大表示'))
      const dialog = await screen.findByRole('dialog')
      expect(await screen.findByAltText('receipt.jpg')).toHaveAttribute(
        'src',
        'data:image/jpeg;base64,BBBB'
      )
      await userEvent.click(screen.getByText('開く(OS標準アプリ)'))
      expect(api['openReceipt']).toHaveBeenCalledWith(11)
      await userEvent.keyboard('{Escape}')
      await waitFor(() => expect(dialog).not.toBeInTheDocument())
    })

    it('PDFは拡大せず案内を表示する', async () => {
      apiWith(withReceipts([receipt({ originalName: 'a.pdf', mimeType: 'application/pdf' })]), {
        getReceiptThumbnail: vi.fn().mockResolvedValue({ success: true, state: 'ok', kind: 'pdf' }),
        getReceiptPreview: vi.fn().mockResolvedValue({ success: true, state: 'ok', kind: 'pdf' })
      })
      render(<CashRecordDetailPage {...props()} />)
      await userEvent.click(await screen.findByLabelText('a.pdfを拡大表示'))
      expect(
        await screen.findByText(
          'PDFはアプリ内では表示できません。「開く(OS標準アプリ)」でご確認ください'
        )
      ).toBeInTheDocument()
    })

    it('改変・欠落の領収書は警告を表示し、サムネイルは警告アイコン、拡大表示も警告のみ(画像を表示しない)', async () => {
      apiWith(
        withReceipts([
          receipt({ state: 'mismatch' }),
          receipt({ id: 12, originalName: 'm.png', state: 'missing' })
        ]),
        {
          getReceiptThumbnail: vi.fn().mockResolvedValue({ success: false, state: 'mismatch' }),
          getReceiptPreview: vi.fn().mockResolvedValue({ success: false, state: 'mismatch' })
        }
      )
      render(<CashRecordDetailPage {...props()} />)
      expect(
        await screen.findByText('ファイルの改変が疑われます', { selector: '.badge' })
      ).toBeInTheDocument()
      expect(
        screen.getByText('ファイルが見つかりません', { selector: '.badge' })
      ).toBeInTheDocument()
      await userEvent.click(screen.getByLabelText('receipt.jpgを拡大表示'))
      expect(await screen.findByRole('alert')).toHaveTextContent('ファイルの改変が疑われます')
      expect(screen.queryByAltText('receipt.jpg')).not.toBeInTheDocument()
    })

    it('外した領収書も表示し(「外した領収書」)、領収書を開けない場合は文言を表示する', async () => {
      apiWith(withReceipts([receipt({ removed: true })]), {
        openReceipt: vi
          .fn()
          .mockResolvedValue({ success: false, error: '領収書ファイルが見つかりません。案内' })
      })
      render(<CashRecordDetailPage {...props()} />)
      expect(await screen.findByText('外した領収書')).toBeInTheDocument()
      await userEvent.click(screen.getByText('開く'))
      expect(await screen.findByText('領収書ファイルが見つかりません。案内')).toBeInTheDocument()
    })
  })

  describe('案件(F-30)', () => {
    it('紐づく案件と「案件を変更」を表示する。案件がなければ「案件なし」', async () => {
      setup({ ...base, project: { id: 7, name: 'アルファ保守', status: 'active' } })
      const onOpenProject = vi.fn()
      render(<CashRecordDetailPage {...props()} onOpenProject={onOpenProject} />)
      await userEvent.click(await screen.findByText('アルファ保守'))
      expect(onOpenProject).toHaveBeenCalledWith(7)
      expect(screen.getByRole('button', { name: '案件を変更' })).toBeInTheDocument()
    })

    it('取消済の記録でも「案件を変更」を表示するが、削除済みの記録(読み取り専用)では表示しない', async () => {
      setup({ ...base, status: 'cancelled' })
      const { unmount } = render(<CashRecordDetailPage {...props()} />)
      expect(await screen.findByRole('button', { name: '案件を変更' })).toBeInTheDocument()
      unmount()

      setup({ ...base, isDeleted: true })
      render(<CashRecordDetailPage {...props()} />)
      await screen.findByText('案件なし')
      expect(screen.queryByRole('button', { name: '案件を変更' })).not.toBeInTheDocument()
    })
  })
})
