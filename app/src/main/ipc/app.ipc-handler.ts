import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc/channels'
import type { StartupStatus } from '@shared/ipc/api'

/**
 * `app:startup-status`チャンネルを受信し、アプリ起動処理(データベース接続)の結果を返すIPC層。
 * 参照元: 詳細設計書 4.1章手順5、8章(データベース接続失敗時のエラー表示)
 */
export class AppIpcHandler {
  constructor(private readonly status: StartupStatus) {}

  registerHandlers(): void {
    ipcMain.handle(IPC_CHANNELS.appStartupStatus, () => this.status)
  }
}
