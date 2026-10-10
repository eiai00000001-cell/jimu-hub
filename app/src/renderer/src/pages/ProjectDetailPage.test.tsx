// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectDetailPage } from './ProjectDetailPage'
import type { ProjectDetail } from '@shared/types/project'

const detail = (overrides: Partial<ProjectDetail> = {}): ProjectDetail => ({
  id: 7,
  name: 'サンプル商事 Webサイト制作',
  clientId: 1,
  clientName: 'サンプル商事株式会社',
  startDate: '2026-08-01',
  endDate: '2026-11-30',
  memo: 'トップページ・下層5ページ',
  status: 'active',
  createdAt: '',
  updatedAt: '',
  quotes: [
    {
      id: 1,
      documentNumber: '2026-008',
      issueDate: '2026-09-20',
      clientName: 'サンプル商事株式会社',
      totalAmount: 363000,
      status: 'finalized'
    }
  ],
  invoices: [
    {
      id: 2,
      documentNumber: null,
      issueDate: '2026-10-01',
      clientName: 'サンプル商事株式会社',
      totalAmount: 363000,
      status: 'draft'
    }
  ],
  records: [
    {
      id: 3,
      recordDate: '2026-09-15',
      kind: 'expense',
      amount: 55000,
      description: 'デザイン作業の外注',
      status: 'active'
    },
    {
      id: 4,
      recordDate: '2026-09-12',
      kind: 'income',
      amount: 332370,
      description: '入金',
      status: 'cancelled'
    }
  ],
  history: [
    {
      id: 1,
      operatedAt: '2026-10-03T00:30:00.000Z',
      targetType: 'invoice',
      targetId: 2,
      targetLabel: '2026-012',
      fromProjectId: null,
      fromProjectName: null,
      toProjectId: 7,
      toProjectName: 'サンプル商事 Webサイト制作',
      kind: 'assign'
    }
  ],
  deletable: false,
  ...overrides
})

describe('ProjectDetailPage(F-27・F-29。詳細設計書3.24章)', () => {
  let getProject: ReturnType<typeof vi.fn>
  const handlers = () => ({
    onBackToList: vi.fn(),
    onEdit: vi.fn(),
    onDeleted: vi.fn(),
    onOpenQuote: vi.fn(),
    onOpenInvoice: vi.fn(),
    onOpenRecord: vi.fn()
  })

  beforeEach(() => {
    getProject = vi.fn().mockResolvedValue(detail())
    window.jimuhubApi = {
      getProject,
      completeProject: vi.fn().mockResolvedValue({ success: true }),
      reopenProject: vi.fn().mockResolvedValue({ success: true }),
      deleteProject: vi.fn().mockResolvedValue({ success: true }),
      listSelectableProjects: vi.fn().mockResolvedValue([
        { id: 7, name: 'サンプル商事 Webサイト制作', status: 'active' },
        { id: 8, name: '別の案件', status: 'active' }
      ]),
      changeProjectLink: vi.fn().mockResolvedValue({ changed: true })
    } as unknown as Window['jimuhubApi']
  })
  afterEach(() => vi.restoreAllMocks())

  it('基本情報・紐づく書類・入出金・付け替え履歴を表示する', async () => {
    render(<ProjectDetailPage projectId={7} {...handlers()} />)

    expect(
      await screen.findByText('サンプル商事 Webサイト制作', { selector: 'dd' })
    ).toBeInTheDocument()
    expect(screen.getByText('2026-08-01〜2026-11-30')).toBeInTheDocument()
    expect(screen.getByText('2026-008')).toBeInTheDocument()
    expect(screen.getByText('下書き', { selector: 'button' })).toBeInTheDocument()
    expect(screen.getByText('デザイン作業の外注')).toBeInTheDocument()
    expect(screen.getByText('取消済')).toBeInTheDocument()
    expect(screen.getByText('請求書 2026-012')).toBeInTheDocument()
    expect(screen.getByText('案件なし')).toBeInTheDocument()
    expect(screen.getByText('紐づけ')).toBeInTheDocument()
  })

  it('書類・入出金の行から、各詳細画面への遷移を要求する', async () => {
    const h = handlers()
    render(<ProjectDetailPage projectId={7} {...h} />)
    await userEvent.click(await screen.findByText('2026-008'))
    expect(h.onOpenQuote).toHaveBeenCalledWith(1)
    await userEvent.click(screen.getByText('下書き', { selector: 'button' }))
    expect(h.onOpenInvoice).toHaveBeenCalledWith(2)
    await userEvent.click(screen.getByText('デザイン作業の外注'))
    expect(h.onOpenRecord).toHaveBeenCalledWith(3)
  })

  it('紐づけがある案件には「削除」を表示しない', async () => {
    render(<ProjectDetailPage projectId={7} {...handlers()} />)
    await screen.findByText('2026-008')
    expect(screen.queryByRole('button', { name: '削除' })).not.toBeInTheDocument()
  })

  it('紐づけが0件の案件は、確認のうえ削除し、一覧へ遷移を要求する。「いいえ」の場合は何もしない', async () => {
    getProject.mockResolvedValue(detail({ quotes: [], invoices: [], records: [], deletable: true }))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    const h = handlers()
    render(<ProjectDetailPage projectId={7} {...h} />)

    await userEvent.click(await screen.findByRole('button', { name: '削除' }))
    expect(window.jimuhubApi.deleteProject).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '削除' }))

    expect(confirm).toHaveBeenLastCalledWith(
      'この案件を削除します。削除すると元に戻せません。よろしいですか'
    )
    await waitFor(() => expect(window.jimuhubApi.deleteProject).toHaveBeenCalledWith(7))
    expect(h.onDeleted).toHaveBeenCalled()
    expect(screen.getByText('紐づく見積書・請求書はありません')).toBeInTheDocument()
  })

  it('進行中の案件は「完了」、完了の案件は「再開」を表示し、確認のうえ状態を更新して再取得する', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<ProjectDetailPage projectId={7} {...handlers()} />)
    getProject.mockResolvedValue(detail({ status: 'completed' }))

    await userEvent.click(await screen.findByRole('button', { name: '完了' }))

    await waitFor(() => expect(window.jimuhubApi.completeProject).toHaveBeenCalledWith(7))
    const reopen = await screen.findByRole('button', { name: '再開' })
    await userEvent.click(reopen)
    await waitFor(() => expect(window.jimuhubApi.reopenProject).toHaveBeenCalledWith(7))
  })

  it('削除・状態変更でエラーになった場合は、メッセージを表示する', async () => {
    getProject.mockResolvedValue(detail({ deletable: true }))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    window.jimuhubApi.deleteProject = vi
      .fn()
      .mockRejectedValue(new Error('ProjectError: 紐づけがあるため削除できません'))
    render(<ProjectDetailPage projectId={7} {...handlers()} />)
    await userEvent.click(await screen.findByRole('button', { name: '削除' }))
    expect(await screen.findByText('紐づけがあるため削除できません')).toBeInTheDocument()
  })

  it('「編集」「一覧へ戻る」で遷移を要求する', async () => {
    const h = handlers()
    render(<ProjectDetailPage projectId={7} {...h} />)
    await userEvent.click(await screen.findByRole('button', { name: '編集' }))
    expect(h.onEdit).toHaveBeenCalledWith(7)
    await userEvent.click(screen.getByText(/一覧へ戻る/))
    expect(h.onBackToList).toHaveBeenCalled()
  })

  it('案件が存在しない場合は、エラーと一覧への導線を表示する', async () => {
    getProject.mockRejectedValue(new Error('ProjectError: 指定された案件が見つかりません'))
    const h = handlers()
    render(<ProjectDetailPage projectId={9} {...h} />)
    expect(await screen.findByText('指定された案件が見つかりません')).toBeInTheDocument()
    await userEvent.click(screen.getByText(/一覧へ戻る/))
    expect(h.onBackToList).toHaveBeenCalled()
    expect(within(document.body).queryByRole('button', { name: '編集' })).not.toBeInTheDocument()
  })

  it('紐づく行の「案件を変更」から、案件を付け替えると、詳細を再取得する', async () => {
    render(<ProjectDetailPage projectId={7} {...handlers()} />)
    const buttons = await screen.findAllByRole('button', { name: '案件を変更' })
    expect(buttons).toHaveLength(4)

    await userEvent.click(buttons[0]!)
    expect(screen.getByText('請求書 下書き')).toBeInTheDocument()
    await screen.findByRole('option', { name: '別の案件' })
    await userEvent.selectOptions(screen.getByLabelText('変更先の案件'), '8')
    await userEvent.click(screen.getByRole('button', { name: '変更する' }))

    await waitFor(() =>
      expect(window.jimuhubApi.changeProjectLink).toHaveBeenCalledWith({
        targetType: 'invoice',
        targetId: 2,
        projectId: 8
      })
    )
    await waitFor(() => expect(getProject).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('入出金・経費の行の「案件を変更」は、行クリック(詳細への遷移)を起こさない', async () => {
    const h = handlers()
    render(<ProjectDetailPage projectId={7} {...h} />)
    const buttons = await screen.findAllByRole('button', { name: '案件を変更' })
    await userEvent.click(buttons[2]!)
    expect(h.onOpenRecord).not.toHaveBeenCalled()
    expect(screen.getByText(/2026-09-15 経費 デザイン作業の外注/)).toBeInTheDocument()
  })
})
