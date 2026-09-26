// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImportDialog } from './ImportDialog'

function setupApi(result: {
  success: boolean
  importedCount?: number
  error?: string
}): ReturnType<typeof vi.fn> {
  const importData = vi.fn().mockResolvedValue(result)
  window.jimuhubApi = {
    getStartupStatus: vi.fn(),
    listClients: vi.fn(),
    getClient: vi.fn(),
    createClient: vi.fn(),
    updateClient: vi.fn(),
    deactivateClient: vi.fn(),
    exportData: vi.fn(),
    importData
  } as unknown as Window['jimuhubApi']
  return importData
}

describe('ImportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('警告文を表示し、「ファイルを選択して復元」押下でimportDataを呼び出す', async () => {
    const importData = setupApi({ success: true, importedCount: 12 })
    render(<ImportDialog onClose={vi.fn()} onImported={vi.fn()} />)

    expect(
      screen.getByText(/現在のデータがエクスポートファイルの内容で置き換わります/)
    ).toBeInTheDocument()

    await userEvent.click(screen.getByText('ファイルを選択して復元'))
    await waitFor(() => expect(importData).toHaveBeenCalled())
  })

  it('復元成功時は件数を含む完了メッセージを表示し、onImportedを呼び出す', async () => {
    setupApi({ success: true, importedCount: 12 })
    const onImported = vi.fn()
    render(<ImportDialog onClose={vi.fn()} onImported={onImported} />)

    await userEvent.click(screen.getByText('ファイルを選択して復元'))

    expect(await screen.findByText('復元が完了しました(12件)')).toBeInTheDocument()
    expect(onImported).toHaveBeenCalledWith(12)
  })

  it('復元失敗時はエラーメッセージを表示する', async () => {
    setupApi({ success: false, error: '復元に失敗しました。データは復元前の状態に戻しました' })
    render(<ImportDialog onClose={vi.fn()} onImported={vi.fn()} />)

    await userEvent.click(screen.getByText('ファイルを選択して復元'))

    expect(
      await screen.findByText('復元に失敗しました。データは復元前の状態に戻しました')
    ).toBeInTheDocument()
  })

  it('ダイアログがキャンセルされた場合(エラーなし)は警告文以外は表示しない', async () => {
    setupApi({ success: false })
    const { container } = render(<ImportDialog onClose={vi.fn()} onImported={vi.fn()} />)

    await userEvent.click(screen.getByText('ファイルを選択して復元'))

    await waitFor(() => expect(window.jimuhubApi.importData).toHaveBeenCalled())
    expect(container.querySelectorAll('.message')).toHaveLength(1)
  })

  it('閉じるボタンでonCloseを呼び出す', async () => {
    setupApi({ success: true, importedCount: 1 })
    const onClose = vi.fn()
    render(<ImportDialog onClose={onClose} onImported={vi.fn()} />)

    await userEvent.click(screen.getByLabelText('閉じる'))
    expect(onClose).toHaveBeenCalled()
  })
})
