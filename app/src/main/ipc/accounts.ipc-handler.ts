import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc/channels'
import {
  AccountIdSchema,
  AccountInputSchema,
  AccountListFilterSchema,
  AccountNameSchema
} from '@shared/schemas/account.schema'
import type { AccountService } from '../services/account.service'

/**
 * `accounts:*`チャンネルを受信し`AccountService`を呼び出すIPC層。
 * IPC境界でid・filter・入力をZodスキーマにより再検証する(詳細設計書4.17章)。
 * 参照元: 詳細設計書 4.17章、5章(`AccountsIpcHandler`)、7章
 */
export class AccountsIpcHandler {
  constructor(private readonly service: AccountService) {}

  registerHandlers(): void {
    ipcMain.handle(IPC_CHANNELS.accountsList, async (_event, filter?: unknown) =>
      this.service.listAccounts(AccountListFilterSchema.parse(filter ?? {}))
    )
    ipcMain.handle(IPC_CHANNELS.accountsCreate, async (_event, input: unknown) =>
      this.service.createAccount(AccountInputSchema.parse(input))
    )
    ipcMain.handle(IPC_CHANNELS.accountsRename, async (_event, id: unknown, name: unknown) =>
      this.service.renameAccount(AccountIdSchema.parse(id), AccountNameSchema.parse(name))
    )
    ipcMain.handle(IPC_CHANNELS.accountsDeactivate, async (_event, id: unknown) =>
      this.service.deactivateAccount(AccountIdSchema.parse(id))
    )
    ipcMain.handle(IPC_CHANNELS.accountsReactivate, async (_event, id: unknown) =>
      this.service.reactivateAccount(AccountIdSchema.parse(id))
    )
    ipcMain.handle(IPC_CHANNELS.accountsDelete, async (_event, id: unknown) =>
      this.service.deleteAccount(AccountIdSchema.parse(id))
    )
  }
}
