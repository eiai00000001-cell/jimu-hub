// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StartupErrorPage } from './StartupErrorPage'

function setup(importResult: unknown) {
  const importData = vi.fn().mockResolvedValue(importResult)
  const relaunchApp = vi.fn().mockResolvedValue(undefined)
  window.jimuhubApi = { importData, relaunchApp } as unknown as Window['jimuhubApi']
  return { importData, relaunchApp }
}

describe('StartupErrorPage(F-09)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('エラーメッセージと復元ボタンを表示する', () => {
    setup({ success: true })
    render(<StartupErrorPage message="データを読み込めませんでした" />)
    expect(screen.getByText('データを読み込めませんでした')).toBeInTheDocument()
    expect(screen.getByText('アプリを起動できませんでした')).toBeInTheDocument()
    expect(screen.getByText('エクスポートファイルから復元する')).toBeInTheDocument()
  })

  it('復元ボタンは警告を表示し、キャンセルでは復元しない', async () => {
    const { importData } = setup({ success: true })
    render(<StartupErrorPage message="x" />)
    await userEvent.click(screen.getByText('エクスポートファイルから復元する'))
    expect(screen.getByText(/置き換わります/)).toBeInTheDocument()
    expect(importData).not.toHaveBeenCalled()
    await userEvent.click(screen.getByText('キャンセル'))
    expect(screen.getByText('エクスポートファイルから復元する')).toBeInTheDocument()
  })

  it('「続行」で復元し、成功すると完了メッセージと再起動ボタンを表示する', async () => {
    const { importData, relaunchApp } = setup({ success: true, importedCount: 3 })
    render(<StartupErrorPage message="x" />)
    await userEvent.click(screen.getByText('エクスポートファイルから復元する'))
    await userEvent.click(screen.getByText('続行'))

    await waitFor(() => expect(importData).toHaveBeenCalled())
    expect(
      await screen.findByText('復元が完了しました。アプリを再起動してください。')
    ).toBeInTheDocument()
    await userEvent.click(screen.getByText('アプリを再起動'))
    expect(relaunchApp).toHaveBeenCalled()
  })

  it('復元に失敗した場合はエラーを表示し、再度ファイルを選び直せる', async () => {
    const { importData } = setup({
      success: false,
      error: '選択されたファイルを読み込めませんでした。正しいエクスポートファイルかご確認ください'
    })
    render(<StartupErrorPage message="x" />)
    await userEvent.click(screen.getByText('エクスポートファイルから復元する'))
    await userEvent.click(screen.getByText('続行'))

    expect(await screen.findByText(/読み込めませんでした。正しい/)).toBeInTheDocument()
    await userEvent.click(screen.getByText('エクスポートファイルから復元する'))
    await userEvent.click(screen.getByText('続行'))
    await waitFor(() => expect(importData).toHaveBeenCalledTimes(2))
  })

  it('ファイル選択ダイアログをキャンセルした場合は何も表示せず警告確認の状態に戻る', async () => {
    setup({ success: false })
    render(<StartupErrorPage message="x" />)
    await userEvent.click(screen.getByText('エクスポートファイルから復元する'))
    await userEvent.click(screen.getByText('続行'))
    expect(await screen.findByText('エクスポートファイルから復元する')).toBeInTheDocument()
    expect(screen.queryByText(/復元が完了/)).not.toBeInTheDocument()
  })
})
