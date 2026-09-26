import { ClientInputSchema, type ClientInput } from '@shared/schemas/client.schema'
import { CLIENT_MESSAGES } from '@shared/messages/messages'
import type { Client, ClientListFilter } from '@shared/types/client'
import type { ClientRepository } from '../repositories/client.repository'

export class ClientNotFoundError extends Error {
  constructor() {
    super(CLIENT_MESSAGES.notFound)
    this.name = 'ClientNotFoundError'
  }
}

function parseOrThrow(input: ClientInput): ClientInput {
  const result = ClientInputSchema.safeParse(input)
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? 'Invalid input')
  }
  return result.data
}

/**
 * 取引先に関する業務ロジックを担うApplication Service層。
 * 参照元: 詳細設計書 4.4〜4.8章、5章(クラス設計 `ClientService`)
 */
export class ClientService {
  constructor(private readonly repository: ClientRepository) {}

  listClients(filter: ClientListFilter = {}): Client[] {
    return this.repository.findAll(filter)
  }

  getClient(id: number): Client {
    const client = this.repository.findById(id)
    if (!client) {
      throw new ClientNotFoundError()
    }
    return client
  }

  createClient(input: ClientInput): { id: number } {
    const validated = parseOrThrow(input)
    return this.repository.insert(validated)
  }

  updateClient(id: number, input: ClientInput): { success: true } {
    const validated = parseOrThrow(input)
    const result = this.repository.update(id, validated)
    if (result.changes === 0) {
      throw new ClientNotFoundError()
    }
    return { success: true }
  }

  deactivateClient(id: number): { success: true } {
    const result = this.repository.updateStatus(id, 'inactive')
    if (result.changes === 0) {
      throw new ClientNotFoundError()
    }
    return { success: true }
  }
}
