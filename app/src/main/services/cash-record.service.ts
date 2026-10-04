import { calculateIncludedTax } from '@shared/calculations/included-tax'
import { CLIENT_MESSAGES, RECORD_MESSAGES } from '@shared/messages/messages'
import {
  CashRecordDeleteSchema,
  CashRecordInputSchema,
  CashRecordUpdateSchema,
  type CashRecordDeleteInput,
  type CashRecordInput,
  type CashRecordUpdateInput
} from '@shared/schemas/cash-record.schema'
import type {
  CashRecord,
  CashRecordDetail,
  CashRecordSummary,
  HistoryOperation,
  Paged,
  RecordListFilter
} from '@shared/types/cash-record'
import type { Database } from '../db/db'
import type { AccountRepository } from '../repositories/account.repository'
import type { CashRecordRepository, CashRecordValues } from '../repositories/cash-record.repository'
import type { ClientRepository } from '../repositories/client.repository'
import type { ReceiptRepository } from '../repositories/receipt.repository'
import type { IntegrityService } from './integrity/integrity.service'
import { computeRecordHash } from './integrity/record-hash'
import type { RecordHistoryService } from './record-history.service'

/** 入出金・経費の業務エラー。メッセージは画面にそのまま表示する */
export class RecordError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RecordError'
  }
}

export interface CashRecordServiceDeps {
  database: Database
  repository: CashRecordRepository
  receiptRepository: ReceiptRepository
  accountRepository: AccountRepository
  clientRepository: ClientRepository
  historyService: RecordHistoryService
  integrityService: IntegrityService
}

function parseOrThrow<T>(
  result:
    { success: true; data: T } | { success: false; error: { issues: Array<{ message: string }> } }
): T {
  if (!result.success) {
    throw new RecordError(result.error.issues[0]?.message ?? 'Invalid input')
  }
  return result.data
}

/**
 * 入出金・経費の登録・更新・削除(論理削除)、一覧・詳細取得を担うApplication Service層。
 * 記録・履歴・記録ハッシュは同一トランザクションで更新する(履歴の記録に失敗した場合は記録も変更しない)。
 * 領収書の保存(T-46)、請求書の入金記録の自動作成・取消(T-45)は、`commit()`を経由して差し込む。
 * 参照元: 詳細設計書4.18〜4.20章、5章(`CashRecordService`)
 */
export class CashRecordService {
  constructor(private readonly deps: CashRecordServiceDeps) {}

  listRecords(filter: RecordListFilter): Paged<CashRecordSummary> {
    return this.deps.repository.search(filter)
  }

  /** 削除済みの記録も返す(履歴画面から読み取り専用で表示するため) */
  getRecord(id: number): CashRecordDetail {
    const record = this.deps.repository.findById(id)
    if (!record) throw new RecordError(RECORD_MESSAGES.notFound)
    const names = this.deps.repository.findNames(record)
    return {
      id: record.id,
      recordDate: record.recordDate,
      kind: record.kind,
      amount: record.amount,
      withholdingTaxAmount: record.withholdingTaxAmount,
      accountId: record.accountId,
      accountName: names.accountName,
      description: record.description,
      clientId: record.clientId,
      clientName: names.clientName,
      paymentMethod: record.paymentMethod,
      taxCategory: record.taxCategory,
      taxAmount: record.taxAmount,
      invoiceId: record.invoiceId,
      invoiceNumber: names.invoiceNumber,
      status: record.status,
      isDeleted: record.isDeleted,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      history: this.deps.historyService.listByRecord(id),
      integrity: this.deps.integrityService.checkRecord(id)
    }
  }

  createRecord(rawInput: CashRecordInput): { id: number } {
    const input = parseOrThrow(CashRecordInputSchema.safeParse(rawInput))
    this.assertAccount(input.accountId, input.kind, null)
    this.assertClient(input.clientId, null)
    return this.deps.database.transaction(() => {
      const { id } = this.deps.repository.insert({
        ...this.toValues(input),
        withholdingTaxAmount: 0,
        invoiceId: null,
        status: 'active',
        isDeleted: false
      })
      this.commit(id, 'create', null, null)
      return { id }
    })
  }

  updateRecord(rawInput: CashRecordUpdateInput): { id: number; changed: boolean } {
    const { id, reason, ...input } = parseOrThrow(CashRecordUpdateSchema.safeParse(rawInput))
    const current = this.deps.repository.findById(id)
    if (!current || current.isDeleted) throw new RecordError(RECORD_MESSAGES.notFound)
    if (current.status === 'cancelled') throw new RecordError(RECORD_MESSAGES.notEditable)
    if (
      current.invoiceId !== null &&
      (input.kind !== current.kind ||
        input.amount !== current.amount ||
        input.clientId !== current.clientId)
    ) {
      throw new RecordError(RECORD_MESSAGES.autoRecordFieldLocked)
    }
    this.assertAccount(input.accountId, input.kind, current.accountId)
    this.assertClient(input.clientId, current.clientId)

    return this.deps.database.transaction(() => {
      const before = this.snapshotOf(current)
      this.deps.repository.update(id, {
        ...this.toValues(input),
        withholdingTaxAmount: current.withholdingTaxAmount,
        invoiceId: current.invoiceId,
        status: current.status,
        isDeleted: false
      })
      const after = this.snapshotOf(this.requireRecord(id))
      if (JSON.stringify(before) === JSON.stringify(after)) {
        // 変更なし: 更新をロールバックして履歴を作らない(`updated_at`も変更しない)
        this.deps.repository.update(id, this.valuesOf(current))
        this.deps.repository.restoreUpdatedAt(id, current.updatedAt)
        return { id, changed: false }
      }
      this.commit(id, 'update', reason || null, before)
      return { id, changed: true }
    })
  }

  deleteRecord(rawInput: CashRecordDeleteInput): { success: true } {
    const { id, reason } = parseOrThrow(CashRecordDeleteSchema.safeParse(rawInput))
    const current = this.deps.repository.findById(id)
    if (!current || current.isDeleted) throw new RecordError(RECORD_MESSAGES.notFound)
    if (current.invoiceId !== null) throw new RecordError(RECORD_MESSAGES.autoRecordDeleteBlocked)
    this.deps.database.transaction(() => {
      const before = this.snapshotOf(current)
      this.deps.repository.update(id, { ...this.valuesOf(current), isDeleted: true })
      this.commit(id, 'delete', reason || null, before)
    })
    return { success: true }
  }

  private toValues(
    input: CashRecordInput
  ): Pick<
    CashRecordValues,
    | 'recordDate'
    | 'kind'
    | 'amount'
    | 'accountId'
    | 'description'
    | 'clientId'
    | 'paymentMethod'
    | 'taxCategory'
    | 'taxAmount'
  > {
    return {
      recordDate: input.recordDate,
      kind: input.kind,
      amount: input.amount,
      accountId: input.accountId,
      description: input.description,
      clientId: input.clientId,
      paymentMethod: input.paymentMethod,
      taxCategory: input.taxCategory,
      taxAmount: calculateIncludedTax(input.amount, input.taxCategory)
    }
  }

  private valuesOf(record: CashRecord): CashRecordValues {
    const { recordHash: _hash, createdAt: _c, updatedAt: _u, id: _id, ...values } = record
    void _hash
    void _c
    void _u
    void _id
    return values
  }

  private requireRecord(id: number): CashRecord {
    const record = this.deps.repository.findById(id)
    if (!record) throw new RecordError(RECORD_MESSAGES.notFound)
    return record
  }

  private snapshotOf(record: CashRecord): ReturnType<RecordHistoryService['buildSnapshot']> {
    return this.deps.historyService.buildSnapshot(
      record,
      this.deps.repository.findNames(record),
      this.deps.receiptRepository.findByRecordId(record.id)
    )
  }

  /**
   * 記録ハッシュを更新し、履歴を記録する(呼び出し元のトランザクション内)。
   * 履歴の記録に失敗した場合は専用の業務エラーにし、トランザクション全体をロールバックさせる。
   */
  private commit(
    id: number,
    operation: HistoryOperation,
    reason: string | null,
    before: ReturnType<RecordHistoryService['buildSnapshot']> | null
  ): void {
    const record = this.requireRecord(id)
    const receipts = this.deps.receiptRepository.findByRecordId(id)
    const hash = computeRecordHash(record, receipts)
    this.deps.repository.updateHash(id, hash)
    const after = this.snapshotOf(record)
    try {
      this.deps.historyService.record({
        recordId: id,
        operation,
        reason,
        before,
        after,
        recordHashAfter: hash
      })
    } catch {
      throw new RecordError(RECORD_MESSAGES.historyWriteFailure)
    }
  }

  /** 勘定科目の確認。利用停止の科目は、現在選択済み(`currentId`)と同じ場合のみ許可する */
  private assertAccount(
    accountId: number,
    kind: CashRecordInput['kind'],
    currentId: number | null
  ): void {
    const account = this.deps.accountRepository.findById(accountId)
    if (!account) throw new RecordError(RECORD_MESSAGES.accountRequired)
    if (account.kind !== kind) throw new RecordError(RECORD_MESSAGES.accountKindMismatch)
    if (account.status !== 'active' && accountId !== currentId) {
      throw new RecordError(RECORD_MESSAGES.inactiveNotSelectable)
    }
  }

  private assertClient(clientId: number | null, currentId: number | null): void {
    if (clientId === null) return
    const client = this.deps.clientRepository.findById(clientId)
    if (!client) throw new RecordError(CLIENT_MESSAGES.notFound)
    if (client.status !== 'active' && clientId !== currentId) {
      throw new RecordError(RECORD_MESSAGES.inactiveNotSelectable)
    }
  }
}
