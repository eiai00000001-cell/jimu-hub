// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImportDialog } from './ImportDialog'
import type { BackupInspection, DataProgress, InspectBackupResult } from '@shared/ipc/api'

const inspection = (overrides: Partial<BackupInspection> = {}): InspectBackupResult => ({
  success: true,
  inspection: {
    token: 'token-1',
    fileName: 'backup.zip',
    schemaVersion: 5,
    hasReceipts: true,
    hasProjects: true,
    currentReceiptCount: 0,
    currentProjectCount: 0,
    needsConfirmation: false,
    ...overrides
  }
})

/** `importData`のモックを返す。`inspectBackup`は、既定では確認画面が不要な結果を返す */
function setupApi(
  result: {
    success: boolean
    importedCount?: number
    pdfHashMismatchCount?: number
    error?: string
  },
  inspectResult: InspectBackupResult = inspection()
): ReturnType<typeof vi.fn> {
  const importData = vi.fn().mockResolvedValue(result)
  window.jimuhubApi = {
    inspectBackup: vi.fn().mockResolvedValue(inspectResult),
    discardBackup: vi.fn().mockResolvedValue({ success: true }),
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

    await waitFor(() => expect(importData).toHaveBeenCalledWith({ token: 'token-1' }))
    expect(window.jimuhubApi.inspectBackup).toHaveBeenCalledTimes(1)
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

  it('OS標準ダイアログがキャンセルされた場合は、復元を実行せず、警告以外の結果メッセージは表示しない', async () => {
    setupApi({ success: true, importedCount: 1 }, { success: false, canceled: true })
    const { container } = render(<ImportDialog onClose={vi.fn()} onImported={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'ファイルを選択して復元' }))
    await userEvent.click(screen.getByRole('button', { name: '続行' }))

    await waitFor(() => expect(window.jimuhubApi.inspectBackup).toHaveBeenCalled())
    expect(window.jimuhubApi.importData).not.toHaveBeenCalled()
    expect(container.querySelectorAll('.message')).toHaveLength(1)
  })

  it('ファイルの確認でエラー(容量超過・形式不正等)になった場合は、復元せずエラーを表示する', async () => {
    setupApi(
      { success: true, importedCount: 1 },
      {
        success: false,
        error: 'ファイルの容量が復元できる上限(1GB)を超えているため、読み込めませんでした'
      }
    )
    render(<ImportDialog onClose={vi.fn()} onImported={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'ファイルを選択して復元' }))
    await userEvent.click(screen.getByRole('button', { name: '続行' }))

    expect(await screen.findByText(/容量が復元できる上限/)).toBeInTheDocument()
    expect(window.jimuhubApi.importData).not.toHaveBeenCalled()
  })

  describe('復元前の確認画面(F-33。詳細設計書3.7章・4.33章)', () => {
    async function openConfirm(
      overrides: Partial<BackupInspection>
    ): Promise<ReturnType<typeof vi.fn>> {
      const importData = setupApi(
        { success: true, importedCount: 7 },
        inspection({ needsConfirmation: true, ...overrides })
      )
      render(<ImportDialog onClose={vi.fn()} onImported={vi.fn()} />)
      await userEvent.click(screen.getByRole('button', { name: 'ファイルを選択して復元' }))
      await userEvent.click(screen.getByRole('button', { name: '続行' }))
      await screen.findByText('復元前の確認')
      return importData
    }

    it('領収書が消える場合は、現在の件数を表示し、復元はまだ実行しない。「キャンセル」が初期フォーカス', async () => {
      const importData = await openConfirm({ hasReceipts: false, currentReceiptCount: 12 })

      expect(
        screen.getByText(
          'このバックアップには領収書が含まれていないため、復元すると現在の領収書(12件)はすべて消えます。'
        )
      ).toBeInTheDocument()
      expect(screen.queryByText(/案件のデータが含まれていない/)).not.toBeInTheDocument()
      expect(
        screen.getByText('復元前の状態は自動で退避され、直近3回分が保存されます。')
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'キャンセル' })).toHaveFocus()
      expect(screen.getByRole('button', { name: '復元する' })).toHaveClass('btn-danger')
      expect(importData).not.toHaveBeenCalled()
    })

    it('案件が消える場合は、案件の件数を表示する', async () => {
      await openConfirm({ hasProjects: false, currentProjectCount: 5 })

      expect(
        screen.getByText(/現在の案件\(5件\)と、案件への紐づけ・付け替え履歴はすべて消えます/)
      ).toBeInTheDocument()
      expect(screen.queryByText(/領収書が含まれていない/)).not.toBeInTheDocument()
    })

    it('両方が消える場合は、1つの確認画面に2項目を並べる', async () => {
      await openConfirm({
        hasReceipts: false,
        hasProjects: false,
        currentReceiptCount: 12,
        currentProjectCount: 5
      })

      expect(screen.getByText(/現在の領収書\(12件\)/)).toBeInTheDocument()
      expect(screen.getByText(/現在の案件\(5件\)/)).toBeInTheDocument()
      expect(screen.getAllByRole('button', { name: /キャンセル|復元する/ })).toHaveLength(2)
    })

    it('「復元する」を押すと、確認済みの識別子で復元を実行し、完了メッセージを表示する', async () => {
      const importData = await openConfirm({ hasReceipts: false, currentReceiptCount: 1 })

      await userEvent.click(screen.getByRole('button', { name: '復元する' }))

      await waitFor(() => expect(importData).toHaveBeenCalledWith({ token: 'token-1' }))
      expect(await screen.findByText('復元が完了しました(7件)')).toBeInTheDocument()
      expect(screen.queryByText('復元前の確認')).not.toBeInTheDocument()
    })

    it('「キャンセル」を押すと、選択済みファイルの情報を破棄し、復元せずに最初の状態へ戻る', async () => {
      const importData = await openConfirm({ hasReceipts: false, currentReceiptCount: 1 })

      await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))

      expect(window.jimuhubApi.discardBackup).toHaveBeenCalledWith('token-1')
      expect(importData).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'ファイルを選択して復元' })).toBeInTheDocument()
      expect(screen.queryByText('復元前の確認')).not.toBeInTheDocument()
    })

    it('復元に失敗した場合は、最初の状態へ戻ってエラーを表示する', async () => {
      const importData = await openConfirm({ hasReceipts: false, currentReceiptCount: 1 })
      importData.mockResolvedValue({
        success: false,
        error: '復元に失敗しました。データは復元前の状態に戻しました'
      })

      await userEvent.click(screen.getByRole('button', { name: '復元する' }))

      expect(await screen.findByText(/復元に失敗しました/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'ファイルを選択して復元' })).toBeInTheDocument()
    })
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
      inspectBackup: vi.fn().mockResolvedValue(inspection()),
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
      inspectBackup: vi.fn().mockResolvedValue(inspection()),
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
