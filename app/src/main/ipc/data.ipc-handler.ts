import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc/channels'
import type { InspectBackupResult } from '@shared/ipc/api'
import { BACKUP_MESSAGES } from '@shared/messages/messages'
import { readDevOnlyEnv } from '../app-security'
import type {
  BackupProgressCallback,
  ExportDataResult,
  ImportDataResult
} from '../services/backup.service'
import type { RestoreInspector } from '../services/backup/restore-inspector'
import type { RestoreSessionStore } from '../services/backup/restore-session-store'
import { toRestoreErrorMessage } from '../services/backup/restore-errors'

/** `BackupService`および起動エラー画面用の`StartupRecoveryService`が満たすインターフェース */
export interface BackupOperations {
  exportData(filePath: string, onProgress?: BackupProgressCallback): Promise<ExportDataResult>
  importData(filePath: string, onProgress?: BackupProgressCallback): Promise<ImportDataResult>
  /** 見込みサイズが復元上限の80%を超えるか(起動エラー画面の復元用サービスでは未実装) */
  isLargeBackup?(): boolean
  /** 見込みサイズが復元上限を超えるか(超える場合は書き出さない) */
  isTooLargeBackup?(): boolean
}

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
  /**
   * @param restore 復元前の確認(F-33)の部品。起動エラー画面からの復元(現在のデータを読めない)では指定せず、
   *   `data:import`はMainが選択ダイアログでファイルを取得する(確認画面は表示しない)
   */
  constructor(
    private readonly service: BackupOperations,
    private readonly restore?: { inspector: RestoreInspector; store: RestoreSessionStore }
  ) {}

  registerHandlers(): void {
    ipcMain.handle(IPC_CHANNELS.dataExport, (event, options?: { confirmLarge?: boolean }) =>
      this.handleExport(this.progressSender(event), options?.confirmLarge === true)
    )
    ipcMain.handle(IPC_CHANNELS.dataImport, (event, options?: { token?: string }) =>
      this.handleImport(this.progressSender(event), options?.token)
    )
    ipcMain.handle(IPC_CHANNELS.dataInspectBackup, () => this.handleInspect())
    ipcMain.handle(IPC_CHANNELS.dataDiscardBackup, (_event, options?: { token?: string }) => {
      if (options?.token) this.restore?.store.discard(options.token)
      return { success: true as const }
    })
  }

  /** 進捗をRendererへ`data:progress`として通知する(ファイル1件ごと) */
  private progressSender(event: IpcMainInvokeEvent): BackupProgressCallback {
    return (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send(IPC_CHANNELS.dataProgress, progress)
    }
  }

  private async handleExport(
    onProgress: BackupProgressCallback,
    confirmLarge: boolean
  ): Promise<ExportDataResult> {
    // 領収書・PDFの見込みサイズが復元上限の80%を超える場合は、書き出しの前に警告する(基本設計書8.1章★E12)
    if (this.service.isTooLargeBackup?.()) {
      return { success: false, error: BACKUP_MESSAGES.exportTooLarge }
    }
    if (!confirmLarge && this.service.isLargeBackup?.()) {
      return { success: false, warnLargeBackup: true }
    }
    // E2Eテスト専用: OS標準ダイアログはPlaywrightから操作できないため、
    // 環境変数でパスが指定されている場合のみダイアログ表示を省略する。
    // 配布版(パッケージ済み)では環境変数を無視し、必ずダイアログを表示する(セキュリティチェック結果報告書 v0.0 SEC-01)。
    const e2eOverridePath = readDevOnlyEnv('JIMUHUB_E2E_EXPORT_PATH', app.isPackaged)
    if (e2eOverridePath) {
      return this.service.exportData(e2eOverridePath, onProgress)
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

    return this.service.exportData(result.filePath, onProgress)
  }

  /** 復元するファイルを選択させ、現在のデータを変更せずに内容を確認する(F-33。詳細設計書4.33章) */
  private async handleInspect(): Promise<InspectBackupResult> {
    if (!this.restore) {
      return { success: false, error: BACKUP_MESSAGES.importParseFailure }
    }
    const filePath = await this.selectImportFile()
    if (!filePath) {
      return { success: false, canceled: true }
    }
    try {
      return { success: true, inspection: await this.restore.inspector.inspect(filePath) }
    } catch (error) {
      return { success: false, error: toRestoreErrorMessage(error) }
    }
  }

  /**
   * 復元を実行する。`token`がある場合は、事前確認で登録したファイルを使う(ファイルが変更されていた場合は復元しない)。
   * `token`が無い場合(起動エラー画面)は、Mainが選択ダイアログでファイルを取得する。
   */
  private async handleImport(
    onProgress: BackupProgressCallback,
    token?: string
  ): Promise<ImportDataResult> {
    if (token && this.restore) {
      try {
        const filePath = this.restore.store.resolve(token)
        return await this.service.importData(filePath, onProgress)
      } catch (error) {
        return { success: false, error: toRestoreErrorMessage(error) }
      } finally {
        this.restore.store.discard(token)
      }
    }
    const filePath = await this.selectImportFile()
    if (!filePath) {
      return { success: false }
    }
    return this.service.importData(filePath, onProgress)
  }

  /** 復元ファイルのパスを取得する(キャンセル時はnull)。E2Eでは環境変数のパスを使い、ダイアログを省略する */
  private async selectImportFile(): Promise<string | null> {
    // E2Eテスト専用: 詳細は handleExport() のコメントを参照
    const e2eOverridePath = readDevOnlyEnv('JIMUHUB_E2E_IMPORT_PATH', app.isPackaged)
    if (e2eOverridePath) {
      return e2eOverridePath
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
    return result.canceled || !filePath ? null : filePath
  }
}
