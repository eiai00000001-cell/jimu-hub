import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { Database } from '../db/db'
import { CashRecordHistoryRepository } from '../repositories/cash-record-history.repository'
import { RecordHistoryService } from './record-history.service'

const names = { accountName: '通信費', clientName: null, invoiceNumber: null }
const record = {
  id: 1,
  recordDate: '2026-09-28',
  kind: 'expense' as const,
  amount: 6600,
  withholdingTaxAmount: 0,
  accountId: 1,
  description: 'インターネット回線',
  clientId: null,
  paymentMethod: null,
  taxCategory: null,
  taxAmount: 0,
  invoiceId: null,
  status: 'active' as const,
  isDeleted: false
}

describe('RecordHistoryService(F-20)', () => {
  let db: Database
  let repo: CashRecordHistoryRepository
  let service: RecordHistoryService

  beforeEach(() => {
    db = new Database(':memory:')
    db.initialize()
    db.sqlite
      .prepare(
        "INSERT INTO cash_records (record_date, kind, amount, account_id, description) VALUES ('2026-09-28', 'expense', 6600, 1, 'x')"
      )
      .run()
    repo = new CashRecordHistoryRepository(db)
    service = new RecordHistoryService(repo)
  })
  afterEach(() => db.close())

  it('スナップショットは領収書をid順に含み、キー順が固定される', () => {
    const snap = service.buildSnapshot(record, names, [
      {
        id: 2,
        recordId: 1,
        originalName: 'b',
        filePath: 'p',
        mimeType: 'application/pdf',
        fileSize: 1,
        sha256: 'b',
        attachedAt: 'x',
        removedAt: null
      },
      {
        id: 1,
        recordId: 1,
        originalName: 'a',
        filePath: 'p',
        mimeType: 'application/pdf',
        fileSize: 1,
        sha256: 'a',
        attachedAt: 'x',
        removedAt: 'y'
      }
    ])
    expect(Object.keys(snap)).toEqual([
      'recordDate',
      'kind',
      'amount',
      'withholdingTaxAmount',
      'accountId',
      'accountName',
      'description',
      'clientId',
      'clientName',
      'paymentMethod',
      'taxCategory',
      'taxAmount',
      'invoiceId',
      'invoiceNumber',
      'status',
      'isDeleted',
      'receipts'
    ])
    expect(snap.receipts.map((r) => [r.id, r.removed])).toEqual([
      [1, true],
      [2, false]
    ])
  })

  it('履歴を記録し、記録ごと・全体で新しい順に差分つきで取得できる。履歴の更新・削除はトリガーで拒否される', () => {
    const create = service.buildSnapshot(record, names, [])
    service.record({
      recordId: 1,
      operation: 'create',
      reason: null,
      before: null,
      after: create,
      recordHashAfter: 'h1'
    })
    const updated = { ...create, amount: 7000 }
    service.record({
      recordId: 1,
      operation: 'update',
      reason: '金額訂正',
      before: create,
      after: updated,
      recordHashAfter: 'h2'
    })

    const byRecord = service.listByRecord(1)
    expect(byRecord.map((h) => h.operation)).toEqual(['update', 'create'])
    expect(byRecord[0]!.changes).toEqual([{ label: '金額', before: '¥6,600', after: '¥7,000' }])
    expect(byRecord[0]!.reason).toBe('金額訂正')

    const all = service.listHistory({})
    expect(all.totalCount).toBe(2)
    expect(all.items[0]).toMatchObject({
      operation: 'update',
      recordDate: '2026-09-28',
      description: 'インターネット回線'
    })
    expect(service.listHistory({ operation: 'create' }).totalCount).toBe(1)
    expect(repo.findLatestByRecordId(1)?.recordHashAfter).toBe('h2')
    expect(() => db.sqlite.prepare('DELETE FROM cash_record_history').run()).toThrow(
      '履歴は削除できません'
    )
  })

  it('操作日(ローカル日付)で絞り込める', () => {
    service.record({
      recordId: 1,
      operation: 'create',
      reason: null,
      before: null,
      after: service.buildSnapshot(record, names, []),
      recordHashAfter: 'h'
    })
    const today = new Date()
    const pad = (n: number): string => String(n).padStart(2, '0')
    const ymd = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
    expect(service.listHistory({ dateFrom: ymd, dateTo: ymd }).totalCount).toBe(1)
    expect(service.listHistory({ dateFrom: '2000-01-01', dateTo: '2000-01-02' }).totalCount).toBe(0)
  })
})
