// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImportDialog } from './ImportDialog'
import type { DataProgress } from '@shared/ipc/api'

function setupApi(result: {
  success: boolean
  importedCount?: number
  pdfHashMismatchCount?: number
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

describe('ImportDialog(詳細設計書3.7章の2段階フロー)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('初期状態では「ファイルを選択して復元」ボタン(副ボタン)のみを表示し、警告・importDataの呼び出しはまだ行わない', () => {
    const importData = setupApi({ success: true, importedCount: 1 })
    render(<ImportDialog onClose={vi.fn()} onImported={vi.fn()} />)

    const startButton = screen.getByRole('button', { name: 'ファイルを選択して復元' })
    expect(startButton).toHaveClass('btn-secondary')
    expect(screen.queryByText(/置き換わります/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '続行' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'キャンセル' })).not.toBeInTheDocument()
    expect(importData).not.toHaveBeenCalled()
  })

  it('「ファイルを選択して復元」押下で、警告(左に赤帯・アイコン付き)と「キャンセル」「続行」ボタンを表示する', async () => {
    const importData = setupApi({ success: true, importedCount: 1 })
    render(<ImportDialog onClose={vi.fn()} onImported={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'ファイルを選択して復元' }))

    const warning = screen.getByText(/現在のデータがエクスポートファイルの内容で置き換わります/)
    expect(warning.closest('.message-warning')).toBeInTheDocument()

    const cancelButton = screen.getByRole('button', { name: 'キャンセル' })
    const continueButton = screen.getByRole('button', { name: '続行' })
    expect(cancelButton).toHaveClass('btn-secondary')
    expect(continueButton).toHaveClass('btn-danger')
    expect(importData).not.toHaveBeenCalled()
  })

  it('確認状態で「キャンセル」を押すと、何も実行せず初期状態へ戻る', async () => {
    const importData = setupApi({ success: true, importedCount: 1 })
    render(<ImportDialog onClose={vi.fn()} onImported={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'ファイルを選択して復元' }))
    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(screen.getByRole('button', { name: 'ファイルを選択して復元' })).toBeInTheDocument()
    expect(screen.queryByText(/置き換わります/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '続行' })).not.toBeInTheDocument()
    expect(importData).not.toHaveBeenCalled()
  })

  it('確認状態で「続行」を押すとimportDataを呼び出す(OS標準ファイル選択ダイアログを開く)', async () => {
    const importData = setupApi({ success: true, importedCount: 1 })
    render(<ImportDialog onClose={vi.fn()} onImported={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'ファイルを選択して復元' }))
    await userEvent.click(screen.getByRole('button', { name: '続行' }))

    await waitFor(() => expect(importData).toHaveBeenCalled())
  })

  it('復元成功時は件数を含む完了メッセージを表示し、onImportedを呼び出す', async () => {
    setupApi({ success: true, importedCount: 12 })
    const onImported = vi.fn()
    render(<ImportDialog onClose={vi.fn()} onImported={onImported} />)

    await userEvent.click(screen.getByRole('button', { name: 'ファイルを選択して復元' }))
    await userEvent.click(screen.getByRole('button', { name: '続行' }))

    expect(await screen.findByText('復元が完了しました(12件)')).toBeInTheDocument()
    expect(onImported).toHaveBeenCalledWith(12)
  })

  it('PDFのハッシュ不一致がある場合は、件数を含む警告付きの完了メッセージを表示する', async () => {
    setupApi({ success: true, importedCount: 5, pdfHashMismatchCount: 2 })
    render(<ImportDialog onClose={vi.fn()} onImported={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'ファイルを選択して復元' }))
    await userEvent.click(screen.getByRole('button', { name: '続行' }))

    expect(await screen.findByText(/改変が疑われる書類が2件/)).toBeInTheDocument()
  })

  it('復元失敗時はエラーメッセージを表示する', async () => {
    setupApi({ success: false, error: '復元に失敗しました。データは復元前の状態に戻しました' })
    render(<ImportDialog onClose={vi.fn()} onImported={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'ファイルを選択して復元' }))
    await userEvent.click(screen.getByRole('button', { name: '続行' }))

    expect(
      await screen.findByText('復元に失敗しました。データは復元前の状態に戻しました')
    ).toBeInTheDocument()
  })

  it('OS標準ダイアログがキャンセルされた場合(エラーなし)は警告以外の結果メッセージは表示しない', async () => {
    setupApi({ success: false })
    const { container } = render(<ImportDialog onClose={vi.fn()} onImported={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'ファイルを選択して復元' }))
    await userEvent.click(screen.getByRole('button', { name: '続行' }))

    await waitFor(() => expect(window.jimuhubApi.importData).toHaveBeenCalled())
    expect(container.querySelectorAll('.message')).toHaveLength(1)
  })

  it('閉じるボタンでonCloseを呼び出す(どの段階でも操作可能)', async () => {
    setupApi({ success: true, importedCount: 1 })
    const onClose = vi.fn()
    render(<ImportDialog onClose={onClose} onImported={vi.fn()} />)

    await userEvent.click(screen.getByLabelText('閉じる'))
    expect(onClose).toHaveBeenCalled()
  })

  it('importDataが例外で失敗した場合は、失敗メッセージを表示する(I1-06)', async () => {
    const importData = setupApi({ success: true })
    importData.mockRejectedValue(new Error('ディスク障害'))
    render(<ImportDialog onClose={vi.fn()} onImported={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'ファイルを選択して復元' }))
    await userEvent.click(screen.getByRole('button', { name: '続行' }))

    expect(await screen.findByText('ディスク障害')).toBeInTheDocument()
  })

  it('復元が成功した後は、警告文と「キャンセル」「続行」ボタンを隠し完了メッセージのみ表示する(O1)', async () => {
    setupApi({ success: true, importedCount: 3 })
    render(<ImportDialog onClose={vi.fn()} onImported={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'ファイルを選択して復元' }))
    await userEvent.click(screen.getByRole('button', { name: '続行' }))

    expect(await screen.findByText(/復元が完了しました/)).toBeInTheDocument()
    expect(screen.queryByText(/置き換わります/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '続行' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'キャンセル' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '閉じる' })).toBeInTheDocument()
  })

  it('復元の完了メッセージに、PDF・領収書・記録の不一致件数を含める', async () => {
    window.jimuhubApi = {
      importData: vi.fn().mockResolvedValue({
        success: true,
        importedCount: 12,
        pdfHashMismatchCount: 1,
        receiptHashMismatchCount: 2,
        recordHashMismatchCount: 3
      })
    } as unknown as Window['jimuhubApi']
    render(<ImportDialog onClose={vi.fn()} onImported={vi.fn()} />)
    await userEvent.click(screen.getByText('ファイルを選択して復元'))
    await userEvent.click(screen.getByText('続行'))
    const message = await screen.findByText(/復元が完了しました\(12件\)/)
    expect(message).toHaveTextContent('PDFファイルの改変が疑われる書類が1件')
    expect(message).toHaveTextContent('領収書ファイルの改変・欠落が疑われるものが2件')
    expect(message).toHaveTextContent('記録の改変が疑われる入出金・経費が3件')
  })

  it('実行中は進捗「領収書・PDFを復元しています(n/m)」を表示する', async () => {
    let emit: (p: DataProgress) => void = () => {}
    let finish: (v: unknown) => void = () => {}
    window.jimuhubApi = {
      importData: vi.fn().mockReturnValue(new Promise((resolve) => (finish = resolve))),
      onDataProgress: vi.fn((cb) => {
        emit = cb
        return () => {}
      })
    } as unknown as Window['jimuhubApi']
    render(<ImportDialog onClose={vi.fn()} onImported={vi.fn()} />)
    await userEvent.click(screen.getByText('ファイルを選択して復元'))
    await userEvent.click(screen.getByText('続行'))
    act(() => emit({ phase: 'import', stage: 'extract', current: 3, total: 4 }))
    expect(await screen.findByText('領収書・PDFを復元しています(3/4)')).toBeInTheDocument()
    act(() => emit({ phase: 'import', stage: 'verify', current: 1, total: 2 }))
    expect(await screen.findByText('復元したファイルを確認しています(1/2)')).toBeInTheDocument()
    finish({ success: false })
  })
})
