import { AccountInputSchema, AccountNameSchema } from '@shared/schemas/account.schema'
import type { AccountInput } from '@shared/schemas/account.schema'
import { ACCOUNT_MESSAGES } from '@shared/messages/messages'
import type { Account, AccountListFilter, AccountView } from '@shared/types/account'
import type { AccountRepository } from '../repositories/account.repository'

/** 勘定科目の業務エラー(重複・利用停止不可・利用済み・未存在)。メッセージは画面にそのまま表示する */
export class AccountError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AccountError'
  }
}

function parseOrThrow<T>(
  parse: () =>
    { success: true; data: T } | { success: false; error: { issues: Array<{ message: string }> } }
): T {
  const result = parse()
  if (!result.success) {
    throw new AccountError(result.error.issues[0]?.message ?? 'Invalid input')
  }
  return result.data
}

/**
 * 勘定科目の一覧・追加・名称変更・利用停止・再開・削除を担うApplication Service層。
 * 参照元: 詳細設計書 4.17章、5章(`AccountService`)
 */
export class AccountService {
  constructor(private readonly repository: AccountRepository) {}

  listAccounts(filter: AccountListFilter = {}): AccountView[] {
    return this.repository.findAll(filter).map((account) => ({
      ...account,
      deletable: !account.isDefault && !this.repository.isUsed(account.id)
    }))
  }

  createAccount(input: AccountInput): { id: number } {
    const { name, kind } = parseOrThrow(() => AccountInputSchema.safeParse(input))
    if (this.repository.existsByName(kind, name)) {
      throw new AccountError(ACCOUNT_MESSAGES.nameDuplicated)
    }
    return this.repository.insert(name, kind)
  }

  renameAccount(id: number, rawName: string): { success: true } {
    const account = this.getOrThrow(id)
    const name = parseOrThrow(() => AccountNameSchema.safeParse(rawName))
    if (this.repository.existsByName(account.kind, name, id)) {
      throw new AccountError(ACCOUNT_MESSAGES.nameDuplicated)
    }
    this.repository.updateName(id, name)
    return { success: true }
  }

  deactivateAccount(id: number): { success: true } {
    const account = this.getOrThrow(id)
    if (account.defaultKey !== null) {
      throw new AccountError(ACCOUNT_MESSAGES.deactivateBlocked)
    }
    this.repository.updateStatus(id, 'inactive')
    return { success: true }
  }

  reactivateAccount(id: number): { success: true } {
    this.getOrThrow(id)
    this.repository.updateStatus(id, 'active')
    return { success: true }
  }

  deleteAccount(id: number): { success: true } {
    const account = this.getOrThrow(id)
    if (account.isDefault || this.repository.isUsed(id)) {
      throw new AccountError(ACCOUNT_MESSAGES.inUse)
    }
    this.repository.delete(id)
    return { success: true }
  }

  private getOrThrow(id: number): Account {
    const account = this.repository.findById(id)
    if (!account) {
      throw new AccountError(ACCOUNT_MESSAGES.notFound)
    }
    return account
  }
}
