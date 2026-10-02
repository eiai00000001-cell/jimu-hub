// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InvoiceDetailPage } from './InvoiceDetailPage'
import type { Invoice } from '@shared/types/invoice'

const draft: Invoice = {
  id: 5,
  invoiceNumber: null,
  clientId: 1,
  clientName: 'サンプル商事株式会社',
  clientHonorific: '御中',
  sourceQuoteId: null,
  sourceQuoteNumber: null,
  issueDate: '2026-09-25',
  dueDate: null,
  remarks: null,
  subtotal10: 88000,
  taxAmount10: 8800,
  subtotal8: 0,
  taxAmount8: 0,
  totalAmount: 96800,
  withholdingTaxAmount: 0,
  billingAmount: 96800,
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
      name: 'デザイン制作',
      quantity: 1,
      unit: '式',
      unitPrice: 88000,
      taxRate: 10,
      amount: 88000,
      withholdingTarget: false
    }
  ],
  createdAt: '',
  updatedAt: ''
}

const finalized: Invoice = {
  ...draft,
  id: 8,
  invoiceNumber: '2026-012',
  status: 'finalized',
  dueDate: '2026-10-31',
  remarks: 'お振込手数料は貴社にてご負担ください。',
  withholdingTaxAmount: 8980,
  billingAmount: 87820,
  pdfPath: '/tmp/a.pdf',
  lineItems: [{ ...draft.lineItems[0]!, withholdingTarget: true }]
}

function setup(getInvoice: unknown) {
  const openInvoicePdf = vi.fn().mockResolvedValue({ success: true })
  const showInvoicePdfInFolder = vi.fn().mockResolvedValue({ success: true })
  const updateInvoicePaymentStatus = vi.fn().mockResolvedValue({ success: true })
  window.jimuhubApi = {
    getInvoice,
    updateInvoicePaymentStatus,
    openInvoicePdf,
    showInvoicePdfInFolder
  } as unknown as Window['jimuhubApi']
  return { openInvoicePdf, showInvoicePdfInFolder, updateInvoicePaymentStatus }
}

function renderPage(id: number, extra: Partial<Parameters<typeof InvoiceDetailPage>[0]> = {}) {
  return render(
    <InvoiceDetailPage
      invoiceId={id}
      onOpenQuote={vi.fn()}
      onNavigateHome={vi.fn()}
      onNavigateClients={vi.fn()}
      onBackToList={vi.fn()}
      onEdit={vi.fn()}
      {...extra}
    />
  )
}

describe('InvoiceDetailPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('下書きは編集ボタンのみで、入金ステータス欄を表示しない', async () => {
    setup(vi.fn().mockResolvedValue(draft))
    const onEdit = vi.fn()
    renderPage(5, { onEdit })
    expect(await screen.findByText('デザイン制作')).toBeInTheDocument()
    expect(screen.getByText('(未採番)')).toBeInTheDocument()
    expect(screen.queryByText('入金ステータス')).not.toBeInTheDocument()
    expect(screen.queryByText('源泉徴収税額(合計)')).not.toBeInTheDocument()
    await userEvent.click(screen.getByText('編集'))
    expect(onEdit).toHaveBeenCalledWith(5)
  })

  it('PDF保存済みはPDF操作・源泉徴収・請求金額・入金ステータスを表示する', async () => {
    const { openInvoicePdf, showInvoicePdfInFolder } = setup(vi.fn().mockResolvedValue(finalized))
    renderPage(8)
    expect(await screen.findByText('2026-012')).toBeInTheDocument()
    expect(screen.getByText('源泉徴収税額(合計)')).toBeInTheDocument()
    expect(screen.getByText('-¥8,980')).toBeInTheDocument()
    expect(screen.getByText('¥87,820')).toBeInTheDocument()
    expect(screen.getByText('入金ステータス')).toBeInTheDocument()
    expect(screen.queryByText('編集')).not.toBeInTheDocument()

    await userEvent.click(screen.getByText('PDFを開く'))
    await waitFor(() => expect(openInvoicePdf).toHaveBeenCalledWith(8))
    await userEvent.click(screen.getByText('Finderで表示'))
    await waitFor(() => expect(showInvoicePdfInFolder).toHaveBeenCalledWith(8))
  })

  it('PDFが見つからない場合は案内メッセージを表示する(I1-05)', async () => {
    const { openInvoicePdf } = setup(vi.fn().mockResolvedValue(finalized))
    openInvoicePdf.mockResolvedValue({ success: false, error: 'PDFファイルが見つかりません。案内' })
    renderPage(8)
    await userEvent.click(await screen.findByText('PDFを開く'))
    expect(await screen.findByText('PDFファイルが見つかりません。案内')).toBeInTheDocument()
  })

  it('「入金済みにする」→入金日を入力して確定すると入金済みへ更新し表示を最新化する', async () => {
    const getInvoice = vi
      .fn()
      .mockResolvedValueOnce(finalized)
      .mockResolvedValueOnce({ ...finalized, paymentStatus: 'paid', paymentDate: '2026-09-30' })
    const { updateInvoicePaymentStatus } = setup(getInvoice)
    renderPage(8)

    await userEvent.click(await screen.findByText('入金済みにする'))
    const dateInput = screen.getByLabelText('入金日')
    await userEvent.clear(dateInput)
    await userEvent.type(dateInput, '2026-09-30')
    await userEvent.click(screen.getByText('確定'))

    await waitFor(() =>
      expect(updateInvoicePaymentStatus).toHaveBeenCalledWith(8, {
        paymentStatus: 'paid',
        paymentDate: '2026-09-30'
      })
    )
    expect(await screen.findByText('入金日: 2026-09-30')).toBeInTheDocument()
    expect(screen.getByText('入金済みにしました')).toBeInTheDocument()
    expect(screen.getByText('未収に戻す')).toBeInTheDocument()
  })

  it('入金日が空欄の場合はエラーを表示し更新しない', async () => {
    const { updateInvoicePaymentStatus } = setup(vi.fn().mockResolvedValue(finalized))
    renderPage(8)
    await userEvent.click(await screen.findByText('入金済みにする'))
    await userEvent.clear(screen.getByLabelText('入金日'))
    await userEvent.click(screen.getByText('確定'))

    expect(await screen.findByText('入金日を入力してください')).toBeInTheDocument()
    expect(updateInvoicePaymentStatus).not.toHaveBeenCalled()
  })

  it('「未収に戻す」は確認ダイアログで「はい」を選んだ場合のみ未収へ更新する', async () => {
    const paid = { ...finalized, paymentStatus: 'paid', paymentDate: '2026-09-30' }
    const getInvoice = vi.fn().mockResolvedValueOnce(paid).mockResolvedValueOnce(finalized)
    const { updateInvoicePaymentStatus } = setup(getInvoice)
    renderPage(8)

    await userEvent.click(await screen.findByText('未収に戻す'))
    expect(await screen.findByText('未収に戻しますか')).toBeInTheDocument()
    await userEvent.click(screen.getByText('いいえ'))
    expect(updateInvoicePaymentStatus).not.toHaveBeenCalled()
    expect(screen.queryByText('未収に戻しますか')).not.toBeInTheDocument()

    await userEvent.click(screen.getByText('未収に戻す'))
    await userEvent.click(screen.getByText('はい'))
    await waitFor(() =>
      expect(updateInvoicePaymentStatus).toHaveBeenCalledWith(8, {
        paymentStatus: 'unpaid',
        paymentDate: null
      })
    )
    expect(await screen.findByText('未収に戻しました')).toBeInTheDocument()
    expect(screen.queryByText(/入金日:/)).not.toBeInTheDocument()
  })

  it('更新に失敗した場合はエラーを表示する', async () => {
    const { updateInvoicePaymentStatus } = setup(vi.fn().mockResolvedValue(finalized))
    updateInvoicePaymentStatus.mockRejectedValue(new Error('更新できません'))
    renderPage(8)
    await userEvent.click(await screen.findByText('入金済みにする'))
    await userEvent.click(screen.getByText('確定'))
    expect(await screen.findByText('更新できません')).toBeInTheDocument()
  })

  it('入金済みの場合は入金日と「未収に戻す」を表示する', async () => {
    setup(
      vi.fn().mockResolvedValue({ ...finalized, paymentStatus: 'paid', paymentDate: '2026-09-30' })
    )
    renderPage(8)
    expect(await screen.findByText('入金日: 2026-09-30')).toBeInTheDocument()
    expect(screen.getByText('未収に戻す')).toBeInTheDocument()
  })

  it('ハッシュ不一致の警告バッジ・flashMessage・エラー表示', async () => {
    setup(vi.fn().mockResolvedValue({ ...finalized, pdfHashMismatch: true }))
    renderPage(8, { flashMessage: 'PDFとして保存しました' })
    expect(await screen.findByText('PDFファイルの改変が疑われます')).toBeInTheDocument()
    expect(screen.getByText('PDFとして保存しました')).toBeInTheDocument()
  })

  it('該当なしの場合はエラーと一覧への導線を表示する', async () => {
    setup(vi.fn().mockRejectedValue(new Error('対象の請求書が見つかりません')))
    const onBackToList = vi.fn()
    renderPage(999, { onBackToList })
    expect(await screen.findByText('対象の請求書が見つかりません')).toBeInTheDocument()
    await userEvent.click(screen.getByText('← 一覧へ戻る'))
    expect(onBackToList).toHaveBeenCalled()
  })

  it('変換元の見積書がある場合は「元の見積書」リンクを表示し、押下で見積書詳細へ遷移を要求する', async () => {
    setup(
      vi.fn().mockResolvedValue({ ...finalized, sourceQuoteId: 3, sourceQuoteNumber: '2026-008' })
    )
    const onOpenQuote = vi.fn()
    renderPage(8, { onOpenQuote })
    expect(await screen.findByText('元の見積書')).toBeInTheDocument()
    await userEvent.click(screen.getByText('2026-008 を見る'))
    expect(onOpenQuote).toHaveBeenCalledWith(3)
  })

  it('変換元がない場合は「元の見積書」を表示しない', async () => {
    setup(vi.fn().mockResolvedValue(finalized))
    renderPage(8)
    await screen.findByText('2026-012')
    expect(screen.queryByText('元の見積書')).not.toBeInTheDocument()
  })
})
