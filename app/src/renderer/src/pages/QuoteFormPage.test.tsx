// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QuoteFormPage } from './QuoteFormPage'
import type { Client } from '@shared/types/client'
import type { Quote } from '@shared/types/quote'
import type { CompanyProfile } from '@shared/types/company-profile'

const sampleClient: Client = {
  id: 1,
  name: 'サンプル商事株式会社',
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

const sampleCompanyProfile: CompanyProfile = {
  name: 'サンプル商店 山田太郎',
  address: '東京都千代田区千代田1-1-1',
  invoiceRegistrationNumber: 'T1234567890123',
  bankName: null,
  bankBranch: null,
  accountType: null,
  accountNumber: null,
  accountHolder: null,
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const sampleQuote: Quote = {
  id: 7,
  quoteNumber: null,
  clientId: 1,
  clientName: 'サンプル商事株式会社',
  clientHonorific: '御中',
  issueDate: '2026-09-01',
  validUntil: '2026-10-01',
  remarks: '既存の備考',
  subtotal10: 10000,
  taxAmount10: 1000,
  subtotal8: 0,
  taxAmount8: 0,
  totalAmount: 11000,
  invoiceFormat: null,
  status: 'draft',
  pdfPath: null,
  pdfHash: null,
  pdfHashMismatch: false,
  lineItems: [
    {
      id: 1,
      lineNo: 1,
      name: '既存品目',
      quantity: 1,
      unit: '式',
      unitPrice: 10000,
      taxRate: 10,
      amount: 10000
    }
  ],
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z'
}

function setupApi(overrides: Partial<Window['jimuhubApi']> = {}): {
  saveQuoteDraft: ReturnType<typeof vi.fn>
  finalizeQuote: ReturnType<typeof vi.fn>
  createClient: ReturnType<typeof vi.fn>
} {
  const saveQuoteDraft = vi.fn().mockResolvedValue({ id: 10 })
  const finalizeQuote = vi
    .fn()
    .mockResolvedValue({ id: 10, quoteNumber: '2026-001', pdfPath: '/tmp/2026-001.pdf' })
  const createClient = vi.fn().mockResolvedValue({ id: 99 })
  window.jimuhubApi = {
    getStartupStatus: vi.fn(),
    listClients: vi.fn().mockResolvedValue([sampleClient]),
    getClient: vi.fn(),
    createClient,
    updateClient: vi.fn(),
    deactivateClient: vi.fn(),
    exportData: vi.fn(),
    importData: vi.fn(),
    getCompanyProfile: vi.fn().mockResolvedValue(sampleCompanyProfile),
    saveCompanyProfile: vi.fn(),
    listQuotes: vi.fn(),
    getQuote: vi.fn().mockResolvedValue(sampleQuote),
    saveQuoteDraft,
    finalizeQuote,
    openQuotePdf: vi.fn(),
    showQuotePdfInFolder: vi.fn(),
    ...overrides
  } as unknown as Window['jimuhubApi']
  return { saveQuoteDraft, finalizeQuote, createClient }
}

describe('QuoteFormPage(新規作成)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('取引先未選択・品名未入力のまま下書き保存すると、エラーを表示し保存しない', async () => {
    const { saveQuoteDraft } = setupApi()
    render(
      <QuoteFormPage
        mode="new"
        onSavedDraft={vi.fn()}
        onFinalized={vi.fn()}
        onCancel={vi.fn()}
        onNavigateCompanyProfile={vi.fn()}
      />
    )
    await waitFor(() => expect(window.jimuhubApi.listClients).toHaveBeenCalled())

    await userEvent.click(screen.getByText('下書き保存'))

    expect(await screen.findByText('取引先を選択してください')).toBeInTheDocument()
    expect(await screen.findByText('品名を入力してください')).toBeInTheDocument()
    expect(saveQuoteDraft).not.toHaveBeenCalled()
  })

  it('必須項目を入力して下書き保存すると、saveQuoteDraftを呼び出しonSavedDraftへ結果を渡す', async () => {
    const { saveQuoteDraft } = setupApi()
    const onSavedDraft = vi.fn()
    render(
      <QuoteFormPage
        mode="new"
        onSavedDraft={onSavedDraft}
        onFinalized={vi.fn()}
        onCancel={vi.fn()}
        onNavigateCompanyProfile={vi.fn()}
      />
    )
    await screen.findByText('サンプル商事株式会社')

    await userEvent.selectOptions(screen.getByLabelText('取引先'), '1')
    await userEvent.type(screen.getByLabelText('品名1'), 'Webサイト制作一式')
    await userEvent.click(screen.getByText('下書き保存'))

    await waitFor(() =>
      expect(saveQuoteDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          id: undefined,
          clientId: 1,
          lineItems: [expect.objectContaining({ name: 'Webサイト制作一式' })]
        })
      )
    )
    await waitFor(() => expect(onSavedDraft).toHaveBeenCalledWith(10))
  })

  it('明細行の数量・単価を入力すると金額・合計金額が即時再計算される', async () => {
    setupApi()
    render(
      <QuoteFormPage
        mode="new"
        onSavedDraft={vi.fn()}
        onFinalized={vi.fn()}
        onCancel={vi.fn()}
        onNavigateCompanyProfile={vi.fn()}
      />
    )
    await screen.findByText('サンプル商事株式会社')

    const unitPriceInput = screen.getByLabelText('単価1')
    await userEvent.clear(unitPriceInput)
    await userEvent.type(unitPriceInput, '1000')

    await waitFor(() => expect(screen.getAllByText('¥1,000').length).toBeGreaterThan(0))
  })

  it('「行を追加」で明細行が増え、「削除」で減る(最低1行は残す)', async () => {
    setupApi()
    render(
      <QuoteFormPage
        mode="new"
        onSavedDraft={vi.fn()}
        onFinalized={vi.fn()}
        onCancel={vi.fn()}
        onNavigateCompanyProfile={vi.fn()}
      />
    )
    await screen.findByText('サンプル商事株式会社')

    await userEvent.click(screen.getByText('+ 行を追加'))
    expect(screen.getByLabelText('品名2')).toBeInTheDocument()

    const deleteButtons = screen.getAllByText('削除')
    await userEvent.click(deleteButtons[1]!)
    expect(screen.queryByLabelText('品名2')).not.toBeInTheDocument()
    expect(screen.getAllByText('削除')[0]).toBeDisabled()
  })

  it('自社情報が未設定の場合は案内と設定画面への導線を表示する', async () => {
    setupApi({ getCompanyProfile: vi.fn().mockResolvedValue(null) })
    const onNavigateCompanyProfile = vi.fn()
    render(
      <QuoteFormPage
        mode="new"
        onSavedDraft={vi.fn()}
        onFinalized={vi.fn()}
        onCancel={vi.fn()}
        onNavigateCompanyProfile={onNavigateCompanyProfile}
      />
    )

    expect(
      await screen.findByText('自社情報が未設定です。先に自社情報を設定してください')
    ).toBeInTheDocument()
    await userEvent.click(screen.getByText('自社情報・振込先の設定へ'))
    expect(onNavigateCompanyProfile).toHaveBeenCalled()
  })

  it('自社情報が未設定のまま「PDFとして保存」を押下するとエラーを表示し中断する', async () => {
    const { finalizeQuote } = setupApi({ getCompanyProfile: vi.fn().mockResolvedValue(null) })
    render(
      <QuoteFormPage
        mode="new"
        onSavedDraft={vi.fn()}
        onFinalized={vi.fn()}
        onCancel={vi.fn()}
        onNavigateCompanyProfile={vi.fn()}
      />
    )
    await screen.findByText('サンプル商事株式会社')

    await userEvent.selectOptions(screen.getByLabelText('取引先'), '1')
    await userEvent.type(screen.getByLabelText('品名1'), 'Webサイト制作一式')
    await userEvent.click(screen.getByText('PDFとして保存'))

    expect(
      await screen.findAllByText('自社情報が未設定です。先に自社情報を設定してください')
    ).not.toHaveLength(0)
    expect(finalizeQuote).not.toHaveBeenCalled()
  })

  it('「PDFとして保存」で確定処理が成功すると、finalizeQuoteを呼び出しonFinalizedへ結果を渡す', async () => {
    const { finalizeQuote } = setupApi()
    const onFinalized = vi.fn()
    render(
      <QuoteFormPage
        mode="new"
        onSavedDraft={vi.fn()}
        onFinalized={onFinalized}
        onCancel={vi.fn()}
        onNavigateCompanyProfile={vi.fn()}
      />
    )
    await screen.findByText('サンプル商事株式会社')

    await userEvent.selectOptions(screen.getByLabelText('取引先'), '1')
    await userEvent.type(screen.getByLabelText('品名1'), 'Webサイト制作一式')
    await userEvent.click(screen.getByText('PDFとして保存'))

    await waitFor(() => expect(finalizeQuote).toHaveBeenCalled())
    await waitFor(() => expect(onFinalized).toHaveBeenCalledWith(10))
  })

  it('確定処理が失敗した場合はエラーメッセージを表示する', async () => {
    setupApi({
      finalizeQuote: vi.fn().mockRejectedValue(new Error('PDFの保存に失敗しました'))
    })
    render(
      <QuoteFormPage
        mode="new"
        onSavedDraft={vi.fn()}
        onFinalized={vi.fn()}
        onCancel={vi.fn()}
        onNavigateCompanyProfile={vi.fn()}
      />
    )
    await screen.findByText('サンプル商事株式会社')

    await userEvent.selectOptions(screen.getByLabelText('取引先'), '1')
    await userEvent.type(screen.getByLabelText('品名1'), 'Webサイト制作一式')
    await userEvent.click(screen.getByText('PDFとして保存'))

    expect(await screen.findByText('PDFの保存に失敗しました')).toBeInTheDocument()
  })

  it('「+ 取引先を新規登録」から簡易登録すると、選択欄に反映される', async () => {
    const { createClient } = setupApi()
    render(
      <QuoteFormPage
        mode="new"
        onSavedDraft={vi.fn()}
        onFinalized={vi.fn()}
        onCancel={vi.fn()}
        onNavigateCompanyProfile={vi.fn()}
      />
    )
    await screen.findByText('サンプル商事株式会社')

    await userEvent.click(screen.getByText('+ 取引先を新規登録'))
    await userEvent.type(screen.getByLabelText('取引先名称'), '新規商事株式会社')
    await userEvent.click(screen.getByText('登録'))

    await waitFor(() => expect(createClient).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByLabelText('取引先')).toHaveValue('99'))
  })

  it('「キャンセル」ボタン押下でonCancelを呼び出す', async () => {
    setupApi()
    const onCancel = vi.fn()
    render(
      <QuoteFormPage
        mode="new"
        onSavedDraft={vi.fn()}
        onFinalized={vi.fn()}
        onCancel={onCancel}
        onNavigateCompanyProfile={vi.fn()}
      />
    )
    await screen.findByText('サンプル商事株式会社')

    await userEvent.click(screen.getByText('キャンセル'))
    expect(onCancel).toHaveBeenCalled()
  })
})

describe('QuoteFormPage(編集)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('既存の下書きの値を初期表示する', async () => {
    setupApi()
    render(
      <QuoteFormPage
        mode="edit"
        quoteId={7}
        onSavedDraft={vi.fn()}
        onFinalized={vi.fn()}
        onCancel={vi.fn()}
        onNavigateCompanyProfile={vi.fn()}
      />
    )

    expect(await screen.findByDisplayValue('既存品目')).toBeInTheDocument()
    expect(screen.getByDisplayValue('既存の備考')).toBeInTheDocument()
  })

  it('PDF保存済みの見積書を開こうとすると編集不可の案内を表示する', async () => {
    setupApi({
      getQuote: vi.fn().mockResolvedValue({ ...sampleQuote, status: 'finalized' })
    })
    render(
      <QuoteFormPage
        mode="edit"
        quoteId={7}
        onSavedDraft={vi.fn()}
        onFinalized={vi.fn()}
        onCancel={vi.fn()}
        onNavigateCompanyProfile={vi.fn()}
      />
    )

    expect(await screen.findByText('PDF保存済みの見積書は編集できません')).toBeInTheDocument()
  })
})
