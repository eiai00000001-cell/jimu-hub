// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DocumentListPage } from './DocumentListPage'
import type { QuoteSummary } from '@shared/types/quote'

const sampleQuote: QuoteSummary = {
  id: 1,
  quoteNumber: '2026-008',
  clientId: 1,
  clientName: 'サンプル商事株式会社',
  issueDate: '2026-09-20',
  totalAmount: 363000,
  status: 'finalized'
}

function setupApi(overrides: Partial<Window['jimuhubApi']> = {}): {
  listQuotes: ReturnType<typeof vi.fn>
} {
  const listQuotes = vi.fn().mockResolvedValue([sampleQuote])
  window.jimuhubApi = {
    getStartupStatus: vi.fn(),
    listClients: vi.fn().mockResolvedValue([]),
    getClient: vi.fn(),
    createClient: vi.fn(),
    updateClient: vi.fn(),
    deactivateClient: vi.fn(),
    exportData: vi.fn(),
    importData: vi.fn(),
    getCompanyProfile: vi.fn(),
    saveCompanyProfile: vi.fn(),
    listQuotes,
    listInvoices: vi.fn().mockResolvedValue([]),
    getQuote: vi.fn(),
    saveQuoteDraft: vi.fn(),
    finalizeQuote: vi.fn(),
    openQuotePdf: vi.fn(),
    showQuotePdfInFolder: vi.fn(),
    ...overrides
  } as unknown as Window['jimuhubApi']
  return { listQuotes }
}

describe('DocumentListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('初期表示は見積書タブで一覧を取得する', async () => {
    setupApi()
    render(
      <DocumentListPage
        onNavigateHome={vi.fn()}
        onNavigateClients={vi.fn()}
        onNewQuote={vi.fn()}
        onSelectQuote={vi.fn()}
        onNewInvoice={vi.fn()}
        onSelectInvoice={vi.fn()}
      />
    )

    expect(await screen.findByText('2026-008')).toBeInTheDocument()
    expect(screen.getByText('サンプル商事株式会社')).toBeInTheDocument()
    expect(screen.getByText('¥363,000')).toBeInTheDocument()
  })

  it('該当0件の場合は案内文言を表示する', async () => {
    setupApi({ listQuotes: vi.fn().mockResolvedValue([]) })
    render(
      <DocumentListPage
        onNavigateHome={vi.fn()}
        onNavigateClients={vi.fn()}
        onNewQuote={vi.fn()}
        onSelectQuote={vi.fn()}
        onNewInvoice={vi.fn()}
        onSelectInvoice={vi.fn()}
      />
    )

    expect(await screen.findByText('該当する見積書がありません')).toBeInTheDocument()
  })

  it('請求書タブへ切り替えると請求書一覧(入金ステータス列)を表示する', async () => {
    const listInvoices = vi.fn().mockResolvedValue([
      {
        id: 4,
        invoiceNumber: '2026-012',
        clientId: 1,
        clientName: 'サンプル商事株式会社',
        issueDate: '2026-09-22',
        totalAmount: 363000,
        status: 'finalized',
        paymentStatus: 'unpaid'
      }
    ])
    setupApi({ listInvoices })
    const onSelectInvoice = vi.fn()
    render(
      <DocumentListPage
        onNavigateHome={vi.fn()}
        onNavigateClients={vi.fn()}
        onNewQuote={vi.fn()}
        onSelectQuote={vi.fn()}
        onNewInvoice={vi.fn()}
        onSelectInvoice={onSelectInvoice}
      />
    )
    await screen.findByText('2026-008')

    await userEvent.click(screen.getByText('請求書'))
    expect(await screen.findByText('2026-012')).toBeInTheDocument()
    expect(screen.getByText('未収', { selector: 'span' })).toBeInTheDocument()

    await userEvent.click(screen.getByText('2026-012'))
    expect(onSelectInvoice).toHaveBeenCalledWith(4)

    await userEvent.selectOptions(screen.getByLabelText('入金ステータス'), 'paid')
    await waitFor(() =>
      expect(listInvoices).toHaveBeenLastCalledWith(
        expect.objectContaining({ paymentStatus: 'paid' })
      )
    )
  })

  it('請求書0件の場合は案内文言を表示し、「請求書を新規作成」でonNewInvoiceを呼ぶ', async () => {
    setupApi()
    const onNewInvoice = vi.fn()
    render(
      <DocumentListPage
        onNavigateHome={vi.fn()}
        onNavigateClients={vi.fn()}
        onNewQuote={vi.fn()}
        onSelectQuote={vi.fn()}
        onNewInvoice={onNewInvoice}
        onSelectInvoice={vi.fn()}
      />
    )
    await screen.findByText('2026-008')
    await userEvent.click(screen.getByText('請求書'))
    expect(await screen.findByText('該当する請求書がありません')).toBeInTheDocument()
    await userEvent.click(screen.getByText('+ 請求書を新規作成'))
    expect(onNewInvoice).toHaveBeenCalled()
  })

  it('「見積書を新規作成」ボタン押下でonNewQuoteを呼び出す', async () => {
    setupApi()
    const onNewQuote = vi.fn()
    render(
      <DocumentListPage
        onNavigateHome={vi.fn()}
        onNavigateClients={vi.fn()}
        onNewQuote={onNewQuote}
        onSelectQuote={vi.fn()}
        onNewInvoice={vi.fn()}
        onSelectInvoice={vi.fn()}
      />
    )

    await userEvent.click(screen.getByText('+ 見積書を新規作成'))
    expect(onNewQuote).toHaveBeenCalled()
  })

  it('一覧行クリックでonSelectQuoteを呼び出す', async () => {
    setupApi()
    const onSelectQuote = vi.fn()
    render(
      <DocumentListPage
        onNavigateHome={vi.fn()}
        onNavigateClients={vi.fn()}
        onNewQuote={vi.fn()}
        onSelectQuote={onSelectQuote}
        onNewInvoice={vi.fn()}
        onSelectInvoice={vi.fn()}
      />
    )

    await userEvent.click(await screen.findByText('2026-008'))
    expect(onSelectQuote).toHaveBeenCalledWith(1)
  })

  it('取引先を選択すると絞り込み条件を付与して再取得する', async () => {
    const { listQuotes } = setupApi()
    window.jimuhubApi.listClients = vi.fn().mockResolvedValue([
      {
        id: 5,
        name: 'アルファ商事株式会社',
        furigana: null,
        honorific: '御中',
        contactPerson: null,
        postalCode: null,
        address: null,
        phone: null,
        email: null,
        invoiceRegistrationNumber: null,
        memo: null,
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    ])
    render(
      <DocumentListPage
        onNavigateHome={vi.fn()}
        onNavigateClients={vi.fn()}
        onNewQuote={vi.fn()}
        onSelectQuote={vi.fn()}
        onNewInvoice={vi.fn()}
        onSelectInvoice={vi.fn()}
      />
    )
    await screen.findByText('2026-008')

    await userEvent.selectOptions(screen.getByLabelText('取引先'), '5')

    await waitFor(() =>
      expect(listQuotes).toHaveBeenLastCalledWith(expect.objectContaining({ clientId: 5 }))
    )
  })
})
