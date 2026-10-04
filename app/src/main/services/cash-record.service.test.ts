import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { Database } from '../db/db'
import { AccountRepository } from '../repositories/account.repository'
import { CashRecordHistoryRepository } from '../repositories/cash-record-history.repository'
import { CashRecordRepository } from '../repositories/cash-record.repository'
import { ClientRepository } from '../repositories/client.repository'
import { ReceiptRepository } from '../repositories/receipt.repository'
import { CashRecordService, RecordError } from './cash-record.service'
import { IntegrityService } from './integrity/integrity.service'
import { RecordHistoryService } from './record-history.service'
import type { CashRecordInput } from '@shared/schemas/cash-record.schema'

describe('CashRecordService(F-18・F-19・F-20)', () => {
  let db: Database
  let service: CashRecordService
  let accounts: AccountRepository
  let clients: ClientRepository
  let expenseId: number
  let incomeId: number
  let clientId: number

  const input = (over: Partial<CashRecordInput> = {}): CashRecordInput => ({
    kind: 'expense',
    recordDate: '2026-09-28',
    amount: 6600,
    accountId: expenseId,
    description: 'インターネット回線(9月分)',
    clientId: null,
    paymentMethod: null,
    taxCategory: 'standard_10',
    ...over
  })

  beforeEach(() => {
    db = new Database(':memory:')
    db.initialize()
    accounts = new AccountRepository(db)
    clients = new ClientRepository(db)
    const recordRepo = new CashRecordRepository(db)
    const historyRepo = new CashRecordHistoryRepository(db)
    const receiptRepo = new ReceiptRepository(db)
    service = new CashRecordService({
      database: db,
      repository: recordRepo,
      receiptRepository: receiptRepo,
      accountRepository: accounts,
      clientRepository: clients,
      historyService: new RecordHistoryService(historyRepo),
      integrityService: new IntegrityService(recordRepo, receiptRepo, historyRepo)
    })
    expenseId = accounts.findAll({ kind: 'expense' })[0]!.id
    incomeId = accounts.findAll({ kind: 'income' })[0]!.id
    clientId = clients.insert({
      name: 'サンプル商事株式会社',
      furigana: '',
      honorific: '御中',
      contactPerson: '',
      postalCode: '',
      address: '',
      phone: '',
      email: '',
      invoiceRegistrationNumber: '',
      memo: ''
    }).id
  })
  afterEach(() => db.close())

  describe('createRecord', () => {
    it('登録すると消費税額を算出し、記録ハッシュと履歴(登録)を同時に作る', () => {
      const { id } = service.createRecord(input())
      const detail = service.getRecord(id)
      expect(detail).toMatchObject({
        kind: 'expense',
        amount: 6600,
        taxAmount: 600,
        status: 'active',
        isDeleted: false,
        accountName: '通信費',
        invoiceId: null
      })
      expect(detail.history).toHaveLength(1)
      expect(detail.history[0]).toMatchObject({ operation: 'create', reason: null })
      expect(detail.integrity).toEqual({ recordHashOk: true, historyHashOk: true })
      const row = db.sqlite
        .prepare('SELECT record_hash FROM cash_records WHERE id = ?')
        .get(id) as { record_hash: string }
      expect(row.record_hash).toMatch(/^[0-9a-f]{64}$/)
    })

    it('摘要の前後空白を除去して保存する。不正な入力はRecordErrorで拒否し何も保存しない', () => {
      const { id } = service.createRecord(input({ description: '  メモ  ' }))
      expect(service.getRecord(id).description).toBe('メモ')
      expect(() => service.createRecord(input({ amount: 0 }))).toThrow(
        '金額は1円以上9,999,999,999円以下の整数で入力してください'
      )
      expect(() => service.createRecord(input({ description: ' ' }))).toThrow(RecordError)
      expect(service.listRecords({}).totalCount).toBe(1)
    })

    it('勘定科目: 区分の不一致・利用停止・存在しないものを拒否する', () => {
      expect(() => service.createRecord(input({ accountId: incomeId }))).toThrow(
        '勘定科目が種別と一致しません'
      )
      accounts.updateStatus(expenseId, 'inactive')
      expect(() => service.createRecord(input())).toThrow(
        '利用停止中の勘定科目・取引先は選択できません'
      )
      expect(() => service.createRecord(input({ accountId: 99999 }))).toThrow(
        '勘定科目を選択してください'
      )
    })

    it('取引先: 利用停止・存在しないものを拒否し、利用中なら登録できる', () => {
      expect(() => service.createRecord(input({ clientId: 99999 }))).toThrow(
        '指定された取引先が見つかりません'
      )
      const { id } = service.createRecord(input({ clientId }))
      expect(service.getRecord(id).clientName).toBe('サンプル商事株式会社')
      clients.updateStatus(clientId, 'inactive')
      expect(() => service.createRecord(input({ clientId }))).toThrow(
        '利用停止中の勘定科目・取引先は選択できません'
      )
    })

    it('履歴の記録に失敗した場合は記録もロールバックし、専用のエラーを返す', () => {
      db.sqlite.exec('DROP TABLE cash_record_history')
      expect(() => service.createRecord(input())).toThrow(
        '履歴を記録できなかったため、変更できませんでした'
      )
      const count = db.sqlite.prepare('SELECT COUNT(*) AS c FROM cash_records').get() as {
        c: number
      }
      expect(count.c).toBe(0)
    })
  })

  describe('updateRecord', () => {
    it('変更すると消費税額を再計算し、記録ハッシュを更新して履歴(変更・理由)を追加する', () => {
      const { id } = service.createRecord(input())
      const result = service.updateRecord({
        ...input({ amount: 11000, paymentMethod: 'transfer' }),
        id,
        reason: '金額訂正'
      })
      expect(result).toEqual({ id, changed: true })
      const detail = service.getRecord(id)
      expect(detail).toMatchObject({ amount: 11000, taxAmount: 1000, paymentMethod: 'transfer' })
      expect(detail.history[0]).toMatchObject({ operation: 'update', reason: '金額訂正' })
      expect(detail.history[0]!.changes.map((c) => c.label)).toEqual([
        '金額',
        '支払方法',
        '消費税額'
      ])
      expect(detail.integrity.recordHashOk).toBe(true)
      expect(detail.integrity.historyHashOk).toBe(true)
    })

    it('変更が無い場合はchanged: falseで、履歴を作らない', () => {
      const { id } = service.createRecord(input())
      expect(service.updateRecord({ ...input(), id })).toEqual({ id, changed: false })
      expect(service.getRecord(id).history).toHaveLength(1)
    })

    it('存在しない・削除済みはrecordNotFound、取消済は編集不可', () => {
      expect(() => service.updateRecord({ ...input(), id: 999 })).toThrow(
        '対象の記録が見つかりません'
      )
      const { id } = service.createRecord(input())
      service.deleteRecord({ id })
      expect(() => service.updateRecord({ ...input(), id })).toThrow('対象の記録が見つかりません')
      const cancelled = service.createRecord(input())
      db.sqlite
        .prepare("UPDATE cash_records SET status = 'cancelled' WHERE id = ?")
        .run(cancelled.id)
      expect(() => service.updateRecord({ ...input(), id: cancelled.id })).toThrow(
        '取消済の記録は編集できません'
      )
    })

    it('利用停止の科目・取引先は、現在値と同じ場合のみ許可する', () => {
      const { id } = service.createRecord(input({ clientId }))
      accounts.updateStatus(expenseId, 'inactive')
      clients.updateStatus(clientId, 'inactive')
      expect(() =>
        service.updateRecord({ ...input({ clientId, description: '変更' }), id })
      ).not.toThrow()
      const other = accounts.findAll({ kind: 'expense' })[0]!.id
      expect(other).not.toBe(expenseId)
      accounts.updateStatus(other, 'inactive')
      expect(() => service.updateRecord({ ...input({ accountId: other, clientId }), id })).toThrow(
        '利用停止中の勘定科目・取引先は選択できません'
      )
    })

    it('請求書から作成された記録は、種別・金額・取引先の変更を拒否し、源泉徴収税額・請求書は維持する', () => {
      const { id } = service.createRecord(
        input({ kind: 'income', accountId: incomeId, taxCategory: null })
      )
      db.sqlite.exec(
        `INSERT INTO invoices (client_id, issue_date, status, created_at, updated_at) VALUES (${clientId}, '2026-09-01', 'draft', 'x', 'x');
         UPDATE cash_records SET invoice_id = 1, withholding_tax_amount = 500 WHERE id = ${id}`
      )
      const base = input({ kind: 'income', accountId: incomeId, taxCategory: null })
      expect(() => service.updateRecord({ ...base, id, amount: 1 })).toThrow(
        '請求書から作成された入金記録の種別・金額・取引先は変更できません'
      )
      expect(() => service.updateRecord({ ...base, id, clientId })).toThrow(RecordError)
      service.updateRecord({ ...base, id, description: '摘要のみ変更' })
      const row = db.sqlite
        .prepare('SELECT invoice_id, withholding_tax_amount FROM cash_records WHERE id = ?')
        .get(id)
      expect(row).toEqual({ invoice_id: 1, withholding_tax_amount: 500 })
    })
  })

  describe('deleteRecord', () => {
    it('論理削除し、一覧から除外、詳細は読み取り専用で取得でき、履歴(削除)を残す', () => {
      const { id } = service.createRecord(input())
      expect(service.deleteRecord({ id, reason: '二重登録' })).toEqual({ success: true })
      expect(service.listRecords({}).totalCount).toBe(0)
      const detail = service.getRecord(id)
      expect(detail.isDeleted).toBe(true)
      expect(detail.history[0]).toMatchObject({ operation: 'delete', reason: '二重登録' })
      expect(detail.integrity.recordHashOk).toBe(true)
      expect(() => service.deleteRecord({ id })).toThrow('対象の記録が見つかりません')
    })

    it('請求書から作成された記録は削除できない', () => {
      const { id } = service.createRecord(input({ kind: 'income', accountId: incomeId }))
      db.sqlite.exec(
        `INSERT INTO invoices (client_id, issue_date, status, created_at, updated_at) VALUES (${clientId}, '2026-09-01', 'draft', 'x', 'x');
         UPDATE cash_records SET invoice_id = 1 WHERE id = ${id}`
      )
      expect(() => service.deleteRecord({ id })).toThrow(
        '請求書側で入金済みを取り消すと、この入金記録は取消済になります'
      )
      expect(service.getRecord(id).isDeleted).toBe(false)
    })
  })

  describe('listRecords', () => {
    beforeEach(() => {
      service.createRecord(input({ recordDate: '2026-09-01', amount: 1000, description: 'a' }))
      service.createRecord(
        input({ recordDate: '2026-09-15', amount: 5000, description: 'b', clientId })
      )
      service.createRecord(
        input({
          recordDate: '2026-09-15',
          kind: 'income',
          accountId: incomeId,
          amount: 9000,
          description: 'c'
        })
      )
    })

    it('日付降順・同日はid降順で返す', () => {
      expect(service.listRecords({}).items.map((r) => r.description)).toEqual(['c', 'b', 'a'])
    })

    it('条件をANDで絞り込む(日付・金額・取引先・科目・種別)', () => {
      expect(service.listRecords({ dateFrom: '2026-09-10' }).totalCount).toBe(2)
      expect(service.listRecords({ dateTo: '2026-09-10' }).totalCount).toBe(1)
      expect(
        service.listRecords({ amountMin: 2000, amountMax: 6000 }).items.map((r) => r.description)
      ).toEqual(['b'])
      expect(service.listRecords({ clientId }).totalCount).toBe(1)
      expect(service.listRecords({ accountId: incomeId }).totalCount).toBe(1)
      expect(service.listRecords({ kind: 'expense', dateFrom: '2026-09-10' }).totalCount).toBe(1)
    })

    it('取消済は含め、削除済みは含めない。領収書の件数・参照名を返す', () => {
      const all = service.listRecords({}).items
      db.sqlite.prepare("UPDATE cash_records SET status = 'cancelled' WHERE id = ?").run(all[0]!.id)
      service.deleteRecord({ id: all[2]!.id })
      const items = service.listRecords({}).items
      expect(items).toHaveLength(2)
      expect(items[0]).toMatchObject({
        status: 'cancelled',
        accountName: expect.any(String),
        receiptCount: 0
      })
    })

    it('1ページ50件でページ送りできる', () => {
      for (let i = 0; i < 52; i++) service.createRecord(input({ description: `n${i}` }))
      const page1 = service.listRecords({})
      expect(page1).toMatchObject({ totalCount: 55, page: 1, pageSize: 50 })
      expect(page1.items).toHaveLength(50)
      expect(service.listRecords({ page: 2 }).items).toHaveLength(5)
    })
  })

  describe('getRecord(改変検知)', () => {
    it('DBを直接書き換えると記録の改変を検知し、存在しないidはエラー', () => {
      const { id } = service.createRecord(input())
      db.sqlite.prepare('UPDATE cash_records SET amount = 1 WHERE id = ?').run(id)
      expect(service.getRecord(id).integrity.recordHashOk).toBe(false)
      expect(() => service.getRecord(999)).toThrow('対象の記録が見つかりません')
    })

    it('履歴の最新ハッシュと記録ハッシュが異なる場合を検知する', () => {
      const { id } = service.createRecord(input())
      db.sqlite.prepare("UPDATE cash_records SET record_hash = 'x' WHERE id = ?").run(id)
      const integrity = service.getRecord(id).integrity
      expect(integrity.historyHashOk).toBe(false)
    })
  })
})
