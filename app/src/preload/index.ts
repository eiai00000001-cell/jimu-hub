import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc/channels'
import type { JimuhubApi } from '@shared/ipc/api'
import type { ClientInput } from '@shared/schemas/client.schema'
import type { ClientListFilter } from '@shared/types/client'

/**
 * contextBridgeでRendererに安全なAPIのみを公開するPreloadスクリプト。
 * 参照元: 詳細設計書 5章(クラス設計 `jimuhubApi`)、7章(API/インターフェース設計)
 */
const jimuhubApi: JimuhubApi = {
  getStartupStatus: () => ipcRenderer.invoke(IPC_CHANNELS.appStartupStatus),
  listClients: (filter?: ClientListFilter) => ipcRenderer.invoke(IPC_CHANNELS.clientsList, filter),
  getClient: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.clientsGet, id),
  createClient: (input: ClientInput) => ipcRenderer.invoke(IPC_CHANNELS.clientsCreate, input),
  updateClient: (id: number, input: ClientInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.clientsUpdate, id, input),
  deactivateClient: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.clientsDeactivate, id),
  exportData: () => ipcRenderer.invoke(IPC_CHANNELS.dataExport),
  importData: () => ipcRenderer.invoke(IPC_CHANNELS.dataImport)
}

contextBridge.exposeInMainWorld('jimuhubApi', jimuhubApi)
