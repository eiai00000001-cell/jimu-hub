// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TaskDetailPage } from './TaskDetailPage'
import type { TaskDetail } from '@shared/types/task'

const detail = (overrides: Partial<TaskDetail> = {}): TaskDetail => ({
  id: 3,
  name: '請求書の送付準備',
  memo: '先方の担当者へ、PDFをメールで送る。',
  dueDate: '2026-10-09',
  projectId: 7,
  projectName: 'サンプル商事 Webサイト制作',
  projectStatus: 'active',
  status: 'open',
  completedAt: null,
  overdue: true,
  createdAt: '2026-10-01T01:15:00.000Z',
  updatedAt: '2026-10-05T07:40:00.000Z',
  ...overrides
})

describe('TaskDetailPage(F-34〜F-36。詳細設計書3.29章。モックアップ F-34_task-detail)', () => {
  let getTask: ReturnType<typeof vi.fn>

  beforeEach(() => {
    getTask = vi.fn().mockResolvedValue(detail())
    window.jimuhubApi = {
      getTask,
      completeTask: vi.fn().mockResolvedValue({ changed: true }),
      reopenTask: vi.fn().mockResolvedValue({ changed: true }),
      deleteTask: vi.fn().mockResolvedValue({ success: true })
    } as unknown as Window['jimuhubApi']
  })
  afterEach(() => vi.restoreAllMocks())

  const handlers = (): Parameters<typeof TaskDetailPage>[0] => ({
    taskId: 3,
    onBackToList: vi.fn(),
    onEdit: vi.fn(),
    onDeleted: vi.fn(),
    onOpenProject: vi.fn()
  })

  it('基本情報を表示する。期限超過は赤字・「期限超過」バッジで示す。見出し・タイトルバーは「タスク詳細」', async () => {
    render(<TaskDetailPage {...handlers()} />)

    expect(await screen.findByText('請求書の送付準備')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'タスク詳細' })).toBeInTheDocument()
    expect(document.querySelector('.titlebar-title')?.textContent).toBe('事務HUB - タスク詳細')
    expect(screen.getByText('未完了', { selector: '.badge' })).toBeInTheDocument()
    expect(screen.getByText('2026-10-09')).toHaveClass('due-overdue')
    expect(screen.getByText('期限超過')).toHaveClass('badge-overdue')
    expect(screen.getByRole('button', { name: 'サンプル商事 Webサイト制作' })).toBeInTheDocument()
    expect(screen.getByText('先方の担当者へ、PDFをメールで送る。')).toBeInTheDocument()
    expect(screen.getByText('登録日時')).toBeInTheDocument()
    expect(screen.getByText('更新日時')).toBeInTheDocument()
    expect(screen.queryByText('完了日時')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '完了にする' })).toBeInTheDocument()
  })

  it('完了のタスク: 「完了」バッジと完了日時を表示し、期限が過ぎていても強調しない。ボタンは「未完了に戻す」', async () => {
    getTask.mockResolvedValue(
      detail({
        status: 'done',
        completedAt: '2026-10-07T05:20:00.000Z',
        overdue: false,
        dueDate: '2026-10-08'
      })
    )
    render(<TaskDetailPage {...handlers()} />)

    expect(await screen.findByText('完了', { selector: '.badge' })).toBeInTheDocument()
    expect(screen.getByText('完了日時')).toBeInTheDocument()
    expect(screen.getByText('2026-10-08')).not.toHaveClass('due-overdue')
    expect(screen.queryByText('期限超過')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '未完了に戻す' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '完了にする' })).not.toBeInTheDocument()
  })

  it('期限なし・案件なし・メモなし: 「期限なし」「案件なし」(リンクにしない)。完了の案件は「(完了)」を付記', async () => {
    getTask.mockResolvedValue(
      detail({
        dueDate: null,
        overdue: false,
        projectId: null,
        projectName: null,
        projectStatus: null,
        memo: null
      })
    )
    const { unmount } = render(<TaskDetailPage {...handlers()} />)
    expect(await screen.findByText('期限なし')).toBeInTheDocument()
    expect(screen.getByText('案件なし')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '案件なし' })).not.toBeInTheDocument()
    unmount()

    getTask.mockResolvedValue(
      detail({ projectId: 9, projectName: 'サンプル商事 ロゴ制作', projectStatus: 'completed' })
    )
    render(<TaskDetailPage {...handlers()} />)
    expect(
      await screen.findByRole('button', { name: 'サンプル商事 ロゴ制作(完了)' })
    ).toBeInTheDocument()
  })

  it('案件名のクリックで案件詳細へ、「編集」「一覧へ戻る」で遷移を要求する', async () => {
    const h = handlers()
    render(<TaskDetailPage {...h} />)
    await userEvent.click(await screen.findByRole('button', { name: 'サンプル商事 Webサイト制作' }))
    expect(h.onOpenProject).toHaveBeenCalledWith(7)
    await userEvent.click(screen.getByRole('button', { name: '編集' }))
    expect(h.onEdit).toHaveBeenCalledWith(3)
    await userEvent.click(screen.getByRole('button', { name: /一覧へ戻る/ }))
    expect(h.onBackToList).toHaveBeenCalled()
  })

  it('「完了にする」は確認なしで切り替え、詳細を再取得する。「未完了に戻す」も同様', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    render(<TaskDetailPage {...handlers()} />)
    await userEvent.click(await screen.findByRole('button', { name: '完了にする' }))
    await waitFor(() => expect(window.jimuhubApi.completeTask).toHaveBeenCalledWith(3))
    expect(confirm).not.toHaveBeenCalled()

    // 切り替え後に詳細を再取得する
    await waitFor(() => expect(getTask.mock.calls.length).toBeGreaterThanOrEqual(2))
  })

  it('完了のタスクでは「未完了に戻す」で未完了に戻し、確認は出さない', async () => {
    getTask.mockResolvedValue(
      detail({ status: 'done', completedAt: '2026-10-07T05:20:00.000Z', overdue: false })
    )
    const confirm = vi.spyOn(window, 'confirm')
    render(<TaskDetailPage {...handlers()} />)
    await userEvent.click(await screen.findByRole('button', { name: '未完了に戻す' }))
    await waitFor(() => expect(window.jimuhubApi.reopenTask).toHaveBeenCalledWith(3))
    expect(confirm).not.toHaveBeenCalled()
  })

  it('「削除」は確認ダイアログ(いいえで中止、はいで削除して一覧へ)', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    const h = handlers()
    render(<TaskDetailPage {...h} />)
    const del = await screen.findByRole('button', { name: '削除' })

    await userEvent.click(del)
    expect(confirm).toHaveBeenCalledWith(
      'このタスクを削除します。削除すると元に戻せません。よろしいですか'
    )
    expect(window.jimuhubApi.deleteTask).not.toHaveBeenCalled()

    await userEvent.click(del)
    await waitFor(() => expect(window.jimuhubApi.deleteTask).toHaveBeenCalledWith(3))
    expect(h.onDeleted).toHaveBeenCalled()
  })

  it('対象が存在しない場合は、メッセージと一覧へ戻る導線を表示する', async () => {
    getTask.mockRejectedValue(
      new Error(
        "Error invoking remote method 'tasks:x': TaskError: 対象のタスクが見つかりません。一覧を更新しました"
      )
    )
    const h = handlers()
    render(<TaskDetailPage {...h} />)
    expect(
      await screen.findByText('対象のタスクが見つかりません。一覧を更新しました')
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /一覧へ戻る/ }))
    expect(h.onBackToList).toHaveBeenCalled()
  })
})
