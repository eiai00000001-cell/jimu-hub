// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from './App'
import type { Client } from '@shared/types/client'

const sampleClient: Client = {
  id: 1,
  name: 'アルファ商事株式会社',
  furigana: 'アルファショウジカブシキガイシャ',
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

function setupApi(): void {
  window.jimuhubApi = {
    getStartupStatus: vi.fn().mockResolvedValue({ ok: true }),
    listClients: vi.fn().mockResolvedValue([sampleClient]),
    getClient: vi.fn().mockResolvedValue(sampleClient),
    createClient: vi.fn().mockResolvedValue({ id: 2 }),
    updateClient: vi.fn().mockResolvedValue({ success: true }),
    deactivateClient: vi.fn().mockResolvedValue({ success: true }),
    exportData: vi.fn(),
    importData: vi.fn(),
    getCompanyProfile: vi.fn().mockResolvedValue(null),
    saveCompanyProfile: vi.fn().mockResolvedValue({ success: true }),
    listQuotes: vi.fn().mockResolvedValue([]),
    getQuote: vi.fn(),
    saveQuoteDraft: vi.fn(),
    finalizeQuote: vi.fn(),
    openQuotePdf: vi.fn(),
    showQuotePdfInFolder: vi.fn()
  } as unknown as Window['jimuhubApi']
}

describe('App', () => {
  beforeEach(() => {
    setupApi()
  })

  it('起動時にデータベース接続エラーがある場合は起動エラー画面を表示する', async () => {
    window.jimuhubApi.getStartupStatus = vi
      .fn()
      .mockResolvedValue({ ok: false, message: 'データを読み込めませんでした' })
    render(<App />)

    expect(await screen.findByText('データを読み込めませんでした')).toBeInTheDocument()
  })

  it('ホーム→取引先一覧→詳細→編集→保存で詳細画面へ戻る', async () => {
    render(<App />)

    await userEvent.click(await screen.findByText('取引先管理'))
    await userEvent.click(await screen.findByText('アルファ商事株式会社'))
    await userEvent.click(await screen.findByText('編集'))

    expect(await screen.findByDisplayValue('アルファ商事株式会社')).toBeInTheDocument()
    await userEvent.click(screen.getByText('保存'))

    expect(await screen.findByText('取引先を更新しました')).toBeInTheDocument()
  })

  it('取引先一覧→新規登録→登録すると一覧へ戻り完了メッセージを表示する', async () => {
    render(<App />)

    await userEvent.click(await screen.findByText('取引先管理'))
    await userEvent.click(await screen.findByText('+ 新規登録'))
    await userEvent.type(screen.getByLabelText('取引先名称'), '新規商事株式会社')
    await userEvent.click(screen.getByText('登録'))

    expect(await screen.findByText('取引先を登録しました')).toBeInTheDocument()
  })

  it('ホーム→自社情報・振込先の設定→保存→ホームへ戻ると設定が反映されている', async () => {
    render(<App />)

    await userEvent.click(await screen.findByText('自社情報・振込先の設定'))
    await userEvent.type(screen.getByLabelText('氏名・屋号'), 'サンプル商店 山田太郎')
    await userEvent.type(screen.getByLabelText('住所'), '東京都千代田区1-1-1')
    await userEvent.click(screen.getByText('保存'))

    expect(await screen.findByText('自社情報を保存しました')).toBeInTheDocument()
    expect(window.jimuhubApi.saveCompanyProfile).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'サンプル商店 山田太郎' })
    )

    await userEvent.click(screen.getByText('ホーム'))
    expect(await screen.findByText('取引先登録件数(利用中)')).toBeInTheDocument()
  })

  it('ホーム→見積書・請求書→見積書を新規作成→下書き保存で詳細画面へ遷移する', async () => {
    window.jimuhubApi.getCompanyProfile = vi.fn().mockResolvedValue({
      name: 'サンプル商店 山田太郎',
      address: '東京都千代田区千代田1-1-1',
      invoiceRegistrationNumber: 'T1234567890123',
      bankName: null,
      bankBranch: null,
      accountType: null,
      accountNumber: null,
      accountHolder: null,
      updatedAt: '2026-01-01T00:00:00.000Z'
    })
    window.jimuhubApi.saveQuoteDraft = vi.fn().mockResolvedValue({ id: 3 })
    window.jimuhubApi.getQuote = vi.fn().mockResolvedValue({
      id: 3,
      quoteNumber: null,
      clientId: 1,
      clientName: 'アルファ商事株式会社',
      clientHonorific: '御中',
      issueDate: '2026-09-28',
      validUntil: null,
      remarks: null,
      subtotal10: 300000,
      taxAmount10: 30000,
      subtotal8: 0,
      taxAmount8: 0,
      totalAmount: 330000,
      invoiceFormat: null,
      status: 'draft',
      pdfPath: null,
      pdfHash: null,
      pdfHashMismatch: false,
      lineItems: [
        {
          id: 1,
          lineNo: 1,
          name: 'Webサイト制作一式',
          quantity: 1,
          unit: '式',
          unitPrice: 300000,
          taxRate: 10,
          amount: 300000
        }
      ],
      createdAt: '2026-09-28T00:00:00.000Z',
      updatedAt: '2026-09-28T00:00:00.000Z'
    })

    render(<App />)

    await userEvent.click(await screen.findByText('見積書・請求書'))
    await userEvent.click(await screen.findByText('+ 見積書を新規作成'))
    await userEvent.selectOptions(await screen.findByLabelText('取引先'), '1')
    await userEvent.type(screen.getByLabelText('品名1'), 'Webサイト制作一式')
    await userEvent.click(screen.getByText('下書き保存'))

    expect(await screen.findByText('見積書を下書き保存しました')).toBeInTheDocument()
    expect(screen.getByText('Webサイト制作一式')).toBeInTheDocument()
  })

  it('見積書作成画面で自社情報未設定から設定・保存すると、見積書作成画面へ戻り完了メッセージを表示する', async () => {
    render(<App />)

    await userEvent.click(await screen.findByText('見積書・請求書'))
    await userEvent.click(await screen.findByText('+ 見積書を新規作成'))
    await userEvent.click(await screen.findByText('自社情報・振込先の設定へ'))

    await userEvent.type(screen.getByLabelText('氏名・屋号'), 'サンプル商店 山田太郎')
    await userEvent.type(screen.getByLabelText('住所'), '東京都千代田区1-1-1')
    await userEvent.click(screen.getByText('保存'))

    expect(await screen.findByText('自社情報を保存しました')).toBeInTheDocument()
    expect(screen.getByLabelText('取引先')).toBeInTheDocument()
  })

  it('ホームでエクスポートダイアログを開閉できる', async () => {
    render(<App />)

    await userEvent.click(await screen.findByText('データをエクスポート'))
    expect(await screen.findByText('データをエクスポート', { selector: 'h2' })).toBeInTheDocument()

    await userEvent.click(screen.getByLabelText('閉じる'))
    await waitFor(() =>
      expect(screen.queryByText('データをエクスポート', { selector: 'h2' })).not.toBeInTheDocument()
    )
  })
})
