// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppShell } from './AppShell'
import { NavigationContext } from './NavigationContext'

function renderShell(props: Partial<Parameters<typeof AppShell>[0]> = {}) {
  const actions = {
    goHome: vi.fn(),
    goClients: vi.fn(),
    goProjects: vi.fn(),
    goDocuments: vi.fn(),
    goCash: vi.fn(),
    goTasks: vi.fn()
  }
  render(
    <NavigationContext.Provider value={actions}>
      <AppShell screenName="テスト" activeMenu="documents" pageTitle="テスト" {...props}>
        <div>本文</div>
      </AppShell>
    </NavigationContext.Provider>
  )
  return actions
}

describe('AppShell(サイドバーの既定動作・O2)', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('遷移先を指定しない画面でも、サイドバーはNavigationContextの遷移を行う', async () => {
    const actions = renderShell()
    await userEvent.click(screen.getByText('ホーム'))
    await userEvent.click(screen.getByText('取引先管理'))
    await userEvent.click(screen.getByText('見積書・請求書'))
    await userEvent.click(screen.getByText('入出金・経費'))
    await userEvent.click(screen.getByText('案件管理'))
    await userEvent.click(screen.getByText('タスク・期限'))
    expect(actions.goTasks).toHaveBeenCalledTimes(1)
    expect(actions.goProjects).toHaveBeenCalledTimes(1)
    expect(actions.goCash).toHaveBeenCalledTimes(1)
    expect(actions.goHome).toHaveBeenCalledTimes(1)
    expect(actions.goClients).toHaveBeenCalledTimes(1)
    expect(actions.goDocuments).toHaveBeenCalledTimes(1)
  })

  it('「タスク・期限」は有効なメニューで、「準備中」の表示や案内は出ない(v4.1)', async () => {
    renderShell()
    expect(screen.queryByText('準備中')).not.toBeInTheDocument()
    await userEvent.click(screen.getByText('タスク・期限'))
    expect(screen.queryByText(/実装予定です/)).not.toBeInTheDocument()
  })

  it('タスク・期限の画面では、サイドバーの「タスク・期限」が選択状態になる', () => {
    renderShell({ activeMenu: 'tasks' })
    expect(screen.getByText('タスク・期限').closest('button')).toHaveClass('active')
  })

  it('confirmLeaveがfalseを返した場合は遷移しない', async () => {
    const confirmLeave = vi.fn().mockReturnValue(false)
    const actions = renderShell({ confirmLeave })
    await userEvent.click(screen.getByText('ホーム'))
    expect(confirmLeave).toHaveBeenCalled()
    expect(actions.goHome).not.toHaveBeenCalled()
  })

  it('confirmLeaveがtrueを返した場合は遷移する', async () => {
    const actions = renderShell({ confirmLeave: () => true })
    await userEvent.click(screen.getByText('ホーム'))
    expect(actions.goHome).toHaveBeenCalledTimes(1)
  })
})
