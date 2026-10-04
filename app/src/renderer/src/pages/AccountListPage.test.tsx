// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AccountListPage } from './AccountListPage'
import type { AccountView } from '@shared/types/account'

const base = { isDefault: false, defaultKey: null, sortOrder: 10, deletable: false } as const
const sales: AccountView = {
  ...base,
  id: 1,
  name: '売上高',
  kind: 'income',
  status: 'active',
  isDefault: true,
  defaultKey: 'sales_revenue'
}
const comms: AccountView = {
  ...base,
  id: 2,
  name: '通信費',
  kind: 'expense',
  status: 'active',
  isDefault: true
}
const stopped: AccountView = {
  ...base,
  id: 3,
  name: '広告宣伝費',
  kind: 'expense',
  status: 'inactive',
  isDefault: true
}
const custom: AccountView = {
  ...base,
  id: 4,
  name: '研修費',
  kind: 'expense',
  status: 'active',
  deletable: true
}

function setupApi(
  overrides: Partial<Window['jimuhubApi']> = {}
): Record<string, ReturnType<typeof vi.fn>> {
  const api = {
    listAccounts: vi.fn().mockResolvedValue([comms, stopped, custom, sales]),
    createAccount: vi.fn().mockResolvedValue({ id: 9 }),
    renameAccount: vi.fn().mockResolvedValue({ success: true }),
    deactivateAccount: vi.fn().mockResolvedValue({ success: true }),
    reactivateAccount: vi.fn().mockResolvedValue({ success: true }),
    deleteAccount: vi.fn().mockResolvedValue({ success: true }),
    ...overrides
  }
  window.jimuhubApi = api as unknown as Window['jimuhubApi']
  return api as unknown as Record<string, ReturnType<typeof vi.fn>>
}

describe('AccountListPage(F-17)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('利用停止を含めて一覧し、売上高には「システム既定」を表示して利用停止・削除を出さない', async () => {
    setupApi()
    render(<AccountListPage onBackToList={vi.fn()} />)
    expect(await screen.findByText('システム既定')).toBeInTheDocument()
    expect(window.jimuhubApi.listAccounts).toHaveBeenCalledWith({ includeInactive: true })
    // 利用停止ボタン: 通信費・研修費のみ(売上高・利用停止中の広告宣伝費には出ない)
    expect(screen.getAllByText('利用停止', { selector: 'button' })).toHaveLength(2)
    expect(screen.getAllByText('利用を再開')).toHaveLength(1)
    // 削除ボタン: 未使用の追加科目のみ
    expect(screen.getAllByText('削除')).toHaveLength(1)
  })

  it('名称・区分を入力して追加すると作成し、一覧を再取得する', async () => {
    const api = setupApi()
    render(<AccountListPage onBackToList={vi.fn()} />)
    await screen.findByText('通信費')
    await userEvent.type(screen.getByLabelText(/名称/), '会議費')
    await userEvent.selectOptions(screen.getByLabelText(/区分/), 'income')
    await userEvent.click(screen.getByText('追加'))
    await waitFor(() =>
      expect(api.createAccount).toHaveBeenCalledWith({ name: '会議費', kind: 'income' })
    )
    await waitFor(() => expect(api.listAccounts).toHaveBeenCalledTimes(2))
  })

  it('追加時の入力エラー(重複等)は入力欄の下に表示する', async () => {
    setupApi({
      createAccount: vi.fn().mockRejectedValue(new Error('同じ区分に同じ名称の科目があります'))
    })
    render(<AccountListPage onBackToList={vi.fn()} />)
    await screen.findByText('通信費')
    await userEvent.type(screen.getByLabelText(/名称/), '通信費')
    await userEvent.click(screen.getByText('追加'))
    expect(await screen.findByText('同じ区分に同じ名称の科目があります')).toBeInTheDocument()
  })

  it('「名称を変更」→入力→確定でrenameAccountを呼ぶ。キャンセルで元に戻る', async () => {
    const api = setupApi()
    render(<AccountListPage onBackToList={vi.fn()} />)
    await screen.findByText('通信費')
    await userEvent.click(screen.getAllByText('名称を変更')[0]!)
    const input = screen.getByLabelText('通信費の新しい名称')
    await userEvent.clear(input)
    await userEvent.type(input, '通信・インターネット費')
    await userEvent.click(screen.getByText('確定'))
    await waitFor(() => expect(api.renameAccount).toHaveBeenCalledWith(2, '通信・インターネット費'))

    await userEvent.click(screen.getAllByText('名称を変更')[0]!)
    await userEvent.click(screen.getByText('キャンセル'))
    expect(screen.queryByLabelText('通信費の新しい名称')).not.toBeInTheDocument()
  })

  it('利用停止は確認後に実行し、キャンセルでは実行しない', async () => {
    const api = setupApi()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    render(<AccountListPage onBackToList={vi.fn()} />)
    await screen.findByText('通信費')
    const stop = screen.getAllByText('利用停止', { selector: 'button' })[0]!
    await userEvent.click(stop)
    expect(api.deactivateAccount).not.toHaveBeenCalled()
    await userEvent.click(stop)
    await waitFor(() => expect(api.deactivateAccount).toHaveBeenCalledWith(2))
    expect(confirm.mock.calls[0]![0]).toContain('「通信費」を利用停止にします')
    confirm.mockRestore()
  })

  it('利用再開は確認なしで実行する。削除は確認後に実行する', async () => {
    const api = setupApi()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<AccountListPage onBackToList={vi.fn()} />)
    await screen.findByText('通信費')
    await userEvent.click(screen.getByText('利用を再開'))
    await waitFor(() => expect(api.reactivateAccount).toHaveBeenCalledWith(3))
    expect(confirm).not.toHaveBeenCalled()
    await userEvent.click(screen.getByText('削除'))
    await waitFor(() => expect(api.deleteAccount).toHaveBeenCalledWith(4))
    confirm.mockRestore()
  })

  it('業務エラー(利用済みの科目の削除等)は画面上部に表示する', async () => {
    setupApi({
      deleteAccount: vi
        .fn()
        .mockRejectedValue(new Error('利用済みの科目は削除できません。利用停止にしてください'))
    })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<AccountListPage onBackToList={vi.fn()} />)
    await userEvent.click(await screen.findByText('削除'))
    expect(
      await screen.findByText('利用済みの科目は削除できません。利用停止にしてください')
    ).toBeInTheDocument()
    confirm.mockRestore()
  })

  it('「一覧へ戻る」でonBackToListを呼ぶ', async () => {
    setupApi()
    const onBackToList = vi.fn()
    render(<AccountListPage onBackToList={onBackToList} />)
    await userEvent.click(await screen.findByText('← 一覧へ戻る'))
    expect(onBackToList).toHaveBeenCalled()
  })
})
