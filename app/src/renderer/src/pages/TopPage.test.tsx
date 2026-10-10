// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TopPage } from './TopPage'

function setupApi(overrides: Partial<Window['jimuhubApi']> = {}): void {
  window.jimuhubApi = {
    getStartupStatus: vi.fn().mockResolvedValue({ ok: true }),
    listClients: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
    getClient: vi.fn(),
    createClient: vi.fn(),
    updateClient: vi.fn(),
    deactivateClient: vi.fn(),
    exportData: vi.fn(),
    importData: vi.fn(),
    listQuotes: vi.fn().mockResolvedValue([]),
    listInvoices: vi.fn().mockResolvedValue([]),
    ...overrides
  } as unknown as Window['jimuhubApi']
}

describe('TopPage', () => {
  beforeEach(() => {
    setupApi()
  })

  it('起動時に取引先(利用中)の登録件数を取得して表示する', async () => {
    render(
      <TopPage
        onNavigateClients={vi.fn()}
        onNavigateDocuments={vi.fn()}
        onOpenExportDialog={vi.fn()}
        onOpenImportDialog={vi.fn()}
        onNavigateCompanyProfile={vi.fn()}
      />
    )

    await waitFor(() =>
      expect(window.jimuhubApi.listClients).toHaveBeenCalledWith({
        statusFilter: 'active'
      })
    )
    expect(await screen.findByText('2件')).toBeInTheDocument()
  })

  it('「取引先管理」メニュー押下で一覧画面への遷移を要求する', async () => {
    const onNavigateClients = vi.fn()
    render(
      <TopPage
        onNavigateClients={onNavigateClients}
        onNavigateDocuments={vi.fn()}
        onOpenExportDialog={vi.fn()}
        onOpenImportDialog={vi.fn()}
        onNavigateCompanyProfile={vi.fn()}
      />
    )

    await userEvent.click(screen.getByText('取引先管理'))
    expect(onNavigateClients).toHaveBeenCalled()
  })

  it('「準備中」メニュー押下では案内を表示し遷移しない', async () => {
    render(
      <TopPage
        onNavigateClients={vi.fn()}
        onNavigateDocuments={vi.fn()}
        onOpenExportDialog={vi.fn()}
        onOpenImportDialog={vi.fn()}
        onNavigateCompanyProfile={vi.fn()}
      />
    )

    await userEvent.click(screen.getByText('タスク・期限'))
    expect(await screen.findByText(/実装予定です/)).toBeInTheDocument()
  })

  it('「データをエクスポート」押下でエクスポートダイアログを開く', async () => {
    const onOpenExportDialog = vi.fn()
    render(
      <TopPage
        onNavigateClients={vi.fn()}
        onNavigateDocuments={vi.fn()}
        onOpenExportDialog={onOpenExportDialog}
        onOpenImportDialog={vi.fn()}
        onNavigateCompanyProfile={vi.fn()}
      />
    )

    await userEvent.click(screen.getByText('データをエクスポート'))
    expect(onOpenExportDialog).toHaveBeenCalled()
  })

  it('「データを復元」押下で復元ダイアログを開く', async () => {
    const onOpenImportDialog = vi.fn()
    render(
      <TopPage
        onNavigateClients={vi.fn()}
        onNavigateDocuments={vi.fn()}
        onOpenExportDialog={vi.fn()}
        onOpenImportDialog={onOpenImportDialog}
        onNavigateCompanyProfile={vi.fn()}
      />
    )

    await userEvent.click(screen.getByText('データを復元'))
    expect(onOpenImportDialog).toHaveBeenCalled()
  })

  it('「自社情報・振込先の設定」押下で設定画面への遷移を要求する(詳細設計書3.1章)', async () => {
    const onNavigateCompanyProfile = vi.fn()
    render(
      <TopPage
        onNavigateClients={vi.fn()}
        onNavigateDocuments={vi.fn()}
        onOpenExportDialog={vi.fn()}
        onOpenImportDialog={vi.fn()}
        onNavigateCompanyProfile={onNavigateCompanyProfile}
      />
    )

    await userEvent.click(screen.getByText('自社情報・振込先の設定'))
    expect(onNavigateCompanyProfile).toHaveBeenCalled()
  })

  it('請求書件数・未収の請求書件数(PDF保存済みかつ未収)を表示する', async () => {
    setupApi({
      listInvoices: vi.fn().mockResolvedValue([
        { id: 1, status: 'finalized', paymentStatus: 'unpaid' },
        { id: 2, status: 'finalized', paymentStatus: 'paid' },
        { id: 3, status: 'draft', paymentStatus: 'unpaid' }
      ])
    })
    render(
      <TopPage
        onNavigateClients={vi.fn()}
        onNavigateDocuments={vi.fn()}
        onOpenExportDialog={vi.fn()}
        onOpenImportDialog={vi.fn()}
        onNavigateCompanyProfile={vi.fn()}
      />
    )
    expect(await screen.findByText('請求書件数')).toBeInTheDocument()
    expect(await screen.findByText('3件')).toBeInTheDocument()
    expect(await screen.findByText('1件')).toBeInTheDocument()
  })
})
