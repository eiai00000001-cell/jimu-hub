import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc/channels'
import type { CompanyProfileInput } from '@shared/schemas/company-profile.schema'
import type { CompanyService } from '../services/company.service'

/**
 * `company:*`チャンネルを受信し`CompanyService`を呼び出すIPC層。
 * 参照元: 詳細設計書 4.10章、5章(クラス設計 `CompanyIpcHandler`)、7章(API/インターフェース設計)
 */
export class CompanyIpcHandler {
  constructor(private readonly service: CompanyService) {}

  registerHandlers(): void {
    ipcMain.handle(IPC_CHANNELS.companyGet, async () => this.service.getProfile())
    ipcMain.handle(IPC_CHANNELS.companySave, async (_event, input: CompanyProfileInput) =>
      this.service.saveProfile(input)
    )
  }
}
