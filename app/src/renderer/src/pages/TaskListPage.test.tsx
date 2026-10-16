// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TaskListPage } from './TaskListPage'
import type { TaskListItem, TaskListResult } from '@shared/types/task'

const item = (overrides: Partial<TaskListItem> = {}): TaskListItem => ({
  id: 1,
  name: '請求書の送付準備',
  status: 'open',
  dueDate: '2026-10-09',
  projectId: 7,
  projectName: 'サンプル商事 Webサイト制作',
  projectStatus: 'active',
  completedAt: null,
  overdue: true,
  ...overrides
})

const result = (items: TaskListItem[], open = 5, overdue = 2): TaskListResult => ({
  items,
  counts: { open, overdue }
})

describe('TaskListPage(F-35〜F-37。詳細設計書3.27章。モックアップ F-35_task-list)', () => {
  let listTasks: ReturnType<typeof vi.fn>
  let completeTask: ReturnType<typeof vi.fn>
  let reopenTask: ReturnType<typeof vi.fn>
  let deleteTask: ReturnType<typeof vi.fn>

  beforeEach(() => {
    listTasks = vi.fn().mockResolvedValue(result([item()]))
    completeTask = vi.fn().mockResolvedValue({ changed: true })
    reopenTask = vi.fn().mockResolvedValue({ changed: true })
    deleteTask = vi.fn().mockResolvedValue({ success: true })
    window.jimuhubApi = {
      listTasks,
      completeTask,
      reopenTask,
      deleteTask,
      listProjects: vi.fn().mockResolvedValue([
        { id: 7, name: 'サンプル商事 Webサイト制作', status: 'active' },
        { id: 8, name: 'アルファ商事 保守契約', status: 'active' }
      ])
    } as unknown as Window['jimuhubApi']
  })
  afterEach(() => vi.restoreAllMocks())

  const renderPage = (props: Partial<Parameters<typeof TaskListPage>[0]> = {}): void => {
    render(<TaskListPage onNewTask={vi.fn()} onSelectTask={vi.fn()} {...props} />)
  }

  it('案件の一覧を取得できない場合は、エラーを表示する(未処理のPromise拒否にしない)', async () => {
    window.jimuhubApi.listProjects = vi
      .fn()
      .mockRejectedValue(
        new Error("Error invoking remote method 'projects:list': Error: 案件を取得できません")
      )
    renderPage()

    expect(await screen.findByText('案件を取得できません')).toBeInTheDocument()
    // タスクの一覧は、案件の取得に失敗しても表示できる
    expect(await screen.findByText('請求書の送付準備')).toBeInTheDocument()
  })

  it('既定は未完了のみで取得し、タスク名・状態・期限日・案件を表示する。見出しは「タスク一覧」', async () => {
    renderPage()

    expect(await screen.findByText('請求書の送付準備')).toBeInTheDocument()
    expect(listTasks).toHaveBeenCalledWith({ status: 'open', dueMode: 'any' })
    expect(screen.getByRole('heading', { name: 'タスク一覧' })).toBeInTheDocument()
    expect(document.querySelector('.titlebar-title')?.textContent).toBe('事務HUB - タスク一覧')
    expect(screen.getByText('未完了', { selector: '.badge' })).toBeInTheDocument()
    expect(screen.getByText('サンプル商事 Webサイト制作', { selector: 'td' })).toBeInTheDocument()
    expect(screen.getByText('該当 1件')).toBeInTheDocument()
  })

  it('期限超過は、赤字の期限日・「期限超過」バッジ・行の帯(overdueクラス)で示し、色だけに頼らない', async () => {
    renderPage()
    await screen.findByText('請求書の送付準備')

    const row = screen.getByText('請求書の送付準備').closest('tr')!
    expect(row).toHaveClass('overdue')
    expect(within(row).getByText('2026-10-09')).toHaveClass('due-overdue')
    expect(within(row).getByText('期限超過')).toHaveClass('badge-overdue')
  })

  it('期限超過でない行(期限日が今日・未来・完了)には強調を付けない。期限なしは「期限なし」、案件なしは「案件なし」', async () => {
    listTasks.mockResolvedValue(
      result([
        item({ id: 1, name: '今日が期限', dueDate: '2026-10-14', overdue: false }),
        item({
          id: 2,
          name: '期限なし',
          dueDate: null,
          projectId: null,
          projectName: null,
          projectStatus: null,
          overdue: false
        }),
        item({
          id: 3,
          name: '完了済み',
          status: 'done',
          dueDate: '2026-10-01',
          completedAt: '2026-10-02T00:00:00.000Z',
          overdue: false
        })
      ])
    )
    renderPage()
    await screen.findByText('今日が期限')

    expect(screen.queryByText('期限超過', { selector: '.badge-overdue' })).not.toBeInTheDocument()
    const today = screen.getByText('今日が期限').closest('tr')!
    expect(today).not.toHaveClass('overdue')
    expect(within(today).getByText('2026-10-14')).not.toHaveClass('due-overdue')
    const none = screen.getByText('期限なし', { selector: 'td.task-name button' }).closest('tr')!
    expect(within(none).getByText('期限なし', { selector: 'td span' })).toBeInTheDocument()
    expect(within(none).getByText('案件なし')).toBeInTheDocument()
    const done = screen.getByText('完了済み').closest('tr')!
    expect(done).toHaveClass('done')
    expect(within(done).getByText('完了', { selector: '.badge' })).toBeInTheDocument()
    expect(within(done).getByText('2026-10-01')).not.toHaveClass('due-overdue')
  })

  it('上部の件数カード: 未完了と期限超過(1件以上は強調)。全タスクを対象に数える旨の注記を表示する', async () => {
    renderPage()
    await screen.findByText('請求書の送付準備')

    const cards = document.querySelectorAll('.task-count')
    expect(cards).toHaveLength(2)
    expect(cards[0]).toHaveTextContent('未完了')
    expect(cards[0]).toHaveTextContent('5 件')
    expect(cards[1]).toHaveClass('alert')
    expect(cards[1]).toHaveTextContent('期限超過')
    expect(cards[1]).toHaveTextContent('2 件')
    expect(
      screen.getByText('件数は、下の絞り込みにかかわらず、全タスクを対象に数えています。')
    ).toBeInTheDocument()
  })

  it('期限超過が0件のときは、件数カードを強調しない', async () => {
    listTasks.mockResolvedValue(result([], 3, 0))
    renderPage()
    await screen.findByText('該当するタスクはありません')

    const cards = document.querySelectorAll('.task-count')
    expect(cards[1]).not.toHaveClass('alert')
    expect(cards[1]).toHaveTextContent('0 件')
  })

  it('該当0件のときは「該当するタスクはありません」を表示する', async () => {
    listTasks.mockResolvedValue(result([]))
    renderPage()
    expect(await screen.findByText('該当するタスクはありません')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('絞り込み: 状態・案件(案件なし含む)・期限・キーワードを変えると、そのたびに再取得する', async () => {
    renderPage()
    await screen.findByText('請求書の送付準備')

    await userEvent.selectOptions(screen.getByLabelText('状態'), 'all')
    await waitFor(() =>
      expect(listTasks).toHaveBeenLastCalledWith({ status: 'all', dueMode: 'any' })
    )
    await userEvent.selectOptions(screen.getByLabelText('案件'), '案件なし')
    await waitFor(() =>
      expect(listTasks).toHaveBeenLastCalledWith({ status: 'all', projectId: null, dueMode: 'any' })
    )
    await userEvent.selectOptions(screen.getByLabelText('案件'), 'アルファ商事 保守契約')
    await waitFor(() =>
      expect(listTasks).toHaveBeenLastCalledWith({ status: 'all', projectId: 8, dueMode: 'any' })
    )
    await userEvent.selectOptions(screen.getByLabelText('期限'), '期限超過のみ')
    await waitFor(() =>
      expect(listTasks).toHaveBeenLastCalledWith({
        status: 'all',
        projectId: 8,
        dueMode: 'overdue'
      })
    )
    await userEvent.type(screen.getByLabelText('タスク名'), '請求')
    await waitFor(() =>
      expect(listTasks).toHaveBeenLastCalledWith({
        status: 'all',
        projectId: 8,
        dueMode: 'overdue',
        keyword: '請求'
      })
    )
  })

  it('案件の選択肢は、すべての案件(完了を含む)を取得して並べる', async () => {
    renderPage()
    await screen.findByText('請求書の送付準備')
    expect(window.jimuhubApi.listProjects).toHaveBeenCalledWith({ status: 'all' })
    const options = within(screen.getByLabelText('案件')).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual([
      'すべて',
      '案件なし',
      'サンプル商事 Webサイト制作',
      'アルファ商事 保守契約'
    ])
  })

  it('期限「期間指定」: 期間の入力欄を表示し、開始日・終了日で再取得する', async () => {
    renderPage()
    await screen.findByText('請求書の送付準備')
    await userEvent.selectOptions(screen.getByLabelText('期限'), '期間指定')
    await userEvent.type(screen.getByLabelText('期限の開始日'), '2026-10-01')
    await userEvent.type(screen.getByLabelText('期限の終了日'), '2026-10-31')
    await waitFor(() =>
      expect(listTasks).toHaveBeenLastCalledWith({
        status: 'open',
        dueMode: 'range',
        dueFrom: '2026-10-01',
        dueTo: '2026-10-31'
      })
    )
  })

  it('期間の終了日が開始日より前: エラーを表示し、解消されるまで再取得せず直前の表示を維持する', async () => {
    renderPage()
    await screen.findByText('請求書の送付準備')
    await userEvent.selectOptions(screen.getByLabelText('期限'), '期間指定')
    const callsBefore = listTasks.mock.calls.length
    await userEvent.type(screen.getByLabelText('期限の開始日'), '2026-10-20')
    await userEvent.type(screen.getByLabelText('期限の終了日'), '2026-10-10')

    expect(
      await screen.findByText('期限の終了日は、開始日以降の日付を入力してください')
    ).toBeInTheDocument()
    expect(screen.getByText('請求書の送付準備')).toBeInTheDocument()
    const rangeCalls = listTasks.mock.calls.filter(
      ([f]) => (f as { dueTo?: string }).dueTo === '2026-10-10'
    )
    expect(rangeCalls).toHaveLength(0)
    expect(listTasks.mock.calls.length).toBeGreaterThanOrEqual(callsBefore)
  })

  it('「完了にする」は確認なしで切り替え、一覧を再取得する。完了の行は「未完了に戻す」', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: '完了にする' }))

    await waitFor(() => expect(completeTask).toHaveBeenCalledWith(1))
    expect(confirm).not.toHaveBeenCalled()
    await waitFor(() => expect(listTasks.mock.calls.length).toBeGreaterThanOrEqual(2))

    listTasks.mockResolvedValue(
      result([item({ status: 'done', completedAt: '2026-10-02T00:00:00.000Z', overdue: false })])
    )
    await userEvent.selectOptions(screen.getByLabelText('状態'), 'done')
    await userEvent.click(await screen.findByRole('button', { name: '未完了に戻す' }))
    await waitFor(() => expect(reopenTask).toHaveBeenCalledWith(1))
    expect(confirm).not.toHaveBeenCalled()
  })

  it('「削除」は確認ダイアログ(いいえで中止)。はいで削除して再取得する', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    renderPage()
    const del = await screen.findByRole('button', { name: '削除' })

    await userEvent.click(del)
    expect(confirm).toHaveBeenCalledWith(
      'このタスクを削除します。削除すると元に戻せません。よろしいですか'
    )
    expect(deleteTask).not.toHaveBeenCalled()

    await userEvent.click(del)
    await waitFor(() => expect(deleteTask).toHaveBeenCalledWith(1))
    await waitFor(() => expect(listTasks.mock.calls.length).toBeGreaterThanOrEqual(2))
  })

  it('すでに削除されたタスクを操作したときは、メッセージを表示して一覧を再取得する', async () => {
    completeTask.mockRejectedValue(
      new Error(
        "Error invoking remote method 'tasks:complete': TaskError: 対象のタスクが見つかりません。一覧を更新しました"
      )
    )
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: '完了にする' }))

    expect(
      await screen.findByText('対象のタスクが見つかりません。一覧を更新しました')
    ).toBeInTheDocument()
    await waitFor(() => expect(listTasks.mock.calls.length).toBeGreaterThanOrEqual(2))
  })

  it('「+ タスクを登録」で登録画面へ、行(タスク名)のクリックで詳細へ遷移を要求する', async () => {
    const onNewTask = vi.fn()
    const onSelectTask = vi.fn()
    renderPage({ onNewTask, onSelectTask })
    await userEvent.click(screen.getByRole('button', { name: '+ タスクを登録' }))
    expect(onNewTask).toHaveBeenCalled()

    await userEvent.click(await screen.findByRole('button', { name: '請求書の送付準備' }))
    expect(onSelectTask).toHaveBeenCalledWith(1)
  })
})
