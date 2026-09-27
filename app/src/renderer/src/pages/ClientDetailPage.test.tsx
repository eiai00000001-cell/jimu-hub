// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientDetailPage } from './ClientDetailPage'
import type { Client } from '@shared/types/client'

const activeClient: Client = {
  id: 3,
  name: 'サンプル商事株式会社',
  honorific: '御中',
  contactPerson: 'サンプル次郎',
  postalCode: '100-0001',
  address: '東京都千代田区千代田1-1-1',
  phone: '03-3333-4444',
  email: 'contact@example.com',
  invoiceRegistrationNumber: 'T1234567890123',
  memo: '年に数回、定例の打ち合わせあり。',
  status: 'active',
  createdAt: '2026-04-01T10:00:00.000Z',
  updatedAt: '2026-08-15T15:30:00.000Z'
}

function setupApi(client: Client | null): {
  getClient: ReturnType<typeof vi.fn>
  deactivateClient: ReturnType<typeof vi.fn>
} {
  const getClient =
    client === null
      ? vi.fn().mockRejectedValue(new Error('指定された取引先が見つかりません'))
      : vi.fn().mockResolvedValue(client)
  const deactivateClient = vi.fn().mockResolvedValue({ success: true })
  window.jimuhubApi = {
    getStartupStatus: vi.fn(),
    listClients: vi.fn(),
    getClient,
    createClient: vi.fn(),
    updateClient: vi.fn(),
    deactivateClient,
    exportData: vi.fn(),
    importData: vi.fn()
  } as unknown as Window['jimuhubApi']
  return { getClient, deactivateClient }
}

describe('ClientDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('取引先の全項目を表示する', async () => {
    setupApi(activeClient)
    render(
      <ClientDetailPage
        clientId={3}
        onNavigateHome={vi.fn()}
        onBackToList={vi.fn()}
        onEdit={vi.fn()}
        onDeactivated={vi.fn()}
      />
    )

    expect(await screen.findByText('サンプル商事株式会社')).toBeInTheDocument()
    expect(screen.getByText('contact@example.com')).toBeInTheDocument()
    expect(screen.getByText('T1234567890123')).toBeInTheDocument()
  })

  it('「編集」ボタン押下でonEditを呼び出す', async () => {
    setupApi(activeClient)
    const onEdit = vi.fn()
    render(
      <ClientDetailPage
        clientId={3}
        onNavigateHome={vi.fn()}
        onBackToList={vi.fn()}
        onEdit={onEdit}
        onDeactivated={vi.fn()}
      />
    )

    await userEvent.click(await screen.findByText('編集'))
    expect(onEdit).toHaveBeenCalledWith(3)
  })

  it('「利用停止にする」→確認ダイアログ「はい」でdeactivateClientを呼び出す', async () => {
    const { deactivateClient } = setupApi(activeClient)
    const onDeactivated = vi.fn()
    render(
      <ClientDetailPage
        clientId={3}
        onNavigateHome={vi.fn()}
        onBackToList={vi.fn()}
        onEdit={vi.fn()}
        onDeactivated={onDeactivated}
      />
    )

    await userEvent.click(await screen.findByText('利用停止にする'))
    expect(await screen.findByText('本当に利用停止にしますか')).toBeInTheDocument()

    await userEvent.click(screen.getByText('はい'))
    await waitFor(() => expect(deactivateClient).toHaveBeenCalledWith(3))
    await waitFor(() => expect(onDeactivated).toHaveBeenCalledWith(3))
  })

  it('利用停止操作後、同一画面内でバッジ・編集ボタンの表示が最新化される(BUG-02修正確認)', async () => {
    const getClient = vi
      .fn()
      .mockResolvedValueOnce(activeClient)
      .mockResolvedValueOnce({ ...activeClient, status: 'inactive' })
    const deactivateClient = vi.fn().mockResolvedValue({ success: true })
    window.jimuhubApi = {
      getStartupStatus: vi.fn(),
      listClients: vi.fn(),
      getClient,
      createClient: vi.fn(),
      updateClient: vi.fn(),
      deactivateClient,
      exportData: vi.fn(),
      importData: vi.fn()
    } as unknown as Window['jimuhubApi']

    render(
      <ClientDetailPage
        clientId={3}
        onNavigateHome={vi.fn()}
        onBackToList={vi.fn()}
        onEdit={vi.fn()}
        onDeactivated={vi.fn()}
      />
    )

    await userEvent.click(await screen.findByText('利用停止にする'))
    await userEvent.click(screen.getByText('はい'))

    // getClientが利用停止後に再取得され(2回呼ばれ)、画面遷移なしで表示が最新化されることを確認する
    await waitFor(() => expect(getClient).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('編集')).toBeDisabled()
    expect(screen.queryByText('利用停止にする')).not.toBeInTheDocument()
    expect(screen.getAllByText('利用停止', { exact: true }).length).toBeGreaterThan(0)
  })

  it('確認ダイアログ「いいえ」では何も実行しない', async () => {
    const { deactivateClient } = setupApi(activeClient)
    render(
      <ClientDetailPage
        clientId={3}
        onNavigateHome={vi.fn()}
        onBackToList={vi.fn()}
        onEdit={vi.fn()}
        onDeactivated={vi.fn()}
      />
    )

    await userEvent.click(await screen.findByText('利用停止にする'))
    await userEvent.click(screen.getByText('いいえ'))

    expect(deactivateClient).not.toHaveBeenCalled()
    expect(screen.queryByText('本当に利用停止にしますか')).not.toBeInTheDocument()
  })

  it('利用停止済みの取引先は「編集」が非活性になり「利用停止にする」は表示されない', async () => {
    setupApi({ ...activeClient, status: 'inactive' })
    render(
      <ClientDetailPage
        clientId={3}
        onNavigateHome={vi.fn()}
        onBackToList={vi.fn()}
        onEdit={vi.fn()}
        onDeactivated={vi.fn()}
      />
    )

    expect(await screen.findByText('編集')).toBeDisabled()
    expect(screen.queryByText('利用停止にする')).not.toBeInTheDocument()
  })

  it('該当レコードが存在しない場合はエラーメッセージと一覧への導線を表示する', async () => {
    setupApi(null)
    render(
      <ClientDetailPage
        clientId={999}
        onNavigateHome={vi.fn()}
        onBackToList={vi.fn()}
        onEdit={vi.fn()}
        onDeactivated={vi.fn()}
      />
    )

    expect(await screen.findByText('指定された取引先が見つかりません')).toBeInTheDocument()
    expect(screen.getByText('← 一覧へ戻る')).toBeInTheDocument()
  })

  it('「一覧へ戻る」押下でonBackToListを呼び出す', async () => {
    setupApi(activeClient)
    const onBackToList = vi.fn()
    render(
      <ClientDetailPage
        clientId={3}
        onNavigateHome={vi.fn()}
        onBackToList={onBackToList}
        onEdit={vi.fn()}
        onDeactivated={vi.fn()}
      />
    )

    await userEvent.click(await screen.findByText('← 一覧へ戻る'))
    expect(onBackToList).toHaveBeenCalled()
  })
})
