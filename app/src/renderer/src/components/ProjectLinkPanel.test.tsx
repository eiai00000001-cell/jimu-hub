// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectLinkPanel } from './ProjectLinkPanel'
import type { ProjectLinkHistoryEntry } from '@shared/types/project'

const entry: ProjectLinkHistoryEntry = {
  id: 1,
  operatedAt: '2026-10-03T00:30:00.000Z',
  targetType: 'invoice',
  targetId: 9,
  targetLabel: '2026-012',
  fromProjectId: null,
  fromProjectName: null,
  toProjectId: 7,
  toProjectName: 'アルファ保守',
  kind: 'assign'
}

describe('ProjectLinkPanel(詳細設計書3.26章)', () => {
  let listProjectLinkHistory: ReturnType<typeof vi.fn>

  beforeEach(() => {
    listProjectLinkHistory = vi.fn().mockResolvedValue([])
    window.jimuhubApi = {
      listProjectLinkHistory,
      listSelectableProjects: vi.fn().mockResolvedValue([])
    } as unknown as Window['jimuhubApi']
  })

  const renderPanel = (overrides: Partial<Parameters<typeof ProjectLinkPanel>[0]> = {}) => {
    const props = {
      targetType: 'invoice' as const,
      targetId: 9,
      targetLabel: '請求書 2026-012',
      project: { id: 7, name: 'アルファ保守', status: 'active' as const },
      canChange: true,
      onOpenProject: vi.fn(),
      onChanged: vi.fn(),
      ...overrides
    }
    render(<ProjectLinkPanel {...props} />)
    return props
  }

  it('紐づく案件を案件詳細へのリンクとして表示し、リンクで遷移を要求する', async () => {
    const props = renderPanel()
    await userEvent.click(screen.getByText('アルファ保守'))
    expect(props.onOpenProject).toHaveBeenCalledWith(7)
  })

  it('案件がなければ「案件なし」。完了の案件には「(完了)」を添える', () => {
    renderPanel({ project: null })
    expect(screen.getByText(/案件なし/)).toBeInTheDocument()
  })

  it('完了の案件には「(完了)」を添える', () => {
    renderPanel({ project: { id: 7, name: '終わった案件', status: 'completed' } })
    expect(screen.getByText(/\(完了\)/)).toBeInTheDocument()
  })

  it('付け替え履歴があれば表示し、なければ欄を表示しない', async () => {
    renderPanel()
    expect(screen.queryByText('操作の種類')).not.toBeInTheDocument()
  })

  it('履歴を表示する(付け替え前後の案件・操作の種類)', async () => {
    listProjectLinkHistory.mockResolvedValue([entry])
    renderPanel()
    expect(await screen.findByText('操作の種類')).toBeInTheDocument()
    expect(screen.getByText('紐づけ')).toBeInTheDocument()
    expect(listProjectLinkHistory).toHaveBeenCalledWith('invoice', 9)
  })

  it('「案件を変更」でダイアログを開き、変更後は呼び出し元へ知らせてダイアログを閉じる', async () => {
    window.jimuhubApi.listSelectableProjects = vi
      .fn()
      .mockResolvedValue([{ id: 8, name: '別の案件', status: 'active' }])
    window.jimuhubApi.changeProjectLink = vi.fn().mockResolvedValue({ changed: true })
    const props = renderPanel()

    await userEvent.click(screen.getByRole('button', { name: '案件を変更' }))
    await screen.findByRole('option', { name: '別の案件' })
    await userEvent.selectOptions(screen.getByLabelText('変更先の案件'), '8')
    await userEvent.click(screen.getByRole('button', { name: '変更する' }))

    await waitFor(() => expect(props.onChanged).toHaveBeenCalled())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('canChangeがfalse(削除済みの記録)の場合は、「案件を変更」を表示しない', () => {
    renderPanel({ canChange: false })
    expect(screen.queryByRole('button', { name: '案件を変更' })).not.toBeInTheDocument()
  })
})
