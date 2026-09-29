// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CompanyProfilePage } from './CompanyProfilePage'
import type { CompanyProfile } from '@shared/types/company-profile'

const existingProfile: CompanyProfile = {
  name: 'サンプル商店 山田太郎',
  address: '東京都千代田区千代田1-1-1',
  invoiceRegistrationNumber: 'T1234567890123',
  bankName: 'サンプル銀行',
  bankBranch: '本店営業部',
  accountType: '普通',
  accountNumber: '1234567',
  accountHolder: 'ヤマダ タロウ',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

function setupApi(overrides: Partial<Window['jimuhubApi']> = {}): {
  getCompanyProfile: ReturnType<typeof vi.fn>
  saveCompanyProfile: ReturnType<typeof vi.fn>
} {
  const getCompanyProfile = vi.fn().mockResolvedValue(null)
  const saveCompanyProfile = vi.fn().mockResolvedValue({ success: true })
  window.jimuhubApi = {
    getStartupStatus: vi.fn(),
    listClients: vi.fn(),
    getClient: vi.fn(),
    createClient: vi.fn(),
    updateClient: vi.fn(),
    deactivateClient: vi.fn(),
    exportData: vi.fn(),
    importData: vi.fn(),
    getCompanyProfile,
    saveCompanyProfile,
    ...overrides
  } as unknown as Window['jimuhubApi']
  return { getCompanyProfile, saveCompanyProfile }
}

describe('CompanyProfilePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('未設定の場合は全項目空欄で表示する', async () => {
    setupApi()
    render(
      <CompanyProfilePage
        onNavigateHome={vi.fn()}
        onNavigateClients={vi.fn()}
        onNavigateDocuments={vi.fn()}
      />
    )

    await waitFor(() => expect(window.jimuhubApi.getCompanyProfile).toHaveBeenCalled())
    expect(screen.getByLabelText('氏名・屋号')).toHaveValue('')
  })

  it('既存設定がある場合は初期表示する', async () => {
    setupApi({ getCompanyProfile: vi.fn().mockResolvedValue(existingProfile) })
    render(
      <CompanyProfilePage
        onNavigateHome={vi.fn()}
        onNavigateClients={vi.fn()}
        onNavigateDocuments={vi.fn()}
      />
    )

    expect(await screen.findByDisplayValue('サンプル商店 山田太郎')).toBeInTheDocument()
    expect(screen.getByDisplayValue('サンプル銀行')).toBeInTheDocument()
  })

  it('必須項目(氏名・屋号)が空欄の場合は保存処理を行わずエラーを表示する', async () => {
    const { saveCompanyProfile } = setupApi()
    render(
      <CompanyProfilePage
        onNavigateHome={vi.fn()}
        onNavigateClients={vi.fn()}
        onNavigateDocuments={vi.fn()}
      />
    )
    await waitFor(() => expect(window.jimuhubApi.getCompanyProfile).toHaveBeenCalled())

    await userEvent.click(screen.getByText('保存'))

    expect(await screen.findByText('氏名・屋号を入力してください')).toBeInTheDocument()
    expect(saveCompanyProfile).not.toHaveBeenCalled()
  })

  it('必須項目を入力して保存すると、saveCompanyProfileを呼び出し完了メッセージを表示する', async () => {
    const { saveCompanyProfile } = setupApi()
    render(
      <CompanyProfilePage
        onNavigateHome={vi.fn()}
        onNavigateClients={vi.fn()}
        onNavigateDocuments={vi.fn()}
      />
    )
    await waitFor(() => expect(window.jimuhubApi.getCompanyProfile).toHaveBeenCalled())

    await userEvent.type(screen.getByLabelText('氏名・屋号'), 'サンプル商店 山田太郎')
    await userEvent.type(screen.getByLabelText('住所'), '東京都千代田区千代田1-1-1')
    await userEvent.click(screen.getByText('保存'))

    await waitFor(() =>
      expect(saveCompanyProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'サンプル商店 山田太郎',
          address: '東京都千代田区千代田1-1-1'
        })
      )
    )
    expect(await screen.findByText('自社情報を保存しました')).toBeInTheDocument()
  })

  it('onSavedが指定されている場合、保存成功時は本画面上に留まらずonSavedを呼び出す(見積書作成画面からの遷移用)', async () => {
    setupApi()
    const onSaved = vi.fn()
    render(
      <CompanyProfilePage
        onNavigateHome={vi.fn()}
        onNavigateClients={vi.fn()}
        onNavigateDocuments={vi.fn()}
        onSaved={onSaved}
      />
    )
    await waitFor(() => expect(window.jimuhubApi.getCompanyProfile).toHaveBeenCalled())

    await userEvent.type(screen.getByLabelText('氏名・屋号'), 'サンプル商店 山田太郎')
    await userEvent.type(screen.getByLabelText('住所'), '東京都千代田区千代田1-1-1')
    await userEvent.click(screen.getByText('保存'))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(screen.queryByText('自社情報を保存しました')).not.toBeInTheDocument()
  })
})
