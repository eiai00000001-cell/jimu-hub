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
        onOpenExportDialog={vi.fn()}
        onOpenImportDialog={vi.fn()}
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
        onOpenExportDialog={vi.fn()}
        onOpenImportDialog={vi.fn()}
      />
    )

    await userEvent.click(screen.getByText('取引先管理'))
    expect(onNavigateClients).toHaveBeenCalled()
  })

  it('「準備中」メニュー押下では案内を表示し遷移しない', async () => {
    render(
      <TopPage
        onNavigateClients={vi.fn()}
        onOpenExportDialog={vi.fn()}
        onOpenImportDialog={vi.fn()}
      />
    )

    await userEvent.click(screen.getByText('案件管理'))
    expect(await screen.findByText(/実装予定です/)).toBeInTheDocument()
  })

  it('「データをエクスポート」押下でエクスポートダイアログを開く', async () => {
    const onOpenExportDialog = vi.fn()
    render(
      <TopPage
        onNavigateClients={vi.fn()}
        onOpenExportDialog={onOpenExportDialog}
        onOpenImportDialog={vi.fn()}
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
        onOpenExportDialog={vi.fn()}
        onOpenImportDialog={onOpenImportDialog}
      />
    )

    await userEvent.click(screen.getByText('データを復元'))
    expect(onOpenImportDialog).toHaveBeenCalled()
  })
})
