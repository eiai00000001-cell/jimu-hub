// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InvoiceFormPage } from './InvoiceFormPage'
import type { Invoice } from '@shared/types/invoice'

const client = { id: 1, name: 'サンプル商事株式会社' }

const company = {
  name: 'サンプル商店 山田太郎',
  address: '東京都千代田区千代田1-1-1',
  invoiceRegistrationNumber: 'T1234567890123',
  bankName: 'サンプル銀行',
  bankBranch: '本店営業部',
  accountType: '普通',
  accountNumber: '1234567',
  accountHolder: 'ヤマダ タロウ',
  updatedAt: ''
}

const draftInvoice: Invoice = {
  id: 7,
  invoiceNumber: null,
  clientId: 1,
  clientName: 'サンプル商事株式会社',
  clientHonorific: '御中',
  sourceQuoteId: null,
  issueDate: '2026-09-01',
  dueDate: '2026-10-31',
  remarks: '既存の備考',
  subtotal10: 10000,
  taxAmount10: 1000,
  subtotal8: 0,
  taxAmount8: 0,
  totalAmount: 11000,
  withholdingTaxAmount: 1021,
  billingAmount: 9979,
  invoiceFormat: null,
  status: 'draft',
  paymentStatus: 'unpaid',
  paymentDate: null,
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
      amount: 10000,
      withholdingTarget: true
    }
  ],
  createdAt: '',
  updatedAt: ''
}

function setupApi(overrides: Partial<Window['jimuhubApi']> = {}) {
  const saveInvoiceDraft = vi.fn().mockResolvedValue({ id: 10 })
  const finalizeInvoice = vi
    .fn()
    .mockResolvedValue({ id: 10, invoiceNumber: '2026-001', pdfPath: '/tmp/x.pdf' })
  window.jimuhubApi = {
    listClients: vi.fn().mockResolvedValue([client]),
    createClient: vi.fn().mockResolvedValue({ id: 99 }),
    getCompanyProfile: vi.fn().mockResolvedValue(company),
    getInvoice: vi.fn().mockResolvedValue(draftInvoice),
    saveInvoiceDraft,
    finalizeInvoice,
    ...overrides
  } as unknown as Window['jimuhubApi']
  return { saveInvoiceDraft, finalizeInvoice }
}

function renderNew(props: Partial<Parameters<typeof InvoiceFormPage>[0]> = {}) {
  return render(
    <InvoiceFormPage
      mode="new"
      onSavedDraft={vi.fn()}
      onFinalized={vi.fn()}
      onCancel={vi.fn()}
      onNavigateCompanyProfile={vi.fn()}
      {...props}
    />
  )
}

describe('InvoiceFormPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('必須項目未入力で下書き保存するとエラーを表示し保存しない', async () => {
    const { saveInvoiceDraft } = setupApi()
    renderNew()
    await screen.findByText('サンプル商事株式会社')
    await userEvent.click(screen.getByText('下書き保存'))
    expect(await screen.findByText('取引先を選択してください')).toBeInTheDocument()
    expect(await screen.findByText('品名を入力してください')).toBeInTheDocument()
    expect(saveInvoiceDraft).not.toHaveBeenCalled()
  })

  it('支払期限・源泉徴収対象を含めて下書き保存する', async () => {
    const { saveInvoiceDraft } = setupApi()
    const onSavedDraft = vi.fn()
    renderNew({ onSavedDraft })
    await screen.findByText('サンプル商事株式会社')

    await userEvent.selectOptions(screen.getByLabelText('取引先'), '1')
    await userEvent.type(screen.getByLabelText('品名1'), 'Webサイト制作一式')
    await userEvent.click(screen.getByLabelText('源泉徴収対象1'))
    await userEvent.type(screen.getByLabelText('支払期限'), '2026-10-31')
    await userEvent.click(screen.getByText('下書き保存'))

    await waitFor(() =>
      expect(saveInvoiceDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          id: undefined,
          clientId: 1,
          dueDate: '2026-10-31',
          lineItems: [expect.objectContaining({ withholdingTarget: true })]
        })
      )
    )
    await waitFor(() => expect(onSavedDraft).toHaveBeenCalledWith(10))
  })

  it('源泉徴収対象にすると源泉徴収合計・請求金額が再計算される', async () => {
    setupApi()
    renderNew()
    await screen.findByText('サンプル商事株式会社')

    const price = screen.getByLabelText('単価1')
    await userEvent.clear(price)
    await userEvent.type(price, '300000')
    await userEvent.click(screen.getByLabelText('源泉徴収対象1'))

    // 300,000 x 0.1021 = 30,630 / 合計330,000円(税込) - 30,630 = 299,370
    await waitFor(() => expect(screen.getByText('-¥30,630')).toBeInTheDocument())
    expect(screen.getByText('¥299,370')).toBeInTheDocument()
  })

  it('自社情報の振込先を表示する', async () => {
    setupApi()
    renderNew()
    expect(
      await screen.findByText('サンプル銀行 本店営業部 普通 1234567 ヤマダ タロウ')
    ).toBeInTheDocument()
  })

  it('自社情報が未設定の場合は案内と設定画面への導線を表示し、PDF保存を中断する', async () => {
    const { finalizeInvoice } = setupApi({ getCompanyProfile: vi.fn().mockResolvedValue(null) })
    const onNavigateCompanyProfile = vi.fn()
    renderNew({ onNavigateCompanyProfile })
    await screen.findByText('サンプル商事株式会社')

    await userEvent.click(screen.getByText('自社情報・振込先の設定へ'))
    expect(onNavigateCompanyProfile).toHaveBeenCalled()

    await userEvent.selectOptions(screen.getByLabelText('取引先'), '1')
    await userEvent.type(screen.getByLabelText('品名1'), 'A')
    await userEvent.click(screen.getByText('PDFとして保存'))
    expect(
      (await screen.findAllByText('自社情報が未設定です。先に自社情報を設定してください')).length
    ).toBeGreaterThan(0)
    expect(finalizeInvoice).not.toHaveBeenCalled()
  })

  it('PDFとして保存すると確定処理を呼び、失敗時はエラーを表示する', async () => {
    const { finalizeInvoice } = setupApi()
    const onFinalized = vi.fn()
    renderNew({ onFinalized })
    await screen.findByText('サンプル商事株式会社')
    await userEvent.selectOptions(screen.getByLabelText('取引先'), '1')
    await userEvent.type(screen.getByLabelText('品名1'), 'A')
    await userEvent.click(screen.getByText('PDFとして保存'))
    await waitFor(() => expect(onFinalized).toHaveBeenCalledWith(10))
    expect(finalizeInvoice).toHaveBeenCalled()
  })

  it('確定処理が失敗した場合はエラーメッセージを表示する', async () => {
    setupApi({ finalizeInvoice: vi.fn().mockRejectedValue(new Error('PDFの保存に失敗しました')) })
    renderNew()
    await screen.findByText('サンプル商事株式会社')
    await userEvent.selectOptions(screen.getByLabelText('取引先'), '1')
    await userEvent.type(screen.getByLabelText('品名1'), 'A')
    await userEvent.click(screen.getByText('PDFとして保存'))
    expect(await screen.findByText('PDFの保存に失敗しました')).toBeInTheDocument()
  })

  it('取引先の簡易登録で選択欄に反映される', async () => {
    const {} = setupApi()
    renderNew()
    await screen.findByText('サンプル商事株式会社')
    await userEvent.click(screen.getByText('+ 取引先を新規登録'))
    await userEvent.type(screen.getByLabelText('取引先名称'), '新規商事')
    await userEvent.click(screen.getByText('登録'))
    await waitFor(() => expect(screen.getByLabelText('取引先')).toHaveValue('99'))
  })

  it('編集モードでは既存の下書き(源泉徴収対象含む)を初期表示する', async () => {
    setupApi()
    render(
      <InvoiceFormPage
        mode="edit"
        invoiceId={7}
        onSavedDraft={vi.fn()}
        onFinalized={vi.fn()}
        onCancel={vi.fn()}
        onNavigateCompanyProfile={vi.fn()}
      />
    )
    expect(await screen.findByDisplayValue('既存品目')).toBeInTheDocument()
    expect(screen.getByLabelText('源泉徴収対象1')).toBeChecked()
    expect(screen.getByDisplayValue('2026-10-31')).toBeInTheDocument()
  })

  it('PDF保存済みの請求書を編集しようとすると編集不可の案内を表示する', async () => {
    setupApi({
      getInvoice: vi.fn().mockResolvedValue({ ...draftInvoice, status: 'finalized' })
    })
    render(
      <InvoiceFormPage
        mode="edit"
        invoiceId={7}
        onSavedDraft={vi.fn()}
        onFinalized={vi.fn()}
        onCancel={vi.fn()}
        onNavigateCompanyProfile={vi.fn()}
      />
    )
    expect(await screen.findByText('PDF保存済みの請求書は編集できません')).toBeInTheDocument()
  })

  it('キャンセルでonCancelを呼び、flashMessageを表示する', async () => {
    setupApi()
    const onCancel = vi.fn()
    renderNew({ onCancel, flashMessage: '自社情報を保存しました' })
    expect(await screen.findByText('自社情報を保存しました')).toBeInTheDocument()
    await userEvent.click(screen.getByText('キャンセル'))
    expect(onCancel).toHaveBeenCalled()
  })
})
