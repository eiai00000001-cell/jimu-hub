import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc/channels'
import type { ClientInput } from '@shared/schemas/client.schema'
import { ClientIdSchema, ClientListFilterSchema } from '@shared/schemas/ipc.schema'
import type { ClientListFilter } from '@shared/types/client'
import type { ClientService } from '../services/client.service'

function parseId(id: unknown): number {
  return ClientIdSchema.parse(id)
}

function parseFilter(filter: unknown): ClientListFilter {
  return ClientListFilterSchema.parse(filter ?? {})
}

/**
 * `clients:*`チャンネルを受信し`ClientService`を呼び出すIPC層。
 * Renderer側の実装ミス・将来の機能追加時の考慮漏れに備え、id・filterはZodスキーマで実行時バリデーションする
 * (レビュー結果報告書 v0.0 No.3)。`ClientInput`本体は詳細設計書どおりService層でバリデーションする。
 * 参照元: 詳細設計書 4.4〜4.8章、5章(クラス設計 `ClientIpcHandler`)、7章(API/インターフェース設計)
 */
export class ClientIpcHandler {
  constructor(private readonly service: ClientService) {}

  registerHandlers(): void {
    ipcMain.handle(IPC_CHANNELS.clientsList, async (_event, filter?: unknown) =>
      this.service.listClients(parseFilter(filter))
    )
    ipcMain.handle(IPC_CHANNELS.clientsGet, async (_event, id: unknown) =>
      this.service.getClient(parseId(id))
    )
    ipcMain.handle(IPC_CHANNELS.clientsCreate, async (_event, input: ClientInput) =>
      this.service.createClient(input)
    )
    ipcMain.handle(IPC_CHANNELS.clientsUpdate, async (_event, id: unknown, input: ClientInput) =>
      this.service.updateClient(parseId(id), input)
    )
    ipcMain.handle(IPC_CHANNELS.clientsDeactivate, async (_event, id: unknown) =>
      this.service.deactivateClient(parseId(id))
    )
  }
}
