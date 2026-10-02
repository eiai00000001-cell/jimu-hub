// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QuickClientRegisterModal } from './QuickClientRegisterModal'

function setupApi(): { createClient: ReturnType<typeof vi.fn> } {
  const createClient = vi.fn().mockResolvedValue({ id: 42 })
  window.jimuhubApi = {
    getStartupStatus: vi.fn(),
    listClients: vi.fn(),
    getClient: vi.fn(),
    createClient,
    updateClient: vi.fn(),
    deactivateClient: vi.fn(),
    exportData: vi.fn(),
    importData: vi.fn(),
    getCompanyProfile: vi.fn(),
    saveCompanyProfile: vi.fn(),
    listQuotes: vi.fn(),
    getQuote: vi.fn(),
    saveQuoteDraft: vi.fn(),
    finalizeQuote: vi.fn(),
    openQuotePdf: vi.fn(),
    showQuotePdfInFolder: vi.fn()
  } as unknown as Window['jimuhubApi']
  return { createClient }
}

describe('QuickClientRegisterModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('取引先名称が空欄の場合はエラーを表示し登録処理を行わない', async () => {
    const { createClient } = setupApi()
    render(<QuickClientRegisterModal onRegistered={vi.fn()} onCancel={vi.fn()} />)

    await userEvent.click(screen.getByText('登録'))

    expect(await screen.findByText('取引先名称を入力してください')).toBeInTheDocument()
    expect(createClient).not.toHaveBeenCalled()
  })

  it('取引先名称を入力して登録すると、名称のみで簡易登録しonRegisteredを呼び出す', async () => {
    const { createClient } = setupApi()
    const onRegistered = vi.fn()
    render(<QuickClientRegisterModal onRegistered={onRegistered} onCancel={vi.fn()} />)

    await userEvent.type(screen.getByLabelText('取引先名称'), '新規商事株式会社')
    await userEvent.click(screen.getByText('登録'))

    await waitFor(() =>
      expect(createClient).toHaveBeenCalledWith(
        expect.objectContaining({ name: '新規商事株式会社', honorific: '(なし)' })
      )
    )
    await waitFor(() =>
      expect(onRegistered).toHaveBeenCalledWith({ id: 42, name: '新規商事株式会社' })
    )
  })

  it('「キャンセル」ボタン押下でonCancelを呼び出す', async () => {
    setupApi()
    const onCancel = vi.fn()
    render(<QuickClientRegisterModal onRegistered={vi.fn()} onCancel={onCancel} />)

    await userEvent.click(screen.getByText('キャンセル'))
    expect(onCancel).toHaveBeenCalled()
  })
})
