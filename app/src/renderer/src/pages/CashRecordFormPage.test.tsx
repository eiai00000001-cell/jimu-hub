// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CashRecordFormPage } from './CashRecordFormPage'
import type { CashRecordDetail } from '@shared/types/cash-record'

const accounts = [
  { id: 1, name: '通信費', kind: 'expense', status: 'active' },
  { id: 2, name: '広告宣伝費', kind: 'expense', status: 'inactive' },
  { id: 3, name: '売上高', kind: 'income', status: 'active' }
]
const clients = [
  { id: 1, name: 'サンプル商事株式会社', status: 'active' },
  { id: 2, name: '停止中商事', status: 'inactive' }
]

function setup(overrides = {}) {
  const api = {
    listSelectableProjects: vi.fn().mockResolvedValue([]),
    listAccounts: vi.fn().mockResolvedValue(accounts),
    listClients: vi.fn().mockResolvedValue(clients),
    createRecord: vi.fn().mockResolvedValue({ id: 9 }),
    updateRecord: vi.fn().mockResolvedValue({ id: 5, changed: true }),
    getRecord: vi.fn(),
    ...overrides
  }
  window.jimuhubApi = api as unknown as Window['jimuhubApi']
  return api
}

describe('CashRecordFormPage(F-18)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('遷移元の種別で表示し、科目は種別に合う利用中のものだけを選べる。種別の切替で科目をクリアする', async () => {
    setup()
    render(<CashRecordFormPage mode="new" kind="expense" onSaved={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByText('経費の登録', { selector: 'h1' })).toBeInTheDocument()
    const select = screen.getByLabelText(/勘定科目/)
    await waitFor(() => expect(screen.getByRole('option', { name: '通信費' })).toBeInTheDocument())
    expect(screen.queryByRole('option', { name: '広告宣伝費' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '売上高' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '停止中商事' })).not.toBeInTheDocument()
    await userEvent.selectOptions(select, '1')
    await userEvent.click(screen.getByLabelText('入金'))
    expect(select).toHaveValue('')
    expect(await screen.findByRole('option', { name: '売上高' })).toBeInTheDocument()
  })

  it('金額・税区分から消費税額を即時に表示する(カンマ区切り可)', async () => {
    setup()
    render(<CashRecordFormPage mode="new" onSaved={vi.fn()} onCancel={vi.fn()} />)
    await userEvent.type(screen.getByLabelText(/金額/), '6,600')
    await userEvent.selectOptions(screen.getByLabelText('税区分'), 'standard_10')
    expect(screen.getByLabelText('消費税額')).toHaveTextContent('¥600')
  })

  it('未入力で登録すると項目ごとのエラーを表示し、保存しない', async () => {
    const api = setup()
    render(<CashRecordFormPage mode="new" onSaved={vi.fn()} onCancel={vi.fn()} />)
    await userEvent.clear(screen.getByLabelText(/日付/))
    await userEvent.click(screen.getByText('登録'))
    expect(await screen.findByText('日付を入力してください')).toBeInTheDocument()
    expect(
      screen.getByText('金額は1円以上9,999,999,999円以下の整数で入力してください')
    ).toBeInTheDocument()
    expect(screen.getByText('勘定科目を選択してください')).toBeInTheDocument()
    expect(screen.getByText('摘要・メモを入力してください')).toBeInTheDocument()
    expect(api.createRecord).not.toHaveBeenCalled()
  })

  it('入力して登録するとcreateRecordを呼び、詳細へ遷移するコールバックを呼ぶ', async () => {
    const api = setup()
    const onSaved = vi.fn()
    render(<CashRecordFormPage mode="new" kind="expense" onSaved={onSaved} onCancel={vi.fn()} />)
    await screen.findByRole('option', { name: '通信費' })
    await userEvent.type(screen.getByLabelText(/金額/), '6,600')
    await userEvent.selectOptions(screen.getByLabelText(/勘定科目/), '1')
    await userEvent.type(screen.getByLabelText(/摘要・メモ/), '  インターネット回線 ')
    await userEvent.selectOptions(screen.getByLabelText('支払方法'), 'credit_card')
    await userEvent.selectOptions(screen.getByLabelText('税区分'), 'standard_10')
    await userEvent.click(screen.getByText('登録'))
    await waitFor(() =>
      expect(api.createRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'expense',
          amount: 6600,
          accountId: 1,
          description: 'インターネット回線',
          clientId: null,
          paymentMethod: 'credit_card',
          taxCategory: 'standard_10'
        })
      )
    )
    expect(onSaved).toHaveBeenCalledWith(9, '記録を登録しました')
  })

  it('Mainからの業務エラーを画面に表示する', async () => {
    setup({ createRecord: vi.fn().mockRejectedValue(new Error('勘定科目が種別と一致しません')) })
    render(<CashRecordFormPage mode="new" onSaved={vi.fn()} onCancel={vi.fn()} />)
    await screen.findByRole('option', { name: '通信費' })
    await userEvent.type(screen.getByLabelText(/金額/), '100')
    await userEvent.selectOptions(screen.getByLabelText(/勘定科目/), '1')
    await userEvent.type(screen.getByLabelText(/摘要・メモ/), 'x')
    await userEvent.click(screen.getByText('登録'))
    expect(await screen.findByText('勘定科目が種別と一致しません')).toBeInTheDocument()
  })

  const record = (over: Partial<CashRecordDetail> = {}): CashRecordDetail => ({
    id: 5,
    recordDate: '2026-09-28',
    kind: 'expense',
    amount: 6600,
    withholdingTaxAmount: 0,
    accountId: 2,
    accountName: '広告宣伝費',
    description: '広告',
    clientId: 2,
    clientName: '停止中商事',
    paymentMethod: null,
    taxCategory: null,
    taxAmount: 0,
    invoiceId: null,
    invoiceNumber: null,
    status: 'active',
    isDeleted: false,
    createdAt: 'x',
    updatedAt: 'x',
    history: [],
    receipts: [],
    integrity: { recordHashOk: true, historyHashOk: true, receipts: [] },
    ...over
  })

  it('編集: 既存値を表示し、利用停止の現在値は選択肢に含め、種別は表示のみ。変更理由つきで更新する', async () => {
    const api = setup({ getRecord: vi.fn().mockResolvedValue(record()) })
    const onSaved = vi.fn()
    render(<CashRecordFormPage mode="edit" recordId={5} onSaved={onSaved} onCancel={vi.fn()} />)
    expect(await screen.findByDisplayValue('広告')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '広告宣伝費' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '停止中商事' })).toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('変更理由'), '訂正')
    await userEvent.click(screen.getByText('保存'))
    await waitFor(() =>
      expect(api.updateRecord).toHaveBeenCalledWith(
        expect.objectContaining({ id: 5, reason: '訂正', accountId: 2 })
      )
    )
    expect(onSaved).toHaveBeenCalledWith(5, '記録を更新しました')
  })

  it('編集: 変更が無い場合は「変更はありません」を伝える', async () => {
    setup({
      getRecord: vi
        .fn()
        .mockResolvedValue(record({ accountId: 1, clientId: null, clientName: null })),
      updateRecord: vi.fn().mockResolvedValue({ id: 5, changed: false })
    })
    const onSaved = vi.fn()
    render(<CashRecordFormPage mode="edit" recordId={5} onSaved={onSaved} onCancel={vi.fn()} />)
    await screen.findByDisplayValue('広告')
    await userEvent.click(screen.getByText('保存'))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(5, '変更はありません'))
  })

  it('編集: 請求書から作成された記録は金額・取引先を表示のみにする。取消済は編集画面を開けない', async () => {
    setup({
      getRecord: vi.fn().mockResolvedValue(
        record({
          invoiceId: 7,
          kind: 'income',
          accountId: 3,
          clientId: 1,
          clientName: 'サンプル商事株式会社',
          amount: 332370
        })
      )
    })
    const { unmount } = render(
      <CashRecordFormPage mode="edit" recordId={5} onSaved={vi.fn()} onCancel={vi.fn()} />
    )
    expect(await screen.findByText('¥332,370')).toBeInTheDocument()
    expect(screen.queryByLabelText(/金額/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('取引先')).not.toBeInTheDocument()
    unmount()
    setup({ getRecord: vi.fn().mockResolvedValue(record({ status: 'cancelled' })) })
    render(<CashRecordFormPage mode="edit" recordId={5} onSaved={vi.fn()} onCancel={vi.fn()} />)
    expect(await screen.findByText('取消済の記録は編集できません')).toBeInTheDocument()
  })

  it('サイドバーでの離脱時は入力内容にかかわらず確認する', async () => {
    setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<CashRecordFormPage mode="new" onSaved={vi.fn()} onCancel={vi.fn()} />)
    await userEvent.click(screen.getByText('ホーム'))
    expect(confirm).toHaveBeenCalledWith(
      '入力中の内容は保存されません。この画面を離れてよろしいですか'
    )
    confirm.mockRestore()
  })

  describe('領収書(F-22)', () => {
    const picked = (n: number) => ({
      files: Array.from({ length: n }, (_, i) => ({
        token: `t${i}`,
        fileName: `r${i}.pdf`,
        fileSize: 2048
      })),
      errors: []
    })

    async function fillRequired(): Promise<void> {
      await screen.findByRole('option', { name: '通信費' })
      await userEvent.type(screen.getByLabelText(/金額/), '100')
      await userEvent.selectOptions(screen.getByLabelText(/勘定科目/), '1')
      await userEvent.type(screen.getByLabelText(/摘要・メモ/), 'x')
    }

    it('ファイルを追加すると追加予定として一覧表示し、登録時に識別子を渡す。削除で一覧から外せる', async () => {
      const api = setup({ pickReceipts: vi.fn().mockResolvedValue(picked(2)) })
      render(<CashRecordFormPage mode="new" onSaved={vi.fn()} onCancel={vi.fn()} />)
      expect(screen.getByText('領収書は添付されていません。')).toBeInTheDocument()
      await fillRequired()
      await userEvent.click(screen.getByText('ファイルを追加'))
      expect(await screen.findByText('r0.pdf')).toBeInTheDocument()
      expect(screen.getAllByText(/追加予定/)).toHaveLength(2)
      expect(screen.getByText(/現在 2 件/)).toBeInTheDocument()
      await userEvent.click(screen.getAllByText('削除')[1]!)
      expect(screen.queryByText('r1.pdf')).not.toBeInTheDocument()
      await userEvent.click(screen.getByText('登録'))
      await waitFor(() =>
        expect(api.createRecord).toHaveBeenCalledWith(
          expect.objectContaining({ receiptTokens: ['t0'] })
        )
      )
    })

    it('有効な領収書が5件に達すると「ファイルを追加」を無効にし、超過分は追加せず案内する', async () => {
      setup({ pickReceipts: vi.fn().mockResolvedValue(picked(7)) })
      render(<CashRecordFormPage mode="new" onSaved={vi.fn()} onCancel={vi.fn()} />)
      await userEvent.click(screen.getByText('ファイルを追加'))
      expect(await screen.findByText('領収書は1つの記録につき5件までです')).toBeInTheDocument()
      expect(screen.getAllByText(/追加予定/)).toHaveLength(5)
      expect(screen.getByText('ファイルを追加')).toBeDisabled()
    })

    it('検証に通らないファイルはエラーを表示し、他のファイルは追加できる', async () => {
      setup({
        pickReceipts: vi.fn().mockResolvedValue({
          files: [{ token: 't', fileName: 'ok.pdf', fileSize: 1024 }],
          errors: [
            {
              fileName: 'bad.txt',
              error: '領収書として添付できるのは、PDF・JPEG・PNGのファイルです'
            }
          ]
        })
      })
      render(<CashRecordFormPage mode="new" onSaved={vi.fn()} onCancel={vi.fn()} />)
      await userEvent.click(screen.getByText('ファイルを追加'))
      expect(await screen.findByText('ok.pdf')).toBeInTheDocument()
      expect(
        screen.getByText('bad.txt: 領収書として添付できるのは、PDF・JPEG・PNGのファイルです')
      ).toBeInTheDocument()
    })

    it('編集: 保存済みの領収書を「削除」で外す予定にでき、保存時にIDを渡す', async () => {
      const receipt = {
        id: 11,
        originalName: 'old.pdf',
        mimeType: 'application/pdf',
        fileSize: 4096,
        removed: false,
        state: 'ok'
      }
      const api = setup({
        getRecord: vi.fn().mockResolvedValue({
          ...record({ accountId: 1, clientId: null, clientName: null }),
          receipts: [receipt]
        })
      })
      render(<CashRecordFormPage mode="edit" recordId={5} onSaved={vi.fn()} onCancel={vi.fn()} />)
      expect(await screen.findByText('old.pdf')).toBeInTheDocument()
      expect(screen.getByText(/保存済み/)).toBeInTheDocument()
      await userEvent.click(screen.getByText('削除'))
      expect(screen.getByText(/外す予定/)).toBeInTheDocument()
      await userEvent.click(screen.getByText('保存'))
      await waitFor(() =>
        expect(api.updateRecord).toHaveBeenCalledWith(
          expect.objectContaining({ id: 5, removeReceiptIds: [11], addReceiptTokens: [] })
        )
      )
    })
  })
})

describe('CashRecordFormPage: 案件(F-30。詳細設計書3.26章)', () => {
  async function fillAndSubmit(api: ReturnType<typeof setup>, projectId?: string): Promise<void> {
    render(<CashRecordFormPage mode="new" kind="expense" onSaved={vi.fn()} onCancel={vi.fn()} />)
    await screen.findByRole('option', { name: 'アルファ保守' })
    await userEvent.type(screen.getByLabelText(/金額/), '1000')
    await userEvent.selectOptions(screen.getByLabelText(/勘定科目/), '1')
    await userEvent.type(screen.getByLabelText(/摘要/), 'テスト')
    if (projectId) await userEvent.selectOptions(screen.getByLabelText('案件'), projectId)
    await userEvent.click(screen.getByRole('button', { name: '登録' }))
    await waitFor(() => expect(api.createRecord).toHaveBeenCalledTimes(1))
  }
  const withProjects = () =>
    setup({
      listSelectableProjects: vi
        .fn()
        .mockResolvedValue([{ id: 3, name: 'アルファ保守', status: 'active' }])
    })

  it('登録画面には「案件」を表示し、選んだ案件をprojectIdとして送る', async () => {
    const api = withProjects()
    await fillAndSubmit(api, '3')
    expect(api.createRecord).toHaveBeenCalledWith(expect.objectContaining({ projectId: 3 }))
  })

  it('案件を選ばない場合は、projectIdを送らない', async () => {
    const api = withProjects()
    await fillAndSubmit(api)
    expect(api.createRecord.mock.calls[0]![0]).not.toHaveProperty('projectId')
  })

  it('編集画面には「案件」を表示しない(詳細画面の「案件を変更」で変更する)', async () => {
    setup({
      getRecord: vi.fn().mockResolvedValue({
        id: 5,
        kind: 'expense',
        recordDate: '2026-09-28',
        amount: 1000,
        accountId: 1,
        description: 'x',
        clientId: null,
        paymentMethod: null,
        taxCategory: null,
        receipts: [],
        isDeleted: false,
        status: 'active',
        invoiceId: null
      })
    })
    render(<CashRecordFormPage mode="edit" recordId={5} onSaved={vi.fn()} onCancel={vi.fn()} />)
    await screen.findByDisplayValue('x')
    expect(screen.queryByLabelText('案件')).not.toBeInTheDocument()
  })
})
