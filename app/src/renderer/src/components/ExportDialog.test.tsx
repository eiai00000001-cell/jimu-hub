// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExportDialog } from './ExportDialog'

function setupApi(result: {
  success: boolean
  filePath?: string
  error?: string
}): ReturnType<typeof vi.fn> {
  const exportData = vi.fn().mockResolvedValue(result)
  window.jimuhubApi = {
    getStartupStatus: vi.fn(),
    listClients: vi.fn(),
    getClient: vi.fn(),
    createClient: vi.fn(),
    updateClient: vi.fn(),
    deactivateClient: vi.fn(),
    exportData,
    importData: vi.fn()
  } as unknown as Window['jimuhubApi']
  return exportData
}

describe('ExportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('「エクスポート実行」押下で保存先パスを含む完了メッセージを表示する', async () => {
    setupApi({ success: true, filePath: '/Users/example/書類/事務HUB_backup.json' })
    render(<ExportDialog onClose={vi.fn()} />)

    await userEvent.click(screen.getByText('エクスポート実行'))

    expect(await screen.findByText(/事務HUB_backup\.json/)).toBeInTheDocument()
  })

  it('保存失敗時はエラーメッセージを表示する', async () => {
    setupApi({
      success: false,
      error: '保存に失敗しました。保存先の空き容量・書き込み権限をご確認ください'
    })
    render(<ExportDialog onClose={vi.fn()} />)

    await userEvent.click(screen.getByText('エクスポート実行'))

    expect(
      await screen.findByText('保存に失敗しました。保存先の空き容量・書き込み権限をご確認ください')
    ).toBeInTheDocument()
  })

  it('ダイアログがキャンセルされた場合(エラーなし)は何も表示しない', async () => {
    setupApi({ success: false })
    render(<ExportDialog onClose={vi.fn()} />)

    await userEvent.click(screen.getByText('エクスポート実行'))

    await waitFor(() => expect(window.jimuhubApi.exportData).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('閉じるボタンでonCloseを呼び出す', async () => {
    setupApi({ success: true, filePath: '/tmp/export.json' })
    const onClose = vi.fn()
    render(<ExportDialog onClose={onClose} />)

    await userEvent.click(screen.getByLabelText('閉じる'))
    expect(onClose).toHaveBeenCalled()
  })
})
