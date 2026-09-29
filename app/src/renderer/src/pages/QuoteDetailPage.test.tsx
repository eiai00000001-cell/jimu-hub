// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QuoteDetailPage } from './QuoteDetailPage'
import type { Quote } from '@shared/types/quote'

const draftQuote: Quote = {
  id: 5,
  quoteNumber: null,
  clientId: 1,
  clientName: 'サンプル商事株式会社',
  clientHonorific: '御中',
  issueDate: '2026-09-25',
  validUntil: null,
  remarks: null,
  subtotal10: 88000,
  taxAmount10: 8800,
  subtotal8: 0,
  taxAmount8: 0,
  totalAmount: 96800,
  invoiceFormat: null,
  status: 'draft',
  pdfPath: null,
  pdfHash: null,
  pdfHashMismatch: false,
  lineItems: [
    {
      id: 1,
      lineNo: 1,
      name: 'デザイン制作',
      quantity: 1,
      unit: '式',
      unitPrice: 88000,
      taxRate: 10,
      amount: 88000
    }
  ],
  createdAt: '2026-09-25T00:00:00.000Z',
  updatedAt: '2026-09-25T00:00:00.000Z'
}

const finalizedQuote: Quote = {
  ...draftQuote,
  id: 8,
  quoteNumber: '2026-008',
  status: 'finalized',
  pdfPath: '/tmp/2026-008.pdf',
  pdfHash: 'hash123',
  remarks: '初回打ち合わせ内容に基づく概算見積です。'
}

function setupApi(overrides: Partial<Window['jimuhubApi']> = {}): {
  getQuote: ReturnType<typeof vi.fn>
  openQuotePdf: ReturnType<typeof vi.fn>
  showQuotePdfInFolder: ReturnType<typeof vi.fn>
} {
  const getQuote = vi.fn().mockResolvedValue(draftQuote)
  const openQuotePdf = vi.fn().mockResolvedValue({ success: true })
  const showQuotePdfInFolder = vi.fn().mockResolvedValue({ success: true })
  window.jimuhubApi = {
    getStartupStatus: vi.fn(),
    listClients: vi.fn(),
    getClient: vi.fn(),
    createClient: vi.fn(),
    updateClient: vi.fn(),
    deactivateClient: vi.fn(),
    exportData: vi.fn(),
    importData: vi.fn(),
    getCompanyProfile: vi.fn(),
    saveCompanyProfile: vi.fn(),
    listQuotes: vi.fn(),
    getQuote,
    saveQuoteDraft: vi.fn(),
    finalizeQuote: vi.fn(),
    openQuotePdf,
    showQuotePdfInFolder,
    ...overrides
  } as unknown as Window['jimuhubApi']
  return { getQuote, openQuotePdf, showQuotePdfInFolder }
}

describe('QuoteDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('下書きの見積書は編集ボタンのみ表示する', async () => {
    setupApi()
    render(
      <QuoteDetailPage
        quoteId={5}
        onNavigateHome={vi.fn()}
        onNavigateClients={vi.fn()}
        onBackToList={vi.fn()}
        onEdit={vi.fn()}
      />
    )

    expect(await screen.findByText('デザイン制作')).toBeInTheDocument()
    expect(screen.getByText('(未採番)')).toBeInTheDocument()
    expect(screen.getByText('編集')).toBeInTheDocument()
    expect(screen.queryByText('PDFを開く')).not.toBeInTheDocument()
  })

  it('「編集」ボタン押下でonEditを呼び出す', async () => {
    setupApi()
    const onEdit = vi.fn()
    render(
      <QuoteDetailPage
        quoteId={5}
        onNavigateHome={vi.fn()}
        onNavigateClients={vi.fn()}
        onBackToList={vi.fn()}
        onEdit={onEdit}
      />
    )

    await userEvent.click(await screen.findByText('編集'))
    expect(onEdit).toHaveBeenCalledWith(5)
  })

  it('PDF保存済みの見積書はPDF操作・請求書に変換ボタンを表示する', async () => {
    const { openQuotePdf, showQuotePdfInFolder } = setupApi({
      getQuote: vi.fn().mockResolvedValue(finalizedQuote)
    })
    render(
      <QuoteDetailPage
        quoteId={8}
        onNavigateHome={vi.fn()}
        onNavigateClients={vi.fn()}
        onBackToList={vi.fn()}
        onEdit={vi.fn()}
      />
    )

    expect(await screen.findByText('2026-008')).toBeInTheDocument()
    expect(screen.queryByText('編集')).not.toBeInTheDocument()

    await userEvent.click(screen.getByText('PDFを開く'))
    await waitFor(() => expect(openQuotePdf).toHaveBeenCalledWith(8))

    await userEvent.click(screen.getByText('Finderで表示'))
    await waitFor(() => expect(showQuotePdfInFolder).toHaveBeenCalledWith(8))
  })

  it('「請求書に変換」押下では準備中の案内を表示する(T-21で実装予定)', async () => {
    setupApi({ getQuote: vi.fn().mockResolvedValue(finalizedQuote) })
    render(
      <QuoteDetailPage
        quoteId={8}
        onNavigateHome={vi.fn()}
        onNavigateClients={vi.fn()}
        onBackToList={vi.fn()}
        onEdit={vi.fn()}
      />
    )
    await screen.findByText('2026-008')

    await userEvent.click(screen.getByText('請求書に変換'))
    expect(await screen.findByText(/実装予定です/)).toBeInTheDocument()
  })

  it('復元時のハッシュ不一致がある場合、警告バッジを表示する', async () => {
    setupApi({
      getQuote: vi.fn().mockResolvedValue({ ...finalizedQuote, pdfHashMismatch: true })
    })
    render(
      <QuoteDetailPage
        quoteId={8}
        onNavigateHome={vi.fn()}
        onNavigateClients={vi.fn()}
        onBackToList={vi.fn()}
        onEdit={vi.fn()}
      />
    )

    expect(await screen.findByText('PDFファイルの改変が疑われます')).toBeInTheDocument()
  })

  it('該当レコードが存在しない場合はエラーメッセージと一覧への導線を表示する', async () => {
    setupApi({ getQuote: vi.fn().mockRejectedValue(new Error('対象の見積書が見つかりません')) })
    render(
      <QuoteDetailPage
        quoteId={999}
        onNavigateHome={vi.fn()}
        onNavigateClients={vi.fn()}
        onBackToList={vi.fn()}
        onEdit={vi.fn()}
      />
    )

    expect(await screen.findByText('対象の見積書が見つかりません')).toBeInTheDocument()
  })

  it('「一覧へ戻る」押下でonBackToListを呼び出す', async () => {
    setupApi()
    const onBackToList = vi.fn()
    render(
      <QuoteDetailPage
        quoteId={5}
        onNavigateHome={vi.fn()}
        onNavigateClients={vi.fn()}
        onBackToList={onBackToList}
        onEdit={vi.fn()}
      />
    )

    await userEvent.click(await screen.findByText('← 一覧へ戻る'))
    expect(onBackToList).toHaveBeenCalled()
  })

  it('flashMessageが渡された場合は完了メッセージを表示する', async () => {
    setupApi()
    render(
      <QuoteDetailPage
        quoteId={5}
        flashMessage="PDFとして保存しました"
        onNavigateHome={vi.fn()}
        onNavigateClients={vi.fn()}
        onBackToList={vi.fn()}
        onEdit={vi.fn()}
      />
    )

    expect(await screen.findByText('PDFとして保存しました')).toBeInTheDocument()
  })
})
