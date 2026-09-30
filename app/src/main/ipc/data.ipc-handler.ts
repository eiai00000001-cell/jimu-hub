import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc/channels'
import { readDevOnlyEnv } from '../app-security'
import type { BackupService, ExportDataResult, ImportDataResult } from '../services/backup.service'

function defaultExportFileName(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(
    now.getHours()
  )}${pad(now.getMinutes())}`
  return `事務HUB_backup_${stamp}.zip`
}

/**
 * `data:export`・`data:import`チャンネルを受信し`BackupService`を呼び出すIPC層。
 * OS標準ダイアログ(保存先・復元ファイル選択)の表示はMainプロセスでのみ行う。
 * 参照元: 詳細設計書 4.2章・4.3章、5章(クラス設計 `DataIpcHandler`)、7章
 */
export class DataIpcHandler {
  constructor(private readonly service: BackupService) {}

  registerHandlers(): void {
    ipcMain.handle(IPC_CHANNELS.dataExport, () => this.handleExport())
    ipcMain.handle(IPC_CHANNELS.dataImport, () => this.handleImport())
  }

  private async handleExport(): Promise<ExportDataResult> {
    // E2Eテスト専用: OS標準ダイアログはPlaywrightから操作できないため、
    // 環境変数でパスが指定されている場合のみダイアログ表示を省略する。
    // 配布版(パッケージ済み)では環境変数を無視し、必ずダイアログを表示する(セキュリティチェック結果報告書 v0.0 SEC-01)。
    const e2eOverridePath = readDevOnlyEnv('JIMUHUB_E2E_EXPORT_PATH', app.isPackaged)
    if (e2eOverridePath) {
      return this.service.exportData(e2eOverridePath)
    }

    const focusedWindow = BrowserWindow.getFocusedWindow()
    const options = {
      defaultPath: `${app.getPath('documents')}/${defaultExportFileName()}`,
      filters: [{ name: 'ZIP', extensions: ['zip'] }]
    }
    const result = focusedWindow
      ? await dialog.showSaveDialog(focusedWindow, options)
      : await dialog.showSaveDialog(options)

    if (result.canceled || !result.filePath) {
      return { success: false }
    }

    return this.service.exportData(result.filePath)
  }

  private async handleImport(): Promise<ImportDataResult> {
    // E2Eテスト専用: 詳細は handleExport() のコメントを参照
    const e2eOverridePath = readDevOnlyEnv('JIMUHUB_E2E_IMPORT_PATH', app.isPackaged)
    if (e2eOverridePath) {
      return this.service.importData(e2eOverridePath)
    }

    const focusedWindow = BrowserWindow.getFocusedWindow()
    const options = {
      // 新形式(ZIP)に加え、旧形式(JSON単体)のエクスポートファイルも選択できる(詳細設計書4.3章手順2)
      properties: ['openFile' as const],
      filters: [{ name: 'バックアップファイル', extensions: ['zip', 'json'] }]
    }
    const result = focusedWindow
      ? await dialog.showOpenDialog(focusedWindow, options)
      : await dialog.showOpenDialog(options)

    const filePath = result.filePaths[0]
    if (result.canceled || !filePath) {
      return { success: false }
    }

    return this.service.importData(filePath)
  }
}
