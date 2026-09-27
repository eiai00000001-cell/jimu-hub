import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc/channels'

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

    expect(backupService.exportData).toHaveBeenCalledWith('/tmp/chosen.json')
    expect(result).toEqual({ success: true, filePath: '/tmp/export.json' })
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

    expect(backupService.importData).toHaveBeenCalledWith('/tmp/import.json')
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
      expect(backupService.exportData).toHaveBeenCalledWith('/tmp/e2e-export.json')
      expect(result).toEqual({ success: true, filePath: '/tmp/export.json' })
    })

    it('JIMUHUB_E2E_IMPORT_PATHが設定されている場合、選択ダイアログを表示せずそのパスを使用する', async () => {
      process.env.JIMUHUB_E2E_IMPORT_PATH = '/tmp/e2e-import.json'
      const handler = handlers.get(IPC_CHANNELS.dataImport)!

      const result = await handler({})

      expect(showOpenDialog).not.toHaveBeenCalled()
      expect(backupService.importData).toHaveBeenCalledWith('/tmp/e2e-import.json')
      expect(result).toEqual({ success: true, importedCount: 2 })
    })
  })
})
