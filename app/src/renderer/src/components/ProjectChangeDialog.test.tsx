// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectChangeDialog } from './ProjectChangeDialog'

describe('ProjectChangeDialog(F-30。詳細設計書3.25章)', () => {
  let listSelectableProjects: ReturnType<typeof vi.fn>
  let changeProjectLink: ReturnType<typeof vi.fn>

  beforeEach(() => {
    listSelectableProjects = vi.fn().mockResolvedValue([
      { id: 1, name: '進行中A', status: 'active' },
      { id: 2, name: '進行中B', status: 'active' }
    ])
    changeProjectLink = vi.fn().mockResolvedValue({ changed: true })
    window.jimuhubApi = {
      listSelectableProjects,
      changeProjectLink
    } as unknown as Window['jimuhubApi']
  })

  const renderDialog = (
    current: { id: number; name: string; status: 'active' | 'completed' } | null
  ) => {
    const handlers = { onClose: vi.fn(), onChanged: vi.fn() }
    render(
      <ProjectChangeDialog
        targetType="invoice"
        targetId={9}
        targetLabel="請求書 2026-012"
        current={current}
        {...handlers}
      />
    )
    return handlers
  }

  it('対象と現在の案件を表示し、「案件なし」と進行中の案件を選べる。現在と同じ間は「変更する」を押せない', async () => {
    renderDialog(null)
    await screen.findByRole('option', { name: '進行中A' })

    expect(screen.getByText('請求書 2026-012')).toBeInTheDocument()
    expect(screen.getByText('案件なし', { selector: 'dd' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '案件なし' })).toBeInTheDocument()
    expect(screen.getByLabelText('変更先の案件')).toHaveValue('')
    expect(screen.getByRole('button', { name: '変更する' })).toBeDisabled()
    expect(listSelectableProjects).toHaveBeenCalledWith(undefined)
  })

  it('現在の案件が完了の場合は、「{案件名}(完了)」として選択肢に含め、初期値にする', async () => {
    listSelectableProjects.mockResolvedValue([
      { id: 1, name: '進行中A', status: 'active' },
      { id: 5, name: '終わった案件', status: 'completed' }
    ])
    renderDialog({ id: 5, name: '終わった案件', status: 'completed' })

    expect(await screen.findByRole('option', { name: '終わった案件(完了)' })).toBeInTheDocument()
    expect(screen.getByLabelText('変更先の案件')).toHaveValue('5')
    expect(listSelectableProjects).toHaveBeenCalledWith(5)
  })

  it('別の案件を選んで「変更する」で、紐づけを変更して呼び出し元へ知らせる', async () => {
    const { onChanged } = renderDialog({ id: 1, name: '進行中A', status: 'active' })
    await screen.findByRole('option', { name: '進行中B' })

    await userEvent.selectOptions(screen.getByLabelText('変更先の案件'), '2')
    await userEvent.click(screen.getByRole('button', { name: '変更する' }))

    await waitFor(() =>
      expect(changeProjectLink).toHaveBeenCalledWith({
        targetType: 'invoice',
        targetId: 9,
        projectId: 2
      })
    )
    expect(onChanged).toHaveBeenCalled()
  })

  it('「案件なし」を選ぶと、紐づけを解除する(projectIdはnull)', async () => {
    renderDialog({ id: 1, name: '進行中A', status: 'active' })
    await screen.findByRole('option', { name: '進行中B' })
    await userEvent.selectOptions(screen.getByLabelText('変更先の案件'), '')
    await userEvent.click(screen.getByRole('button', { name: '変更する' }))
    await waitFor(() =>
      expect(changeProjectLink).toHaveBeenCalledWith({
        targetType: 'invoice',
        targetId: 9,
        projectId: null
      })
    )
  })

  it('変更に失敗した場合は、エラーを表示し、ダイアログを閉じない', async () => {
    changeProjectLink.mockRejectedValue(
      new Error('ProjectError: 完了の案件には、新しく紐づけられません')
    )
    const { onChanged } = renderDialog(null)
    await screen.findByRole('option', { name: '進行中A' })
    await userEvent.selectOptions(screen.getByLabelText('変更先の案件'), '1')
    await userEvent.click(screen.getByRole('button', { name: '変更する' }))

    expect(await screen.findByText('完了の案件には、新しく紐づけられません')).toBeInTheDocument()
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('「キャンセル」でダイアログを閉じる', async () => {
    const { onClose } = renderDialog(null)
    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(onClose).toHaveBeenCalled()
  })
})
