// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
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

  it('[★E12]80%超の警告が返った場合は確認し、続行するとconfirmLarge付きで再実行する。中止すると書き出さない', async () => {
    const exportData = vi
      .fn()
      .mockResolvedValueOnce({ success: false, warnLargeBackup: true })
      .mockResolvedValueOnce({ success: false, warnLargeBackup: true })
      .mockResolvedValueOnce({ success: true, filePath: '/tmp/x.zip' })
    window.jimuhubApi = { exportData } as unknown as Window['jimuhubApi']
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    render(<ExportDialog onClose={vi.fn()} />)
    await userEvent.click(screen.getByText('エクスポート実行'))
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    expect(confirm).toHaveBeenCalledWith(
      '領収書の容量が大きいため、このファイルは復元できない可能性があります。続行しますか'
    )
    expect(exportData).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByText('エクスポート実行'))
    await waitFor(() => expect(exportData).toHaveBeenLastCalledWith({ confirmLarge: true }))
    expect(await screen.findByText(/x\.zip/)).toBeInTheDocument()
    confirm.mockRestore()
  })

  it('実行中は進捗「領収書を書き出しています(n/m)」を表示する', async () => {
    let emit: (p: { phase: 'export' | 'import'; current: number; total: number }) => void = () => {}
    let finish: (v: unknown) => void = () => {}
    window.jimuhubApi = {
      exportData: vi.fn().mockReturnValue(new Promise((resolve) => (finish = resolve))),
      onDataProgress: vi.fn((cb) => {
        emit = cb
        return () => {}
      })
    } as unknown as Window['jimuhubApi']
    render(<ExportDialog onClose={vi.fn()} />)
    await userEvent.click(screen.getByText('エクスポート実行'))
    act(() => emit({ phase: 'export', current: 2, total: 5 }))
    expect(await screen.findByText('領収書を書き出しています(2/5)')).toBeInTheDocument()
    act(() => emit({ phase: 'export', current: 5, total: 5, stage: 'packing' } as never))
    expect(await screen.findByText('ファイルを整理しています…')).toBeInTheDocument()
    finish({ success: true, filePath: '/tmp/a.zip' })
    await waitFor(() => expect(screen.queryByText(/書き出しています/)).not.toBeInTheDocument())
  })
})
