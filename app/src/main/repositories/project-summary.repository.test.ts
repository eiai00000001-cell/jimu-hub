import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Database } from '../db/db'
import { ProjectSummaryRepository } from './project-summary.repository'

describe('ProjectSummaryRepository(F-31。詳細設計書4.31章)', () => {
  let dir: string
  let db: Database
  let repository: ProjectSummaryRepository
  let clientId: number
  let accountId: number
  let a: number
  let b: number

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'project-summary-test-'))
    db = new Database(join(dir, 'data.sqlite'))
    db.initialize()
    repository = new ProjectSummaryRepository(db)
    clientId = Number(
      db.sqlite.prepare("INSERT INTO clients (name, honorific) VALUES ('取引先', '御中')").run()
        .lastInsertRowid
    )
    accountId = (db.sqlite.prepare('SELECT id FROM accounts LIMIT 1').get() as { id: number }).id
    const insertProject = db.sqlite.prepare('INSERT INTO projects (name) VALUES (?)')
    a = Number(insertProject.run('A').lastInsertRowid)
    b = Number(insertProject.run('B').lastInsertRowid)
  })
  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const invoice = (
    projectId: number | null,
    status: string,
    total: number,
    withholding = 0
  ): void => {
    db.sqlite
      .prepare(
        `INSERT INTO invoices (client_id, issue_date, status, total_amount, withholding_tax_amount, project_id)
         VALUES (?, '2026-10-01', ?, ?, ?, ?)`
      )
      .run(clientId, status, total, withholding, projectId)
  }
  const record = (
    projectId: number | null,
    kind: 'income' | 'expense',
    amount: number,
    status = 'active',
    deleted = 0
  ): void => {
    db.sqlite
      .prepare(
        `INSERT INTO cash_records (record_date, kind, amount, account_id, description, status, is_deleted, project_id)
         VALUES ('2026-10-01', ?, ?, ?, 'x', ?, ?, ?)`
      )
      .run(kind, amount, accountId, status, deleted, projectId)
  }
  const quote = (projectId: number | null): void => {
    db.sqlite
      .prepare(
        "INSERT INTO quotes (client_id, issue_date, status, total_amount, project_id) VALUES (?, '2026-10-01', 'finalized', 999999, ?)"
      )
      .run(clientId, projectId)
  }

  it('紐づくデータが無い案件は、すべて0', () => {
    expect(repository.summary(a)).toEqual({
      sales: 0,
      withholding: 0,
      expense: 0,
      balance: 0,
      counts: { quotes: 0, invoicesIssued: 0, invoicesDraft: 0, incomes: 0, expenses: 0 }
    })
  })

  it('売上は、発行済みの請求書の合計金額(源泉徴収前)のみ。下書き・見積書・入金記録は含めない', () => {
    invoice(a, 'finalized', 363000, 30630)
    invoice(a, 'finalized', 100000)
    invoice(a, 'draft', 777000, 1000)
    quote(a)
    record(a, 'income', 555000)

    const summary = repository.summary(a)

    expect(summary.sales).toBe(463000)
    expect(summary.withholding).toBe(30630)
    expect(summary.counts).toMatchObject({
      quotes: 1,
      invoicesIssued: 2,
      invoicesDraft: 1,
      incomes: 1
    })
  })

  it('入金済みかどうかは売上に影響しない', () => {
    invoice(a, 'finalized', 1000)
    db.sqlite.exec("UPDATE invoices SET payment_status = 'paid', payment_date = '2026-10-02'")
    expect(repository.summary(a).sales).toBe(1000)
  })

  it('経費は、有効な経費のみ合計する(取消済・削除済・入金は含めない)。件数は取消済を含み、削除済を含めない', () => {
    record(a, 'expense', 55000)
    record(a, 'expense', 1000)
    record(a, 'expense', 7000, 'cancelled')
    record(a, 'expense', 9000, 'active', 1)
    record(a, 'income', 3000, 'cancelled')
    record(a, 'income', 8000, 'active', 1)

    const summary = repository.summary(a)

    expect(summary.expense).toBe(56000)
    expect(summary.counts).toMatchObject({ expenses: 3, incomes: 1 })
  })

  it('差引は売上-経費で、マイナスになり得る', () => {
    invoice(a, 'finalized', 10000)
    record(a, 'expense', 12000)
    expect(repository.summary(a).balance).toBe(-2000)
  })

  it('案件ごとに集計し、他の案件・案件なしのデータは含めない', () => {
    invoice(a, 'finalized', 1000)
    invoice(b, 'finalized', 2000)
    invoice(null, 'finalized', 4000)
    record(b, 'expense', 300)
    record(null, 'expense', 500)

    const all = repository.summariesByProject()

    expect(all.get(a)).toMatchObject({ sales: 1000, expense: 0, balance: 1000 })
    expect(all.get(b)).toMatchObject({ sales: 2000, expense: 300, balance: 1700 })
    expect(all.size).toBe(2)
  })

  it('案件数に関わらず、SQLは3回で取得する', () => {
    invoice(a, 'finalized', 1000)
    invoice(b, 'finalized', 2000)
    const spy = vi.spyOn(db.sqlite, 'prepare')
    repository.summariesByProject()
    expect(spy).toHaveBeenCalledTimes(3)
  })
})
