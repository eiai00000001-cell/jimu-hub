import { SALES_REVENUE_KEY } from '@shared/constants/accounts'
import { calculateIncludedTax } from '@shared/calculations/included-tax'
import { RECEIPT_LIMITS } from '@shared/constants/receipt'
import { CLIENT_MESSAGES, RECEIPT_MESSAGES, RECORD_MESSAGES } from '@shared/messages/messages'
import {
  CashRecordCreateSchema,
  CashRecordDeleteSchema,
  CashRecordUpdateSchema,
  type CashRecordCreateInput,
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
import type { ReceiptView } from '@shared/types/receipt'
import type { ReceiptService, StoredReceiptFile } from './receipts/receipt.service'
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

/** 入金記録の自動作成に必要な請求書の項目 */
export interface InvoicePaymentSource {
  id: number
  invoiceNumber: string | null
  clientId: number
  paymentDate: string | null
  billingAmount: number
  withholdingTaxAmount: number
}

/** `InvoiceService`が利用する入金記録の操作(請求書の状態変更と同一トランザクション内で呼ぶ) */
export interface InvoicePaymentRecorder {
  createFromInvoicePayment(invoice: InvoicePaymentSource): { id: number }
  cancelByInvoice(invoiceId: number): { cancelledCount: number }
  findLinkedByInvoice(invoiceId: number): ReturnType<CashRecordRepository['findLinkedByInvoiceId']>
  hasRecordsForInvoice(invoiceId: number): boolean
}

/** 更新用の値(`CashRecordValues`)に含めない、自動採番・自動算出の項目 */
const NON_VALUE_KEYS = ['id', 'recordHash', 'createdAt', 'updatedAt'] as const

export const CANCEL_REASON = '請求書の入金済みを取り消しました'

export interface CashRecordServiceDeps {
  database: Database
  repository: CashRecordRepository
  receiptRepository: ReceiptRepository
  accountRepository: AccountRepository
  clientRepository: ClientRepository
  historyService: RecordHistoryService
  integrityService: IntegrityService
  /** 領収書の保存(F-22)。未指定の場合、領収書の添付はできない */
  receiptService?: ReceiptService
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
export class CashRecordService implements InvoicePaymentRecorder {
  constructor(private readonly deps: CashRecordServiceDeps) {}

  listRecords(filter: RecordListFilter): Paged<CashRecordSummary> {
    return this.deps.repository.search(filter)
  }

  /** 削除済みの記録も返す(履歴画面から読み取り専用で表示するため) */
  getRecord(id: number): CashRecordDetail {
    const record = this.deps.repository.findById(id)
    if (!record) throw new RecordError(RECORD_MESSAGES.notFound)
    const names = this.deps.repository.findNames(record)
    const integrity = this.deps.integrityService.checkRecord(id)
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
      receipts: this.toReceiptViews(id, integrity),
      history: this.deps.historyService.listByRecord(id),
      integrity
    }
  }

  createRecord(rawInput: CashRecordCreateInput): { id: number } {
    const { receiptTokens, ...input } = parseOrThrow(CashRecordCreateSchema.safeParse(rawInput))
    this.assertAccount(input.accountId, input.kind, null)
    this.assertClient(input.clientId, null)
    // 領収書のファイル保存はトランザクションの前に行い、失敗時は保存済みのファイルを削除する
    const stored = this.storeReceipts(receiptTokens)
    try {
      const result = this.deps.database.transaction(() => {
        const { id } = this.deps.repository.insert({
          ...this.toValues(input),
          withholdingTaxAmount: 0,
          invoiceId: null,
          status: 'active',
          isDeleted: false
        })
        for (const file of stored) this.deps.receiptRepository.insert({ recordId: id, ...file })
        this.commit(id, 'create', null, null)
        return { id }
      })
      this.deps.receiptService?.releaseTokens(receiptTokens)
      return result
    } catch (error) {
      this.deps.receiptService?.discard(stored)
      throw error
    }
  }

  updateRecord(rawInput: CashRecordUpdateInput): { id: number; changed: boolean } {
    const { id, reason, addReceiptTokens, removeReceiptIds, ...input } = parseOrThrow(
      CashRecordUpdateSchema.safeParse(rawInput)
    )
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

    // 外す領収書は、この記録の、外していない領収書のみ。更新後の有効件数が上限を超える場合は拒否する
    const active = this.deps.receiptRepository
      .findByRecordId(id)
      .filter((r) => r.removedAt === null)
    const removeIds = [...new Set(removeReceiptIds)]
    if (removeIds.some((rid) => !active.some((r) => r.id === rid))) {
      throw new RecordError(RECEIPT_MESSAGES.removeInvalid)
    }
    if (active.length - removeIds.length + addReceiptTokens.length > RECEIPT_LIMITS.maxPerRecord) {
      throw new RecordError(RECEIPT_MESSAGES.countExceeded)
    }
    const stored = this.storeReceipts(addReceiptTokens)

    try {
      const result = this.deps.database.transaction(() => {
        const before = this.snapshotOf(current)
        this.deps.repository.update(id, {
          ...this.toValues(input),
          withholdingTaxAmount: current.withholdingTaxAmount,
          invoiceId: current.invoiceId,
          status: current.status,
          isDeleted: false
        })
        const removedAt = new Date().toISOString()
        for (const rid of removeIds) this.deps.receiptRepository.markRemoved(rid, removedAt)
        for (const file of stored) this.deps.receiptRepository.insert({ recordId: id, ...file })
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
      this.deps.receiptService?.releaseTokens(addReceiptTokens)
      return result
    } catch (error) {
      this.deps.receiptService?.discard(stored)
      throw error
    }
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

  /**
   * [F-21]請求書を「入金済み」にしたときの入金記録の自動作成(詳細設計書4.21章)。
   * 呼び出し元(`InvoiceService`)のトランザクション内で呼ぶ。失敗時は例外とし、呼び出し元がロールバックする。
   */
  createFromInvoicePayment(invoice: InvoicePaymentSource): { id: number } {
    const account = this.deps.accountRepository.findByDefaultKey(SALES_REVENUE_KEY)
    if (!account) throw new RecordError(RECORD_MESSAGES.accountRequired)
    if (invoice.paymentDate === null) throw new RecordError(RECORD_MESSAGES.dateRequired)
    if (this.deps.repository.findActiveByInvoiceId(invoice.id)) {
      throw new RecordError(RECORD_MESSAGES.invoiceRecordExists)
    }
    const { id } = this.deps.repository.insert({
      recordDate: invoice.paymentDate,
      kind: 'income',
      amount: invoice.billingAmount,
      withholdingTaxAmount: invoice.withholdingTaxAmount,
      accountId: account.id,
      description: `請求書 ${invoice.invoiceNumber ?? ''} の入金`,
      clientId: invoice.clientId,
      paymentMethod: null,
      taxCategory: null,
      taxAmount: 0,
      invoiceId: invoice.id,
      status: 'active',
      isDeleted: false
    })
    this.commit(id, 'create', null, null)
    return { id }
  }

  /** [F-21]請求書の入金済みの取消。有効な入金記録を「取消済」にして残す(0件なら何もしない) */
  cancelByInvoice(invoiceId: number): { cancelledCount: number } {
    const target = this.deps.repository.findActiveByInvoiceId(invoiceId)
    if (!target) return { cancelledCount: 0 }
    const before = this.snapshotOf(target)
    this.deps.repository.update(target.id, { ...this.valuesOf(target), status: 'cancelled' })
    this.commit(target.id, 'cancel', CANCEL_REASON, before)
    return { cancelledCount: 1 }
  }

  findLinkedByInvoice(
    invoiceId: number
  ): ReturnType<CashRecordRepository['findLinkedByInvoiceId']> {
    return this.deps.repository.findLinkedByInvoiceId(invoiceId)
  }

  hasRecordsForInvoice(invoiceId: number): boolean {
    return this.deps.repository.existsByInvoiceId(invoiceId)
  }

  private storeReceipts(tokens: string[]): StoredReceiptFile[] {
    if (tokens.length === 0) return []
    if (!this.deps.receiptService) throw new RecordError(RECEIPT_MESSAGES.tokenInvalid)
    try {
      return this.deps.receiptService.storeFromTokens(tokens)
    } catch (error) {
      throw new RecordError(error instanceof Error ? error.message : RECEIPT_MESSAGES.storeFailure)
    }
  }

  private toReceiptViews(
    recordId: number,
    integrity: CashRecordDetail['integrity']
  ): ReceiptView[] {
    return this.deps.receiptRepository.findByRecordId(recordId).map((r) => ({
      id: r.id,
      originalName: r.originalName,
      mimeType: r.mimeType as ReceiptView['mimeType'],
      fileSize: r.fileSize,
      removed: r.removedAt !== null,
      state: integrity.receipts.find((x) => x.id === r.id)?.state ?? 'missing'
    }))
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
    const values: Partial<CashRecord> = { ...record }
    for (const key of NON_VALUE_KEYS) delete values[key]
    return values as CashRecordValues
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
