import type { Client, ClientListFilter } from '../types/client'
import type { ClientInput } from '../schemas/client.schema'

/**
 * Renderer-Main間のIPCリクエスト/レスポンス型。
 * 参照元: 詳細設計書 7章(API/インターフェース設計)
 */

export interface UpdateClientRequest {
  id: number
  input: ClientInput
}

export interface DeactivateClientResult {
  success: true
}

export interface UpdateClientResult {
  success: true
}

export interface CreateClientResult {
  id: number
}

export interface ExportDataResult {
  success: boolean
  filePath?: string
  error?: string
}

export interface ImportDataResult {
  success: boolean
  importedCount?: number
  error?: string
}

/** アプリ起動処理(4.1章)の結果。データベース接続に失敗した場合はok:falseとなる */
export interface StartupStatus {
  ok: boolean
  message?: string
}

/**
 * PreloadがcontextBridgeで公開するAPIの型(window.jimuhubApi)。
 * Renderer側はこの型を通じてのみMainプロセスとやり取りする。
 */
export interface JimuhubApi {
  getStartupStatus(): Promise<StartupStatus>
  listClients(filter?: ClientListFilter): Promise<Client[]>
  /** 対象が存在しない場合はPromiseがreject(例外)される(ClientService.getClient()参照) */
  getClient(id: number): Promise<Client>
  createClient(input: ClientInput): Promise<CreateClientResult>
  updateClient(id: number, input: ClientInput): Promise<UpdateClientResult>
  deactivateClient(id: number): Promise<DeactivateClientResult>
  exportData(): Promise<ExportDataResult>
  importData(): Promise<ImportDataResult>
}
