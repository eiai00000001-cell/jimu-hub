// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientListPage } from './ClientListPage'
import type { Client } from '@shared/types/client'

const activeClient: Client = {
  id: 1,
  name: 'アルファ商事株式会社',
  furigana: 'アルファショウジカブシキガイシャ',
  honorific: '御中',
  contactPerson: 'サンプル太郎',
  postalCode: null,
  address: null,
  phone: '03-1111-2222',
  email: null,
  invoiceRegistrationNumber: null,
  memo: null,
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const inactiveClient: Client = {
  ...activeClient,
  id: 2,
  name: '有限会社テスト工業',
  status: 'inactive'
}

function setupApi(clients: Client[] = [activeClient]): ReturnType<typeof vi.fn> {
  const listClients = vi.fn().mockResolvedValue(clients)
  window.jimuhubApi = {
    getStartupStatus: vi.fn(),
    listClients,
    getClient: vi.fn(),
    createClient: vi.fn(),
    updateClient: vi.fn(),
    deactivateClient: vi.fn(),
    exportData: vi.fn(),
    importData: vi.fn()
  } as unknown as Window['jimuhubApi']
  return listClients
}

describe('ClientListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('初期表示は利用中のみ・フリガナ昇順で一覧を取得する(詳細設計書3.2章)', async () => {
    const listClients = setupApi()
    render(
      <ClientListPage
        onNavigateHome={vi.fn()}
        onNavigateDocuments={vi.fn()}
        onNewClient={vi.fn()}
        onSelectClient={vi.fn()}
      />
    )

    await waitFor(() =>
      expect(listClients).toHaveBeenCalledWith({
        keyword: '',
        sort: 'furigana_asc',
        statusFilter: 'active'
      })
    )
    expect(await screen.findByText('アルファ商事株式会社')).toBeInTheDocument()
    expect(screen.getByText('アルファショウジカブシキガイシャ')).toBeInTheDocument()
    expect(screen.getByLabelText('並べ替え')).toHaveValue('furigana_asc')
  })

  it('フリガナが未入力の取引先は一覧で「(未入力)」と表示する', async () => {
    setupApi([{ ...activeClient, furigana: null }])
    render(
      <ClientListPage
        onNavigateHome={vi.fn()}
        onNavigateDocuments={vi.fn()}
        onNewClient={vi.fn()}
        onSelectClient={vi.fn()}
      />
    )

    expect(await screen.findByText('(未入力)')).toBeInTheDocument()
  })

  it('該当0件の場合は案内文言を表示する', async () => {
    setupApi([])
    render(
      <ClientListPage
        onNavigateHome={vi.fn()}
        onNavigateDocuments={vi.fn()}
        onNewClient={vi.fn()}
        onSelectClient={vi.fn()}
      />
    )

    expect(await screen.findByText('該当する取引先がありません')).toBeInTheDocument()
  })

  it('検索キーワード入力で一覧を絞り込む', async () => {
    const listClients = setupApi()
    render(
      <ClientListPage
        onNavigateHome={vi.fn()}
        onNavigateDocuments={vi.fn()}
        onNewClient={vi.fn()}
        onSelectClient={vi.fn()}
      />
    )
    await screen.findByText('アルファ商事株式会社')

    await userEvent.type(screen.getByPlaceholderText('取引先名で検索'), 'アルファ')

    await waitFor(() =>
      expect(listClients).toHaveBeenLastCalledWith({
        keyword: 'アルファ',
        sort: 'furigana_asc',
        statusFilter: 'active'
      })
    )
  })

  it('並べ替え条件を変更すると一覧を再取得する', async () => {
    const listClients = setupApi()
    render(
      <ClientListPage
        onNavigateHome={vi.fn()}
        onNavigateDocuments={vi.fn()}
        onNewClient={vi.fn()}
        onSelectClient={vi.fn()}
      />
    )
    await screen.findByText('アルファ商事株式会社')

    await userEvent.selectOptions(screen.getByLabelText('並べ替え'), '名称降順')

    await waitFor(() =>
      expect(listClients).toHaveBeenLastCalledWith({
        keyword: '',
        sort: 'name_desc',
        statusFilter: 'active'
      })
    )
  })

  it('「利用停止も表示」をONにすると全件を取得し、利用停止行をグレー表示する', async () => {
    const listClients = setupApi([activeClient, inactiveClient])
    render(
      <ClientListPage
        onNavigateHome={vi.fn()}
        onNavigateDocuments={vi.fn()}
        onNewClient={vi.fn()}
        onSelectClient={vi.fn()}
      />
    )
    await screen.findByText('アルファ商事株式会社')

    await userEvent.click(screen.getByRole('switch', { name: '利用停止も表示' }))

    await waitFor(() =>
      expect(listClients).toHaveBeenLastCalledWith({
        keyword: '',
        sort: 'furigana_asc',
        statusFilter: 'all'
      })
    )
    const row = (await screen.findByText('有限会社テスト工業')).closest('tr')
    expect(row).toHaveClass('inactive')
  })

  it('一覧の行クリックで詳細画面への遷移を要求する', async () => {
    setupApi()
    const onSelectClient = vi.fn()
    render(
      <ClientListPage
        onNavigateHome={vi.fn()}
        onNavigateDocuments={vi.fn()}
        onNewClient={vi.fn()}
        onSelectClient={onSelectClient}
      />
    )

    await userEvent.click(await screen.findByText('アルファ商事株式会社'))
    expect(onSelectClient).toHaveBeenCalledWith(1)
  })

  it('「新規登録」ボタン押下で登録画面への遷移を要求する', async () => {
    setupApi()
    const onNewClient = vi.fn()
    render(
      <ClientListPage
        onNavigateHome={vi.fn()}
        onNavigateDocuments={vi.fn()}
        onNewClient={onNewClient}
        onSelectClient={vi.fn()}
      />
    )

    await userEvent.click(screen.getByText('+ 新規登録'))
    expect(onNewClient).toHaveBeenCalled()
  })

  it('flashMessageが渡された場合は完了メッセージを表示する', async () => {
    setupApi()
    render(
      <ClientListPage
        onNavigateHome={vi.fn()}
        onNavigateDocuments={vi.fn()}
        onNewClient={vi.fn()}
        onSelectClient={vi.fn()}
        flashMessage="取引先を登録しました"
      />
    )

    expect(await screen.findByText('取引先を登録しました')).toBeInTheDocument()
  })

  it('[F-25]利用停止の行にのみ「利用中に戻す」を表示し、確認後に復帰して一覧を再取得する', async () => {
    const listClients = vi
      .fn()
      .mockResolvedValueOnce([activeClient, inactiveClient])
      .mockResolvedValue([activeClient, { ...inactiveClient, status: 'active' }])
    const reactivateClient = vi.fn().mockResolvedValue({ success: true })
    window.jimuhubApi = { listClients, reactivateClient } as unknown as Window['jimuhubApi']
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const onSelectClient = vi.fn()
    render(
      <ClientListPage
        onNavigateHome={vi.fn()}
        onNavigateDocuments={vi.fn()}
        onNewClient={vi.fn()}
        onSelectClient={onSelectClient}
      />
    )
    const buttons = await screen.findAllByText('利用中に戻す')
    expect(buttons).toHaveLength(1)
    await userEvent.click(buttons[0]!)
    await waitFor(() => expect(reactivateClient).toHaveBeenCalledWith(2))
    await waitFor(() => expect(screen.queryByText('利用中に戻す')).not.toBeInTheDocument())
    expect(await screen.findByText('取引先を利用中に戻しました')).toBeInTheDocument()
    expect(onSelectClient).not.toHaveBeenCalled()
    confirm.mockRestore()
  })
})
