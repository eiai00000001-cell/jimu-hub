// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectSelectField } from './ProjectSelectField'

describe('ProjectSelectField(詳細設計書3.26章)', () => {
  it('「案件なし」と進行中の案件を選べる。選択すると、案件IDまたはnullを返す', async () => {
    window.jimuhubApi = {
      listSelectableProjects: vi.fn().mockResolvedValue([
        { id: 1, name: '進行中A', status: 'active' },
        { id: 2, name: '進行中B', status: 'active' }
      ])
    } as unknown as Window['jimuhubApi']
    const onChange = vi.fn()
    render(<ProjectSelectField id="p" value={null} onChange={onChange} />)
    await screen.findByRole('option', { name: '進行中A' })

    expect(screen.getByLabelText('案件')).toHaveValue('')
    await userEvent.selectOptions(screen.getByLabelText('案件'), '2')
    expect(onChange).toHaveBeenLastCalledWith(2)
    await userEvent.selectOptions(screen.getByLabelText('案件'), '')
    expect(onChange).toHaveBeenLastCalledWith(null)
    expect(window.jimuhubApi.listSelectableProjects).toHaveBeenCalledWith(undefined)
  })

  it('現在の案件が完了の場合は、「{案件名}(完了)」として選択肢に含める', async () => {
    const listSelectableProjects = vi
      .fn()
      .mockResolvedValue([{ id: 5, name: '終わった案件', status: 'completed' }])
    window.jimuhubApi = { listSelectableProjects } as unknown as Window['jimuhubApi']
    render(
      <ProjectSelectField
        id="p"
        value={5}
        current={{ id: 5, name: '終わった案件', status: 'completed' }}
        onChange={vi.fn()}
      />
    )
    expect(await screen.findByRole('option', { name: '終わった案件(完了)' })).toBeInTheDocument()
    expect(screen.getByLabelText('案件')).toHaveValue('5')
    expect(listSelectableProjects).toHaveBeenCalledWith(5)
  })
})
