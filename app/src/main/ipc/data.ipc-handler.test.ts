import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc/channels'
import { BACKUP_MESSAGES } from '@shared/messages/messages'

type Handler = (event: unknown, ...args: unknown[]) => unknown

const handlers = new Map<string, Handler>()
const showSaveDialog = vi.fn()
const showOpenDialog = vi.fn()
const appState = { isPackaged: false }

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Handler) => {
      handlers.set(channel, handler)
    })
  },
  dialog: {
    showSaveDialog: (...args: unknown[]) => showSaveDialog(...args),
    showOpenDialog: (...args: unknown[]) => showOpenDialog(...args)
  },
  BrowserWindow: {
    getFocusedWindow: () => null
  },
  app: {
    getPath: () => '/tmp',
    get isPackaged() {
      return appState.isPackaged
    }
  }
}))

import { DataIpcHandler } from './data.ipc-handler'
import type { BackupService } from '../services/backup.service'
import { BackupFileChangedError, BackupSizeLimitError } from '../services/backup/errors'

function createFakeBackupService(): BackupService {
  return {
    exportData: vi.fn().mockReturnValue({ success: true, filePath: '/tmp/export.json' }),
    importData: vi.fn().mockReturnValue({ success: true, importedCount: 2 })
  } as unknown as BackupService
}

describe('DataIpcHandler', () => {
  let backupService: BackupService

  beforeEach(() => {
    handlers.clear()
    showSaveDialog.mockReset()
    showOpenDialog.mockReset()
    backupService = createFakeBackupService()
    new DataIpcHandler(backupService).registerHandlers()
  })

  it('全チャンネルを登録する', () => {
    expect(handlers.has(IPC_CHANNELS.dataExport)).toBe(true)
    expect(handlers.has(IPC_CHANNELS.dataImport)).toBe(true)
  })

  it('data:exportは保存先ダイアログで選択されたパスでBackupServiceを呼び出す', async () => {
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/chosen.json' })
    const handler = handlers.get(IPC_CHANNELS.dataExport)!

    const result = await handler({})

    expect(backupService.exportData).toHaveBeenCalledWith('/tmp/chosen.json', expect.any(Function))
    expect(result).toEqual({ success: true, filePath: '/tmp/export.json' })
  })

  it('data:exportの保存ダイアログは.zipの既定ファイル名・ZIPフィルタを指定する', async () => {
    showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined })
    await handlers.get(IPC_CHANNELS.dataExport)!({})

    const options = showSaveDialog.mock.calls[0]?.[0]
    expect(options.defaultPath).toMatch(/事務HUB_backup_\d{8}_\d{4}\.zip$/)
    expect(options.filters).toEqual([{ name: 'ZIP', extensions: ['zip'] }])
  })

  it('data:importの選択ダイアログは新形式(zip)・旧形式(json)の双方を選択できる', async () => {
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    await handlers.get(IPC_CHANNELS.dataImport)!({})

    const options = showOpenDialog.mock.calls[0]?.[0]
    expect(options.filters[0].extensions).toEqual(['zip', 'json'])
  })

  it('data:exportはダイアログがキャンセルされた場合BackupServiceを呼び出さない', async () => {
    showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined })
    const handler = handlers.get(IPC_CHANNELS.dataExport)!

    const result = await handler({})

    expect(backupService.exportData).not.toHaveBeenCalled()
    expect(result).toEqual({ success: false })
  })

  it('data:importは選択ダイアログで選ばれたファイルでBackupServiceを呼び出す', async () => {
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/import.json'] })
    const handler = handlers.get(IPC_CHANNELS.dataImport)!

    const result = await handler({})

    expect(backupService.importData).toHaveBeenCalledWith('/tmp/import.json', expect.any(Function))
    expect(result).toEqual({ success: true, importedCount: 2 })
  })

  it('data:importはダイアログがキャンセルされた場合BackupServiceを呼び出さない', async () => {
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    const handler = handlers.get(IPC_CHANNELS.dataImport)!

    const result = await handler({})

    expect(backupService.importData).not.toHaveBeenCalled()
    expect(result).toEqual({ success: false })
  })

  describe('E2Eテスト専用の環境変数によるダイアログ省略', () => {
    afterEach(() => {
      delete process.env.JIMUHUB_E2E_EXPORT_PATH
      delete process.env.JIMUHUB_E2E_IMPORT_PATH
      appState.isPackaged = false
    })

    it('配布版(パッケージ済み)ではJIMUHUB_E2E_EXPORT_PATHを無視し、保存先ダイアログを表示する', async () => {
      appState.isPackaged = true
      process.env.JIMUHUB_E2E_EXPORT_PATH = '/tmp/e2e-export.json'
      showSaveDialog.mockResolvedValue({ canceled: true })
      const handler = handlers.get(IPC_CHANNELS.dataExport)!

      const result = await handler({})

      expect(showSaveDialog).toHaveBeenCalled()
      expect(backupService.exportData).not.toHaveBeenCalled()
      expect(result).toEqual({ success: false })
    })

    it('配布版(パッケージ済み)ではJIMUHUB_E2E_IMPORT_PATHを無視し、選択ダイアログを表示する', async () => {
      appState.isPackaged = true
      process.env.JIMUHUB_E2E_IMPORT_PATH = '/tmp/e2e-import.json'
      showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
      const handler = handlers.get(IPC_CHANNELS.dataImport)!

      const result = await handler({})

      expect(showOpenDialog).toHaveBeenCalled()
      expect(backupService.importData).not.toHaveBeenCalled()
      expect(result).toEqual({ success: false })
    })

    it('JIMUHUB_E2E_EXPORT_PATHが設定されている場合、保存先ダイアログを表示せずそのパスを使用する', async () => {
      process.env.JIMUHUB_E2E_EXPORT_PATH = '/tmp/e2e-export.json'
      const handler = handlers.get(IPC_CHANNELS.dataExport)!

      const result = await handler({})

      expect(showSaveDialog).not.toHaveBeenCalled()
      expect(backupService.exportData).toHaveBeenCalledWith(
        '/tmp/e2e-export.json',
        expect.any(Function)
      )
      expect(result).toEqual({ success: true, filePath: '/tmp/export.json' })
    })

    it('JIMUHUB_E2E_IMPORT_PATHが設定されている場合、選択ダイアログを表示せずそのパスを使用する', async () => {
      process.env.JIMUHUB_E2E_IMPORT_PATH = '/tmp/e2e-import.json'
      const handler = handlers.get(IPC_CHANNELS.dataImport)!

      const result = await handler({})

      expect(showOpenDialog).not.toHaveBeenCalled()
      expect(backupService.importData).toHaveBeenCalledWith(
        '/tmp/e2e-import.json',
        expect.any(Function)
      )
      expect(result).toEqual({ success: true, importedCount: 2 })
    })
  })

  describe('進捗・80%超の警告(詳細設計書4.2・4.3章、★E12)', () => {
    const makeEvent = (): {
      sender: { send: ReturnType<typeof vi.fn>; isDestroyed: () => boolean }
    } => ({
      sender: { send: vi.fn(), isDestroyed: () => false }
    })

    it('data:exportは、見込みサイズが大きい場合はダイアログを開かず警告を返し、confirmLargeで続行する', async () => {
      const service = {
        isLargeBackup: vi.fn().mockReturnValue(true),
        exportData: vi.fn().mockReturnValue({ success: true, filePath: '/tmp/e.zip' }),
        importData: vi.fn()
      } as unknown as BackupService
      handlers.clear()
      new DataIpcHandler(service).registerHandlers()
      const handler = handlers.get(IPC_CHANNELS.dataExport)!
      expect(await handler(makeEvent(), undefined)).toEqual({
        success: false,
        warnLargeBackup: true
      })
      expect(showSaveDialog).not.toHaveBeenCalled()
      showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/e.zip' })
      expect(await handler(makeEvent(), { confirmLarge: true })).toEqual({
        success: true,
        filePath: '/tmp/e.zip'
      })
    })

    it('data:exportは、見込みサイズが復元上限を超える場合はダイアログを開かず、書き出さずに理由を返す', async () => {
      const service = {
        isTooLargeBackup: vi.fn().mockReturnValue(true),
        isLargeBackup: vi.fn().mockReturnValue(true),
        exportData: vi.fn(),
        importData: vi.fn()
      } as unknown as BackupService
      handlers.clear()
      new DataIpcHandler(service).registerHandlers()
      const handler = handlers.get(IPC_CHANNELS.dataExport)!
      expect(await handler(makeEvent(), { confirmLarge: true })).toEqual({
        success: false,
        error: BACKUP_MESSAGES.exportTooLarge
      })
      expect(showSaveDialog).not.toHaveBeenCalled()
      expect(service.exportData).not.toHaveBeenCalled()
    })

    it('進捗はdata:progressとして呼び出し元のRendererへ通知する(エクスポート・復元)', async () => {
      const service = {
        isLargeBackup: vi.fn().mockReturnValue(false),
        exportData: vi.fn((_path: string, onProgress?: (p: unknown) => void) => {
          onProgress?.({ phase: 'export', current: 1, total: 2 })
          return { success: true, filePath: '/tmp/e.zip' }
        }),
        importData: vi.fn((_path: string, onProgress?: (p: unknown) => void) => {
          onProgress?.({ phase: 'import', current: 1, total: 1 })
          return { success: true, importedCount: 1 }
        })
      } as unknown as BackupService
      handlers.clear()
      new DataIpcHandler(service).registerHandlers()
      const exportEvent = makeEvent()
      showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/e.zip' })
      await handlers.get(IPC_CHANNELS.dataExport)!(exportEvent, undefined)
      expect(exportEvent.sender.send).toHaveBeenCalledWith(IPC_CHANNELS.dataProgress, {
        phase: 'export',
        current: 1,
        total: 2
      })
      const importEvent = makeEvent()
      showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/i.zip'] })
      await handlers.get(IPC_CHANNELS.dataImport)!(importEvent)
      expect(importEvent.sender.send).toHaveBeenCalledWith(IPC_CHANNELS.dataProgress, {
        phase: 'import',
        current: 1,
        total: 1
      })
    })
  })
})

describe('DataIpcHandler: 復元前の確認(F-33。data:inspectBackup / data:discardBackup / data:import)', () => {
  const inspection = {
    token: 't-1',
    fileName: 'b.zip',
    schemaVersion: 5,
    hasReceipts: false,
    hasProjects: false,
    currentReceiptCount: 2,
    currentProjectCount: 0,
    needsConfirmation: true
  }
  let service: BackupService
  let inspector: { inspect: ReturnType<typeof vi.fn> }
  let store: { resolve: ReturnType<typeof vi.fn>; discard: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    handlers.clear()
    showOpenDialog.mockReset()
    service = {
      exportData: vi.fn(),
      importData: vi.fn().mockResolvedValue({ success: true, importedCount: 3 })
    } as unknown as BackupService
    inspector = { inspect: vi.fn().mockResolvedValue(inspection) }
    store = { resolve: vi.fn().mockReturnValue('/tmp/b.zip'), discard: vi.fn() }
    new DataIpcHandler(service, { inspector, store } as never).registerHandlers()
  })
  afterEach(() => {
    delete process.env.JIMUHUB_E2E_IMPORT_PATH
  })

  it('data:inspectBackupは、選択したファイルを確認して結果を返す(復元は実行しない)', async () => {
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/b.zip'] })

    const result = await handlers.get(IPC_CHANNELS.dataInspectBackup)!({})

    expect(inspector.inspect).toHaveBeenCalledWith('/tmp/b.zip')
    expect(result).toEqual({ success: true, inspection })
    expect(service.importData).not.toHaveBeenCalled()
  })

  it('data:inspectBackupは、ダイアログがキャンセルされた場合canceledを返す', async () => {
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    expect(await handlers.get(IPC_CHANNELS.dataInspectBackup)!({})).toEqual({
      success: false,
      canceled: true
    })
    expect(inspector.inspect).not.toHaveBeenCalled()
  })

  it('data:inspectBackupは、確認で失敗した場合に利用者向けの文言を返す', async () => {
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/b.zip'] })
    inspector.inspect.mockRejectedValue(new BackupSizeLimitError('x'))
    expect(await handlers.get(IPC_CHANNELS.dataInspectBackup)!({})).toEqual({
      success: false,
      error: BACKUP_MESSAGES.importTooLarge
    })
    inspector.inspect.mockRejectedValue(new Error('x'))
    expect(await handlers.get(IPC_CHANNELS.dataInspectBackup)!({})).toEqual({
      success: false,
      error: BACKUP_MESSAGES.importParseFailure
    })
  })

  it('data:inspectBackupは、E2E用の環境変数のパスがあればダイアログを省略する', async () => {
    process.env.JIMUHUB_E2E_IMPORT_PATH = '/tmp/e2e.zip'
    await handlers.get(IPC_CHANNELS.dataInspectBackup)!({})
    expect(showOpenDialog).not.toHaveBeenCalled()
    expect(inspector.inspect).toHaveBeenCalledWith('/tmp/e2e.zip')
  })

  it('確認の部品が無い場合(起動エラー画面)のdata:inspectBackupはエラーを返す', async () => {
    handlers.clear()
    new DataIpcHandler(service).registerHandlers()
    expect(await handlers.get(IPC_CHANNELS.dataInspectBackup)!({})).toMatchObject({
      success: false
    })
  })

  it('data:importは、識別子から取り出したファイルで復元し、識別子を破棄する', async () => {
    const result = await handlers.get(IPC_CHANNELS.dataImport)!(
      { sender: { isDestroyed: () => false, send: vi.fn() } },
      { token: 't-1' }
    )

    expect(store.resolve).toHaveBeenCalledWith('t-1')
    expect(service.importData).toHaveBeenCalledWith('/tmp/b.zip', expect.any(Function))
    expect(store.discard).toHaveBeenCalledWith('t-1')
    expect(result).toEqual({ success: true, importedCount: 3 })
    expect(showOpenDialog).not.toHaveBeenCalled()
  })

  it('data:importは、ファイルが変更された・識別子が無効な場合は復元せず、専用の文言を返す', async () => {
    store.resolve.mockImplementation(() => {
      throw new BackupFileChangedError('changed')
    })

    const result = await handlers.get(IPC_CHANNELS.dataImport)!(
      { sender: { isDestroyed: () => false, send: vi.fn() } },
      { token: 't-1' }
    )

    expect(result).toEqual({ success: false, error: BACKUP_MESSAGES.importFileChanged })
    expect(service.importData).not.toHaveBeenCalled()
    expect(store.discard).toHaveBeenCalledWith('t-1')
  })

  it('data:discardBackupは、識別子を破棄する', async () => {
    expect(await handlers.get(IPC_CHANNELS.dataDiscardBackup)!({}, { token: 't-9' })).toEqual({
      success: true
    })
    expect(store.discard).toHaveBeenCalledWith('t-9')
    expect(await handlers.get(IPC_CHANNELS.dataDiscardBackup)!({}, undefined)).toEqual({
      success: true
    })
  })
})
