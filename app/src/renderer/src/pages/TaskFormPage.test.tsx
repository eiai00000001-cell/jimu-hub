// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TaskFormPage } from './TaskFormPage'
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

describe('TaskFormPage(F-34。詳細設計書3.28章。モックアップ F-34_task-form)', () => {
  let createTask: ReturnType<typeof vi.fn>
  let updateTask: ReturnType<typeof vi.fn>
  let getTask: ReturnType<typeof vi.fn>

  beforeEach(() => {
    createTask = vi.fn().mockResolvedValue({ id: 11 })
    updateTask = vi.fn().mockResolvedValue({ success: true })
    getTask = vi.fn().mockResolvedValue(detail())
    window.jimuhubApi = {
      createTask,
      updateTask,
      getTask,
      listSelectableProjects: vi.fn().mockResolvedValue([
        { id: 7, name: 'サンプル商事 Webサイト制作', status: 'active' },
        { id: 8, name: 'アルファ商事 保守契約', status: 'active' }
      ])
    } as unknown as Window['jimuhubApi']
  })
  afterEach(() => vi.restoreAllMocks())

  it('登録画面: 見出し・タイトルバー・入力欄・ヒント・ボタンがモックアップどおり', async () => {
    render(<TaskFormPage mode="new" onSaved={vi.fn()} onCancel={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'タスクを登録' })).toBeInTheDocument()
    expect(document.querySelector('.titlebar-title')?.textContent).toBe('事務HUB - タスクを登録')
    expect(screen.getByPlaceholderText('例: 請求書の送付準備')).toBeInTheDocument()
    expect(screen.getByText('必須')).toBeInTheDocument()
    expect(screen.getByText('100文字以内。同じ名前のタスクも登録できます。')).toBeInTheDocument()
    expect(screen.getByText('1000文字以内')).toBeInTheDocument()
    expect(
      screen.getByText('任意。入力しない場合は、期限なしのタスクになります。')
    ).toBeInTheDocument()
    expect(await screen.findByText('進行中の案件から選べます。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '登録' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeInTheDocument()
  })

  it('案件の選択肢は「案件なし」(初期値)と進行中の案件(listSelectableProjects)', async () => {
    render(<TaskFormPage mode="new" onSaved={vi.fn()} onCancel={vi.fn()} />)
    await screen.findByRole('option', { name: 'アルファ商事 保守契約' })
    expect(screen.getByLabelText('案件')).toHaveValue('')
    expect(window.jimuhubApi.listSelectableProjects).toHaveBeenCalled()
  })

  it('タスク名が未入力のまま「登録」を押すと、項目の下にエラーを表示し、登録しない', async () => {
    render(<TaskFormPage mode="new" onSaved={vi.fn()} onCancel={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: '登録' }))

    expect(await screen.findByText('タスク名を入力してください')).toBeInTheDocument()
    expect(createTask).not.toHaveBeenCalled()
  })

  it('長すぎる名前・メモ・不正な期限日もエラーにする', async () => {
    render(<TaskFormPage mode="new" onSaved={vi.fn()} onCancel={vi.fn()} />)
    await userEvent.click(screen.getByLabelText('タスク名'))
    await userEvent.paste('あ'.repeat(101))
    await userEvent.click(screen.getByLabelText('メモ'))
    await userEvent.paste('あ'.repeat(1001))
    await userEvent.click(screen.getByRole('button', { name: '登録' }))

    expect(await screen.findByText('タスク名は100文字以内で入力してください')).toBeInTheDocument()
    expect(screen.getByText('メモは1000文字以内で入力してください')).toBeInTheDocument()
    expect(createTask).not.toHaveBeenCalled()
  })

  it('登録: 入力内容をそのまま渡し(期限日・案件は任意)、成功したら詳細へ遷移を要求する', async () => {
    const onSaved = vi.fn()
    render(<TaskFormPage mode="new" onSaved={onSaved} onCancel={vi.fn()} />)
    await screen.findByRole('option', { name: 'アルファ商事 保守契約' })

    await userEvent.type(screen.getByLabelText('タスク名'), '  請求書の送付準備  ')
    await userEvent.type(screen.getByLabelText('メモ'), 'メモ')
    await userEvent.type(screen.getByLabelText('期限日'), '2026-10-31')
    await userEvent.selectOptions(screen.getByLabelText('案件'), 'アルファ商事 保守契約')
    await userEvent.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() =>
      expect(createTask).toHaveBeenCalledWith({
        name: '請求書の送付準備',
        memo: 'メモ',
        dueDate: '2026-10-31',
        projectId: 8
      })
    )
    expect(onSaved).toHaveBeenCalledWith(11)
  })

  it('任意項目を空のまま登録すると、メモ・期限日・案件はnull(未設定)で渡す', async () => {
    render(<TaskFormPage mode="new" onSaved={vi.fn()} onCancel={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('タスク名'), '最小の登録')
    await userEvent.click(screen.getByRole('button', { name: '登録' }))
    await waitFor(() =>
      expect(createTask).toHaveBeenCalledWith({
        name: '最小の登録',
        memo: null,
        dueDate: null,
        projectId: null
      })
    )
  })

  it('登録に失敗した場合は、メッセージを表示し、画面に留まる', async () => {
    createTask.mockRejectedValue(
      new Error("Error invoking remote method 'tasks:x': TaskError: 指定された案件が見つかりません")
    )
    const onSaved = vi.fn()
    render(<TaskFormPage mode="new" onSaved={onSaved} onCancel={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('タスク名'), 'x')
    await userEvent.click(screen.getByRole('button', { name: '登録' }))

    expect(await screen.findByText('指定された案件が見つかりません')).toBeInTheDocument()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('編集画面: 見出し「タスクを編集」・ボタン「保存」。現在の内容を表示し、保存でupdateTaskを呼ぶ', async () => {
    const onSaved = vi.fn()
    render(<TaskFormPage mode="edit" taskId={3} onSaved={onSaved} onCancel={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'タスクを編集' })).toBeInTheDocument()
    expect(document.querySelector('.titlebar-title')?.textContent).toBe('事務HUB - タスクを編集')
    await waitFor(() => expect(screen.getByLabelText('タスク名')).toHaveValue('請求書の送付準備'))
    expect(screen.getByLabelText('メモ')).toHaveValue('先方の担当者へ、PDFをメールで送る。')
    expect(screen.getByLabelText('期限日')).toHaveValue('2026-10-09')
    await waitFor(() => expect(screen.getByLabelText('案件')).toHaveValue('7'))

    await userEvent.clear(screen.getByLabelText('タスク名'))
    await userEvent.type(screen.getByLabelText('タスク名'), '更新後')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(updateTask).toHaveBeenCalledWith(3, {
        name: '更新後',
        memo: '先方の担当者へ、PDFをメールで送る。',
        dueDate: '2026-10-09',
        projectId: 7
      })
    )
    expect(onSaved).toHaveBeenCalledWith(3)
  })

  it('編集: 現在の案件が完了の場合は「(完了)」を付記して選択肢に含める(現在の案件のIDで取得する)', async () => {
    getTask.mockResolvedValue(
      detail({ projectId: 9, projectName: 'サンプル商事 ロゴ制作', projectStatus: 'completed' })
    )
    window.jimuhubApi.listSelectableProjects = vi.fn().mockResolvedValue([
      { id: 7, name: 'サンプル商事 Webサイト制作', status: 'active' },
      { id: 9, name: 'サンプル商事 ロゴ制作', status: 'completed' }
    ])
    render(<TaskFormPage mode="edit" taskId={3} onSaved={vi.fn()} onCancel={vi.fn()} />)

    expect(
      await screen.findByRole('option', { name: 'サンプル商事 ロゴ制作(完了)' })
    ).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('案件')).toHaveValue('9'))
    expect(window.jimuhubApi.listSelectableProjects).toHaveBeenCalledWith(9)
  })

  it('編集: 対象が削除済みの場合は、メッセージと一覧へ戻る導線を表示する', async () => {
    getTask.mockRejectedValue(
      new Error(
        "Error invoking remote method 'tasks:x': TaskError: 対象のタスクが見つかりません。一覧を更新しました"
      )
    )
    const onCancel = vi.fn()
    render(<TaskFormPage mode="edit" taskId={3} onSaved={vi.fn()} onCancel={onCancel} />)

    expect(
      await screen.findByText('対象のタスクが見つかりません。一覧を更新しました')
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /一覧へ戻る/ }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('「キャンセル」で破棄して戻る', async () => {
    const onCancel = vi.fn()
    render(<TaskFormPage mode="new" onSaved={vi.fn()} onCancel={onCancel} />)
    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(onCancel).toHaveBeenCalled()
  })
})
