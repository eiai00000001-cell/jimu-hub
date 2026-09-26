import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { Database } from './db/db'
import { ClientRepository } from './repositories/client.repository'
import { ClientService } from './services/client.service'
import { BackupService } from './services/backup.service'
import { MigrationService } from './services/migration.service'
import { ClientIpcHandler } from './ipc/client.ipc-handler'
import { DataIpcHandler } from './ipc/data.ipc-handler'
import { AppIpcHandler } from './ipc/app.ipc-handler'
import { STARTUP_MESSAGES } from '@shared/messages/messages'
import type { StartupStatus } from '@shared/ipc/api'

/**
 * データの保存場所。
 * 通常は `~/Library/Application Support/事務HUB` (基本設計書3章)。
 * E2Eテスト・見るだけ実行時のみ、環境変数 `JIMUHUB_DATA_DIR` でテスト専用ディレクトリに切り替える。
 */
const userDataDir = process.env.JIMUHUB_DATA_DIR ?? app.getPath('userData')
mkdirSync(userDataDir, { recursive: true })
if (process.env.JIMUHUB_DATA_DIR) {
  app.setPath('userData', userDataDir)
}

const dbFilePath = join(userDataDir, 'data.sqlite')
const backupsDir = join(userDataDir, 'backups')

function createMainWindow(): BrowserWindow {
  const shouldShow = process.env.JIMUHUB_WINDOW_SHOW !== '0'

  const mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    show: shouldShow,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

app.whenReady().then(() => {
  const database = new Database(dbFilePath)

  let startupStatus: StartupStatus = { ok: true }
  try {
    database.initialize()
  } catch (error) {
    startupStatus = { ok: false, message: STARTUP_MESSAGES.databaseError }
    console.error('データベース初期化に失敗しました', error)
  }

  const clientRepository = new ClientRepository(database)
  const clientService = new ClientService(clientRepository)
  const backupService = new BackupService({
    database,
    clientRepository,
    migrationService: new MigrationService(),
    dbFilePath,
    backupsDir,
    appVersion: app.getVersion()
  })

  new AppIpcHandler(startupStatus).registerHandlers()
  new ClientIpcHandler(clientService).registerHandlers()
  new DataIpcHandler(backupService).registerHandlers()

  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
