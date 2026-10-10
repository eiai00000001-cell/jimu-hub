// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectListPage } from './ProjectListPage'
import type { ProjectListItem } from '@shared/types/project'

const item = (overrides: Partial<ProjectListItem> = {}): ProjectListItem => ({
  id: 1,
  name: 'アルファ商事 保守契約',
  clientId: 1,
  clientName: 'アルファ商事株式会社',
  status: 'active',
  startDate: '2026-04-01',
  endDate: '2027-03-31',
  ...overrides
})

describe('ProjectListPage(F-28・F-29。詳細設計書3.22章)', () => {
  let listProjects: ReturnType<typeof vi.fn>
  let completeProject: ReturnType<typeof vi.fn>
  let reopenProject: ReturnType<typeof vi.fn>

  beforeEach(() => {
    listProjects = vi.fn().mockResolvedValue([item()])
    completeProject = vi.fn().mockResolvedValue({ success: true })
    reopenProject = vi.fn().mockResolvedValue({ success: true })
    window.jimuhubApi = {
      listClients: vi.fn().mockResolvedValue([
        { id: 1, name: 'アルファ商事株式会社' },
        { id: 2, name: '停止中の取引先' }
      ]),
      listProjects,
      completeProject,
      reopenProject
    } as unknown as Window['jimuhubApi']
  })
  afterEach(() => vi.restoreAllMocks())

  it('既定では進行中の案件を取得し、案件名・取引先・状態・期間を表示する', async () => {
    render(<ProjectListPage onNewProject={vi.fn()} onSelectProject={vi.fn()} />)

    expect(await screen.findByText('アルファ商事 保守契約')).toBeInTheDocument()
    expect(listProjects).toHaveBeenCalledWith({ status: 'active' })
    expect(screen.getByText('アルファ商事株式会社', { selector: 'td' })).toBeInTheDocument()
    expect(screen.getByText('進行中', { selector: '.badge' })).toBeInTheDocument()
    expect(screen.getByText('2026-04-01〜2027-03-31')).toBeInTheDocument()
    expect(screen.getByText('1件')).toBeInTheDocument()
  })

  it('開始日のみの案件は「開始日〜」、期間が無い案件は空欄で表示する', async () => {
    listProjects.mockResolvedValue([
      item({ id: 1, endDate: null }),
      item({ id: 2, name: '期間なし', startDate: null, endDate: null })
    ])
    render(<ProjectListPage onNewProject={vi.fn()} onSelectProject={vi.fn()} />)
    expect(await screen.findByText('2026-04-01〜')).toBeInTheDocument()
  })

  it('検索条件を変えるたびに再取得する(案件名・取引先・状態・期間)', async () => {
    render(<ProjectListPage onNewProject={vi.fn()} onSelectProject={vi.fn()} />)
    await screen.findByText('アルファ商事 保守契約')

    await userEvent.type(screen.getByLabelText('案件名'), '保守')
    await waitFor(() =>
      expect(listProjects).toHaveBeenLastCalledWith({ keyword: '保守', status: 'active' })
    )
    await userEvent.selectOptions(screen.getByLabelText('取引先'), '1')
    await userEvent.selectOptions(screen.getByLabelText('状態'), 'all')
    await userEvent.type(screen.getByLabelText('期間の開始日'), '2026-10-01')
    await userEvent.type(screen.getByLabelText('期間の終了日'), '2026-10-31')
    await waitFor(() =>
      expect(listProjects).toHaveBeenLastCalledWith({
        keyword: '保守',
        clientId: 1,
        status: 'all',
        periodFrom: '2026-10-01',
        periodTo: '2026-10-31'
      })
    )
  })

  it('期間の終了日が開始日より前の間は、エラーを表示し、再取得せず直前の表示を維持する', async () => {
    render(<ProjectListPage onNewProject={vi.fn()} onSelectProject={vi.fn()} />)
    await screen.findByText('アルファ商事 保守契約')
    await userEvent.type(screen.getByLabelText('期間の開始日'), '2026-12-01')
    await waitFor(() => expect(listProjects).toHaveBeenCalledTimes(2))
    const calls = listProjects.mock.calls.length

    await userEvent.type(screen.getByLabelText('期間の終了日'), '2026-10-01')

    expect(
      await screen.findByText('期間の終了日は、開始日以降の日付を入力してください')
    ).toBeInTheDocument()
    expect(listProjects).toHaveBeenCalledTimes(calls)
    expect(screen.getByText('アルファ商事 保守契約')).toBeInTheDocument()
  })

  it('該当0件の場合は案内を表示する', async () => {
    listProjects.mockResolvedValue([])
    render(<ProjectListPage onNewProject={vi.fn()} onSelectProject={vi.fn()} />)
    expect(await screen.findByText('該当する案件がありません')).toBeInTheDocument()
  })

  it('「案件を登録」で登録画面へ、行クリックで詳細へ遷移を要求する', async () => {
    const onNew = vi.fn()
    const onSelect = vi.fn()
    render(<ProjectListPage onNewProject={onNew} onSelectProject={onSelect} />)
    await userEvent.click(await screen.findByText('アルファ商事 保守契約'))
    expect(onSelect).toHaveBeenCalledWith(1)
    await userEvent.click(screen.getByRole('button', { name: '+ 案件を登録' }))
    expect(onNew).toHaveBeenCalled()
  })

  it('「完了」は確認のうえ状態を更新して再取得する。「いいえ」の場合は何も変更しない', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    render(<ProjectListPage onNewProject={vi.fn()} onSelectProject={vi.fn()} />)
    const row = (await screen.findByText('アルファ商事 保守契約')).closest('tr')!

    await userEvent.click(within(row).getByRole('button', { name: '完了' }))
    expect(completeProject).not.toHaveBeenCalled()

    await userEvent.click(within(row).getByRole('button', { name: '完了' }))
    expect(confirm).toHaveBeenLastCalledWith(
      'この案件を完了にします。完了にしても、データは残ります。よろしいですか'
    )
    await waitFor(() => expect(completeProject).toHaveBeenCalledWith(1))
    await waitFor(() => expect(listProjects).toHaveBeenCalledTimes(2))
  })

  it('完了の案件には「再開」を表示し、確認のうえ進行中へ戻す', async () => {
    listProjects.mockResolvedValue([item({ status: 'completed' })])
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<ProjectListPage onNewProject={vi.fn()} onSelectProject={vi.fn()} />)
    expect(await screen.findByText('完了', { selector: '.badge' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '再開' }))

    await waitFor(() => expect(reopenProject).toHaveBeenCalledWith(1))
  })

  it('状態の更新に失敗した場合は、エラーを表示する', async () => {
    completeProject.mockRejectedValue(new Error('ProjectError: すでに完了の案件です'))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<ProjectListPage onNewProject={vi.fn()} onSelectProject={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: '完了' }))
    expect(await screen.findByText('すでに完了の案件です')).toBeInTheDocument()
  })

  it('保存・削除後のメッセージを表示する', async () => {
    render(
      <ProjectListPage
        flashMessage="案件を削除しました"
        onNewProject={vi.fn()}
        onSelectProject={vi.fn()}
      />
    )
    expect(await screen.findByText('案件を削除しました')).toBeInTheDocument()
  })
})
