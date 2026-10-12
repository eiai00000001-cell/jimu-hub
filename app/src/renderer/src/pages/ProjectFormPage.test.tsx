// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectFormPage } from './ProjectFormPage'
import type { ProjectDetail } from '@shared/types/project'

const detail = (overrides: Partial<ProjectDetail> = {}): ProjectDetail => ({
  id: 7,
  name: '既存の案件',
  clientId: 2,
  clientName: '停止中の取引先',
  startDate: '2026-04-01',
  endDate: '2026-09-30',
  memo: 'メモ',
  status: 'active',
  createdAt: '',
  updatedAt: '',
  quotes: [],
  invoices: [],
  records: [],
  history: [],
  summary: {
    sales: 0,
    withholding: 0,
    expense: 0,
    balance: 0,
    counts: { quotes: 0, invoicesIssued: 0, invoicesDraft: 0, incomes: 0, expenses: 0 }
  },
  deletable: true,
  ...overrides
})

describe('ProjectFormPage(F-27。詳細設計書3.23章)', () => {
  let createProject: ReturnType<typeof vi.fn>
  let updateProject: ReturnType<typeof vi.fn>
  let getProject: ReturnType<typeof vi.fn>

  beforeEach(() => {
    createProject = vi.fn().mockResolvedValue({ id: 11 })
    updateProject = vi.fn().mockResolvedValue({ success: true })
    getProject = vi.fn().mockResolvedValue(detail())
    window.jimuhubApi = {
      listClients: vi.fn().mockResolvedValue([{ id: 1, name: 'アルファ商事株式会社' }]),
      createProject,
      updateProject,
      getProject
    } as unknown as Window['jimuhubApi']
  })
  afterEach(() => vi.restoreAllMocks())

  it('登録: 入力して「登録」を押すと、空の項目を既定値で送り、保存後に遷移を要求する', async () => {
    const onSaved = vi.fn()
    render(<ProjectFormPage mode="new" onSaved={onSaved} onCancel={vi.fn()} />)

    await userEvent.type(screen.getByLabelText('案件名'), '  新しい案件  ')
    await userEvent.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() =>
      expect(createProject).toHaveBeenCalledWith({
        name: '新しい案件',
        clientId: null,
        startDate: '',
        endDate: '',
        memo: ''
      })
    )
    expect(onSaved).toHaveBeenCalledWith(11)
  })

  it('取引先は、利用中の取引先から選べる(未選択を含む)', async () => {
    render(<ProjectFormPage mode="new" onSaved={vi.fn()} onCancel={vi.fn()} />)
    await screen.findByRole('option', { name: 'アルファ商事株式会社' })
    expect(screen.getByRole('option', { name: '(未選択)' })).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('案件名'), 'A')
    await userEvent.selectOptions(screen.getByLabelText('取引先'), '1')
    await userEvent.type(screen.getByLabelText('開始日'), '2026-10-01')
    await userEvent.click(screen.getByRole('button', { name: '登録' }))
    await waitFor(() =>
      expect(createProject).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: 1, startDate: '2026-10-01' })
      )
    )
  })

  it('案件名が空・100文字超、メモが1000文字超の場合は、項目の下にエラーを表示し、登録しない', async () => {
    render(<ProjectFormPage mode="new" onSaved={vi.fn()} onCancel={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: '登録' }))
    expect(await screen.findByText('案件名を入力してください')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('案件名'), 'あ'.repeat(101))
    await userEvent.click(screen.getByRole('button', { name: '登録' }))
    expect(await screen.findByText('案件名は100文字以内で入力してください')).toBeInTheDocument()

    await userEvent.clear(screen.getByLabelText('案件名'))
    await userEvent.type(screen.getByLabelText('案件名'), 'A')
    await userEvent.click(screen.getByLabelText('メモ'))
    await userEvent.paste('あ'.repeat(1001))
    await userEvent.click(screen.getByRole('button', { name: '登録' }))
    expect(await screen.findByText('メモは1000文字以内で入力してください')).toBeInTheDocument()
    expect(createProject).not.toHaveBeenCalled()
  })

  it('終了日が開始日より前の場合は、終了日の下にエラーを表示する', async () => {
    render(<ProjectFormPage mode="new" onSaved={vi.fn()} onCancel={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('案件名'), 'A')
    await userEvent.type(screen.getByLabelText('開始日'), '2026-12-01')
    await userEvent.type(screen.getByLabelText('終了日'), '2026-10-01')
    await userEvent.click(screen.getByRole('button', { name: '登録' }))

    expect(
      await screen.findByText('終了日は、開始日以降の日付を入力してください')
    ).toBeInTheDocument()
    expect(createProject).not.toHaveBeenCalled()
  })

  it('Main側のエラー(利用停止の取引先など)は、メッセージとして表示する', async () => {
    createProject.mockRejectedValue(new Error('ProjectError: 利用停止中の取引先は選択できません'))
    render(<ProjectFormPage mode="new" onSaved={vi.fn()} onCancel={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('案件名'), 'A')
    await userEvent.click(screen.getByRole('button', { name: '登録' }))
    expect(await screen.findByText('利用停止中の取引先は選択できません')).toBeInTheDocument()
  })

  it('編集: 現在の値を表示し、現在の取引先が利用停止でも選択肢に含める。「保存」で更新する', async () => {
    const onSaved = vi.fn()
    render(<ProjectFormPage mode="edit" projectId={7} onSaved={onSaved} onCancel={vi.fn()} />)

    expect(await screen.findByDisplayValue('既存の案件')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '停止中の取引先(利用停止)' })).toBeInTheDocument()
    expect(screen.getByLabelText('取引先')).toHaveValue('2')

    await userEvent.clear(screen.getByLabelText('案件名'))
    await userEvent.type(screen.getByLabelText('案件名'), '改名')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() =>
      expect(updateProject).toHaveBeenCalledWith(7, {
        name: '改名',
        clientId: 2,
        startDate: '2026-04-01',
        endDate: '2026-09-30',
        memo: 'メモ'
      })
    )
    expect(onSaved).toHaveBeenCalledWith(7)
  })

  it('編集対象が存在しない場合は、エラーと一覧への導線を表示する', async () => {
    getProject.mockRejectedValue(new Error('ProjectError: 指定された案件が見つかりません'))
    const onCancel = vi.fn()
    render(<ProjectFormPage mode="edit" projectId={9} onSaved={vi.fn()} onCancel={onCancel} />)
    expect(await screen.findByText('指定された案件が見つかりません')).toBeInTheDocument()
    await userEvent.click(screen.getByText(/一覧へ戻る/))
    expect(onCancel).toHaveBeenCalled()
  })

  it('「キャンセル」で遷移元へ戻る', async () => {
    const onCancel = vi.fn()
    render(<ProjectFormPage mode="new" onSaved={vi.fn()} onCancel={onCancel} />)
    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('サイドバーのメニュー押下時は、入力内容の有無にかかわらず離脱の確認を表示する', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<ProjectFormPage mode="new" onSaved={vi.fn()} onCancel={vi.fn()} />)
    await userEvent.click(screen.getByText('ホーム'))
    expect(confirm).toHaveBeenCalledWith(
      '入力中の内容は保存されません。この画面を離れてよろしいですか'
    )
  })
})
