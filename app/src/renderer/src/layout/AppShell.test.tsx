// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppShell } from './AppShell'
import { NavigationContext } from './NavigationContext'

function renderShell(props: Partial<Parameters<typeof AppShell>[0]> = {}) {
  const actions = { goHome: vi.fn(), goClients: vi.fn(), goDocuments: vi.fn() }
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
    expect(actions.goHome).toHaveBeenCalledTimes(1)
    expect(actions.goClients).toHaveBeenCalledTimes(1)
    expect(actions.goDocuments).toHaveBeenCalledTimes(1)
  })

  it('「準備中」メニューを押すと案内を表示する', async () => {
    renderShell()
    await userEvent.click(screen.getByText('案件管理'))
    expect(screen.getByText(/「案件管理」は以降のイテレーションで実装予定です/)).toBeInTheDocument()
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
