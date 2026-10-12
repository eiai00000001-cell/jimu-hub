import { ProjectRepository } from '../repositories/project.repository'
import { ProjectLinkService } from './project-link.service'
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { Database } from '../db/db'
import { AccountRepository } from '../repositories/account.repository'
import { CashRecordHistoryRepository } from '../repositories/cash-record-history.repository'
import { CashRecordRepository } from '../repositories/cash-record.repository'
import { ClientRepository } from '../repositories/client.repository'
import { ReceiptRepository } from '../repositories/receipt.repository'
import { CashRecordService, RecordError } from './cash-record.service'
import { mkdtempSync, readdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IntegrityService } from './integrity/integrity.service'
import { ReceiptService } from './receipts/receipt.service'
import { ReceiptStagingStore } from './receipts/receipt-staging-store'
import { RecordHistoryService } from './record-history.service'
import type { CashRecordInput } from '@shared/schemas/cash-record.schema'

describe('CashRecordService(F-18・F-19・F-20)', () => {
  let db: Database
  let service: CashRecordService
  let accounts: AccountRepository
  let clients: ClientRepository
  let work: string
  let receiptService: ReceiptService
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
    work = mkdtempSync(join(tmpdir(), 'jimuhub-crs-'))
    receiptService = new ReceiptService(join(work, 'documents'), new ReceiptStagingStore())
    service = new CashRecordService({
      database: db,
      projectLinkService: new ProjectLinkService(db, new ProjectRepository(db)),
      repository: recordRepo,
      receiptRepository: receiptRepo,
      accountRepository: accounts,
      clientRepository: clients,
      historyService: new RecordHistoryService(historyRepo),
      integrityService: new IntegrityService(
        recordRepo,
        receiptRepo,
        historyRepo,
        join(work, 'documents')
      ),
      receiptService
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
      expect(detail.integrity).toMatchObject({ recordHashOk: true, historyHashOk: true })
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

    it('[電帳法]日付・金額・取引先の3条件を同時に指定した検索で、すべてを満たす記録のみを返す', () => {
      service.createRecord(
        input({ recordDate: '2026-09-15', amount: 5000, description: 'x', clientId })
      )
      service.createRecord(input({ recordDate: '2026-09-16', amount: 5000, description: 'y' }))
      const result = service.listRecords({
        dateFrom: '2026-09-10',
        dateTo: '2026-09-30',
        amountMin: 4000,
        amountMax: 6000,
        clientId
      })
      expect(result.items.map((r) => r.description)).toEqual(['x', 'b'])
      expect(
        service.listRecords({
          dateFrom: '2026-09-16',
          dateTo: '2026-09-16',
          amountMin: 5000,
          amountMax: 5000,
          clientId
        }).totalCount
      ).toBe(0)
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

  describe('請求書の入金記録の自動作成・取消(F-21。詳細設計書4.21章)', () => {
    let invoiceId: number
    const source = () => ({
      id: invoiceId,
      invoiceNumber: '2026-012',
      clientId,
      paymentDate: '2026-09-30',
      billingAmount: 332370,
      withholdingTaxAmount: 10210
    })

    beforeEach(() => {
      invoiceId = Number(
        db.sqlite
          .prepare(
            "INSERT INTO invoices (client_id, issue_date, invoice_number, status, created_at, updated_at) VALUES (?, '2026-09-01', '2026-012', 'finalized', 'x', 'x')"
          )
          .run(clientId).lastInsertRowid
      )
    })

    it('売上高・源泉徴収後の金額・取引先・入金日で作成し、税区分は未選択、履歴(登録)を残す', () => {
      const { id } = service.createFromInvoicePayment(source())
      const detail = service.getRecord(id)
      expect(detail).toMatchObject({
        kind: 'income',
        recordDate: '2026-09-30',
        amount: 332370,
        withholdingTaxAmount: 10210,
        accountName: '売上高',
        clientId,
        invoiceId,
        invoiceNumber: '2026-012',
        description: '請求書 2026-012 の入金',
        paymentMethod: null,
        taxCategory: null,
        taxAmount: 0,
        status: 'active'
      })
      expect(detail.history).toHaveLength(1)
      expect(detail.history[0]).toMatchObject({ operation: 'create', reason: null })
      expect(detail.integrity).toMatchObject({ recordHashOk: true, historyHashOk: true })
    })

    it('売上高の名称を変更していても、default_keyで参照して作成できる。科目が無ければ例外', () => {
      const sales = accounts
        .findAll({ kind: 'income' })
        .find((a) => a.defaultKey === 'sales_revenue')!
      accounts.updateName(sales.id, '売上')
      expect(service.getRecord(service.createFromInvoicePayment(source()).id).accountName).toBe(
        '売上'
      )
      const other = Number(
        db.sqlite
          .prepare(
            "INSERT INTO invoices (client_id, issue_date, status, created_at, updated_at) VALUES (?, '2026-09-01', 'finalized', 'x', 'x')"
          )
          .run(clientId).lastInsertRowid
      )
      db.sqlite.exec("UPDATE accounts SET default_key = NULL WHERE default_key = 'sales_revenue'")
      expect(() => service.createFromInvoicePayment({ ...source(), id: other })).toThrow()
    })

    it('有効な入金記録がある請求書へは作成できない', () => {
      service.createFromInvoicePayment(source())
      expect(() => service.createFromInvoicePayment(source())).toThrow()
    })

    it('取消すると「取消済」で残し、履歴(取消・理由)と記録ハッシュを更新する。再作成は新しい記録になる(R-29)', () => {
      const first = service.createFromInvoicePayment(source()).id
      expect(service.cancelByInvoice(invoiceId)).toEqual({ cancelledCount: 1 })
      const cancelled = service.getRecord(first)
      expect(cancelled.status).toBe('cancelled')
      expect(cancelled.history[0]).toMatchObject({
        operation: 'cancel',
        reason: '請求書の入金済みを取り消しました'
      })
      expect(cancelled.integrity).toMatchObject({ recordHashOk: true, historyHashOk: true })
      expect(service.listRecords({}).items[0]).toMatchObject({ id: first, status: 'cancelled' })

      const second = service.createFromInvoicePayment(source()).id
      expect(second).not.toBe(first)
      expect(service.findLinkedByInvoice(invoiceId).map((r) => [r.id, r.status])).toEqual([
        [second, 'active'],
        [first, 'cancelled']
      ])
    })

    it('入金記録が無い請求書(イテレーション1の入金済み等)の取消は何もしない', () => {
      expect(service.cancelByInvoice(invoiceId)).toEqual({ cancelledCount: 0 })
    })

    it('自動作成記録は摘要等を編集でき、請求書側の入金日・金額には影響しない。取消済は編集できない', () => {
      const id = service.createFromInvoicePayment(source()).id
      const result = service.updateRecord({
        id,
        kind: 'income',
        recordDate: '2026-10-05',
        amount: 332370,
        accountId: accounts.findAll({ kind: 'income' })[1]!.id,
        description: '摘要を変更',
        clientId,
        paymentMethod: 'transfer',
        taxCategory: 'not_applicable'
      })
      expect(result.changed).toBe(true)
      const inv = db.sqlite
        .prepare('SELECT payment_date FROM invoices WHERE id = ?')
        .get(invoiceId) as {
        payment_date: string | null
      }
      expect(inv.payment_date).toBeNull()
      service.cancelByInvoice(invoiceId)
      expect(() =>
        service.updateRecord({
          id,
          kind: 'income',
          recordDate: '2026-10-05',
          amount: 332370,
          accountId: accounts.findAll({ kind: 'income' })[1]!.id,
          description: 'x',
          clientId,
          paymentMethod: null,
          taxCategory: null
        })
      ).toThrow('取消済の記録は編集できません')
    })

    it('hasRecordsは削除済み・取消済を含め、請求書に紐づく記録の有無を返す', () => {
      expect(service.hasRecordsForInvoice(invoiceId)).toBe(false)
      service.createFromInvoicePayment(source())
      expect(service.hasRecordsForInvoice(invoiceId)).toBe(true)
    })
  })

  describe('領収書の添付・取り外し(F-22。詳細設計書4.18・4.22章)', () => {
    /** ダミーの領収書(実ファイルは使わない) */
    const pdf = (tag: string): Buffer => Buffer.from(`%PDF-1.4\n${tag}`)
    const stage = (name: string, content: Buffer): string => {
      const p = join(work, name)
      writeFileSync(p, content)
      return receiptService.pickAndStage([p]).files[0]!.token
    }
    const receiptDir = (): string => join(work, 'documents', 'receipts')
    const countFiles = (): number =>
      existsSync(receiptDir())
        ? readdirSync(receiptDir(), { recursive: true, withFileTypes: true }).filter((e) =>
            e.isFile()
          ).length
        : 0

    it('登録時に領収書を添付すると、receipts・履歴・記録ハッシュに反映され、詳細で照合結果okを返す', () => {
      const token = stage('a.pdf', pdf('a'))
      const { id } = service.createRecord({ ...input(), receiptTokens: [token] })
      const detail = service.getRecord(id)
      expect(detail.receipts).toEqual([
        {
          id: expect.any(Number),
          originalName: 'a.pdf',
          mimeType: 'application/pdf',
          fileSize: pdf('a').length,
          removed: false,
          state: 'ok'
        }
      ])
      expect(detail.integrity.receipts).toEqual([{ id: detail.receipts[0]!.id, state: 'ok' }])
      expect(detail.integrity).toMatchObject({ recordHashOk: true, historyHashOk: true })
      expect(service.listRecords({}).items[0]!.receiptCount).toBe(1)
      expect(countFiles()).toBe(1)
    })

    it('更新で領収書を追加・外すと、外した領収書はファイルを残して履歴に記録される(★E13)', () => {
      const first = stage('a.pdf', pdf('a'))
      const { id } = service.createRecord({ ...input(), receiptTokens: [first] })
      const receiptId = service.getRecord(id).receipts[0]!.id
      const second = stage('b.pdf', pdf('b'))
      const result = service.updateRecord({
        ...input(),
        id,
        addReceiptTokens: [second],
        removeReceiptIds: [receiptId],
        reason: '差し替え'
      })
      expect(result.changed).toBe(true)
      const detail = service.getRecord(id)
      expect(detail.receipts.map((r) => [r.originalName, r.removed])).toEqual([
        ['a.pdf', true],
        ['b.pdf', false]
      ])
      expect(detail.history[0]!.changes).toContainEqual({
        label: '領収書',
        before: '(なし)',
        after: '追加: b.pdf、外した: a.pdf'
      })
      expect(detail.integrity).toMatchObject({ recordHashOk: true, historyHashOk: true })
      expect(detail.integrity.receipts.every((r) => r.state === 'ok')).toBe(true)
      expect(service.listRecords({}).items[0]!.receiptCount).toBe(1)
      expect(countFiles()).toBe(2)
    })

    it('領収書は1つの記録につき有効5件まで(登録・更新とも)。超過時はファイルを保存しない', () => {
      const tokens = Array.from({ length: 6 }, (_, i) => stage(`r${i}.pdf`, pdf(String(i))))
      expect(() => service.createRecord({ ...input(), receiptTokens: tokens })).toThrow(
        '領収書は1つの記録につき5件までです'
      )
      expect(countFiles()).toBe(0)
      const { id } = service.createRecord({ ...input(), receiptTokens: tokens.slice(0, 5) })
      const extra = stage('x.pdf', pdf('x'))
      expect(() => service.updateRecord({ ...input(), id, addReceiptTokens: [extra] })).toThrow(
        '領収書は1つの記録につき5件までです'
      )
      expect(countFiles()).toBe(5)
      const ids = service.getRecord(id).receipts.map((r) => r.id)
      expect(() =>
        service.updateRecord({
          ...input(),
          id,
          addReceiptTokens: [extra],
          removeReceiptIds: [ids[0]!]
        })
      ).not.toThrow()
    })

    it('他の記録の領収書・既に外した領収書は外せない', () => {
      const a = service.createRecord({ ...input(), receiptTokens: [stage('a.pdf', pdf('a'))] }).id
      const b = service.createRecord({ ...input(), receiptTokens: [stage('b.pdf', pdf('b'))] }).id
      const aReceipt = service.getRecord(a).receipts[0]!.id
      expect(() =>
        service.updateRecord({ ...input(), id: b, removeReceiptIds: [aReceipt] })
      ).toThrow('外す領収書の指定が正しくありません')
      service.updateRecord({ ...input(), id: a, removeReceiptIds: [aReceipt] })
      expect(() =>
        service.updateRecord({ ...input(), id: a, removeReceiptIds: [aReceipt] })
      ).toThrow('外す領収書の指定が正しくありません')
    })

    it('無効な識別子は拒否する。履歴の記録に失敗した場合は、保存した領収書ファイルも削除する', () => {
      expect(() => service.createRecord({ ...input(), receiptTokens: ['unknown'] })).toThrow(
        '選択したファイルが無効になりました。もう一度ファイルを選択してください'
      )
      const token = stage('a.pdf', pdf('a'))
      db.sqlite.exec('DROP TABLE cash_record_history')
      expect(() => service.createRecord({ ...input(), receiptTokens: [token] })).toThrow(
        '履歴を記録できなかったため、変更できませんでした'
      )
      expect(countFiles()).toBe(0)
      const rows = db.sqlite.prepare('SELECT COUNT(*) AS c FROM receipts').get() as { c: number }
      expect(rows.c).toBe(0)
    })

    it('領収書ファイルの改変・欠落を検知する(外した領収書も照合する)', () => {
      const { id } = service.createRecord({
        ...input(),
        receiptTokens: [stage('a.pdf', pdf('a')), stage('b.pdf', pdf('b'))]
      })
      const row = db.sqlite
        .prepare('SELECT id, file_path FROM receipts ORDER BY id')
        .all() as Array<{ id: number; file_path: string }>
      writeFileSync(join(work, 'documents', row[0]!.file_path), Buffer.from('%PDF-1.4\ntampered'))
      rmSync(join(work, 'documents', row[1]!.file_path))
      const integrity = service.getRecord(id).integrity
      expect(integrity.receipts).toEqual([
        { id: row[0]!.id, state: 'mismatch' },
        { id: row[1]!.id, state: 'missing' }
      ])
      expect(integrity.recordHashOk).toBe(true)
    })

    it('保存先がreceipts配下でない(改ざんされたfile_path)領収書はmissingとして扱う', () => {
      const { id } = service.createRecord({ ...input(), receiptTokens: [stage('a.pdf', pdf('a'))] })
      db.sqlite.exec("UPDATE receipts SET file_path = '../../etc/hosts.pdf'")
      expect(service.getRecord(id).integrity.receipts[0]!.state).toBe('missing')
      expect(existsSync(join(work, 'documents'))).toBe(true)
      expect(
        readFileSync(
          join(
            work,
            'documents',
            'receipts',
            String(new Date().getFullYear()),
            readdirSync(join(work, 'documents', 'receipts', String(new Date().getFullYear())))[0]!
          )
        ).length
      ).toBeGreaterThan(0)
    })
  })
})
