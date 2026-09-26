import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc/channels'
import type { ClientInput } from '@shared/schemas/client.schema'
import type { ClientListFilter } from '@shared/types/client'
import type { ClientService } from '../services/client.service'

/**
 * `clients:*`チャンネルを受信し`ClientService`を呼び出すIPC層。
 * 参照元: 詳細設計書 4.4〜4.8章、5章(クラス設計 `ClientIpcHandler`)、7章(API/インターフェース設計)
 */
export class ClientIpcHandler {
  constructor(private readonly service: ClientService) {}

  registerHandlers(): void {
    ipcMain.handle(IPC_CHANNELS.clientsList, (_event, filter?: ClientListFilter) =>
      this.service.listClients(filter)
    )
    ipcMain.handle(IPC_CHANNELS.clientsGet, (_event, id: number) => this.service.getClient(id))
    ipcMain.handle(IPC_CHANNELS.clientsCreate, (_event, input: ClientInput) =>
      this.service.createClient(input)
    )
    ipcMain.handle(IPC_CHANNELS.clientsUpdate, (_event, id: number, input: ClientInput) =>
      this.service.updateClient(id, input)
    )
    ipcMain.handle(IPC_CHANNELS.clientsDeactivate, (_event, id: number) =>
      this.service.deactivateClient(id)
    )
  }
}
