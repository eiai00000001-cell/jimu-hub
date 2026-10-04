import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Database } from '../db/db'
import { CashRecordRepository } from '../repositories/cash-record.repository'
import { CsvExportService, CsvWriteError, monthRange } from './csv-export.service'

describe('monthRange', () => {
  it('開始月の1日〜終了月の翌月1日(年またぎを含む)', () => {
    expect(monthRange('2026-01', '2026-12')).toEqual({
      fromDate: '2026-01-01',
      toExclusive: '2027-01-01'
    })
    expect(monthRange('2026-03', '2026-03')).toEqual({
      fromDate: '2026-03-01',
      toExclusive: '2026-04-01'
    })
  })
})

describe('CsvExportService(F-24。詳細設計書4.24章)', () => {
  let db: Database
  let service: CsvExportService
  let work: string
  let expense: number
  let income: number

  beforeEach(() => {
    db = new Database(':memory:')
    db.initialize()
    work = mkdtempSync(join(tmpdir(), 'jimuhub-csv-'))
    service = new CsvExportService(new CashRecordRepository(db))
    expense = (
      db.sqlite.prepare("SELECT id FROM accounts WHERE name = '通信費'").get() as { id: number }
    ).id
    income = (
      db.sqlite.prepare("SELECT id FROM accounts WHERE default_key = 'sales_revenue'").get() as {
        id: number
      }
    ).id
  })
  afterEach(() => db.close())

  const add = (o: Record<string, unknown>): number => {
    const v = {
      date: '2026-09-28',
      kind: 'expense',
      amount: 6600,
      account: expense,
      desc: 'インターネット回線',
      client: null,
      tax: 'standard_10',
      taxAmount: 600,
      invoice: null,
      status: 'active',
      deleted: 0,
      ...o
    }
    return Number(
      db.sqlite
        .prepare(
          `INSERT INTO cash_records (record_date, kind, amount, account_id, description, client_id, tax_category, tax_amount, invoice_id, status, is_deleted)
           VALUES (@date, @kind, @amount, @account, @desc, @client, @tax, @taxAmount, @invoice, @status, @deleted)`
        )
        .run(v).lastInsertRowid
    )
  }

  it('列・書式どおりに出力する(BOM・ヘッダー・CRLF・種別・税区分・状態)', () => {
    add({})
    const { content, count } = service.build('2026-01', '2026-12')
    expect(count).toBe(1)
    expect(content).toBe(
      '﻿日付,種別,取引先,金額,勘定科目,摘要,税区分,消費税額,領収書ファイル名,請求書番号,状態\r\n' +
        '2026-09-28,経費,,6600,通信費,インターネット回線,10%,600,,,有効\r\n'
    )
  })

  it('期間(記録日)で絞り、日付昇順・同日はid昇順。削除済みは含めず、取消済は「取消済」で含める', () => {
    add({ date: '2026-09-30', desc: 'b' })
    add({ date: '2026-09-30', desc: 'c' })
    add({ date: '2026-09-01', desc: 'a' })
    add({ date: '2025-12-31', desc: '範囲外前' })
    add({ date: '2027-01-01', desc: '範囲外後' })
    add({ date: '2026-09-15', desc: '削除済', deleted: 1 })
    add({
      date: '2026-09-20',
      kind: 'income',
      account: income,
      desc: '取消',
      status: 'cancelled',
      tax: null,
      taxAmount: 0
    })
    const { content, count } = service.build('2026-01', '2026-12')
    const lines = content.split('\r\n').slice(1, -1)
    expect(count).toBe(4)
    expect(lines.map((l) => l.split(',')[5])).toEqual(['a', '取消', 'b', 'c'])
    expect(lines[1]).toContain(',入金,')
    expect(lines[1]!.endsWith(',取消済')).toBe(true)
    expect(service.countTargets('2026-01', '2026-12')).toBe(4)
    expect(service.countTargets('2026-09', '2026-09')).toBe(4)
    expect(service.countTargets('2030-01', '2030-02')).toBe(0)
  })

  it('取引先・請求書番号・領収書ファイル名(外していないもののみ、"; "連結)・税区分の各表記を出力する', () => {
    const client = Number(
      db.sqlite.prepare("INSERT INTO clients (name) VALUES ('サンプル商事株式会社')").run()
        .lastInsertRowid
    )
    const invoice = Number(
      db.sqlite
        .prepare(
          "INSERT INTO invoices (client_id, issue_date, invoice_number, status, created_at, updated_at) VALUES (?, '2026-09-01', '2026-012', 'finalized', 'x', 'x')"
        )
        .run(client).lastInsertRowid
    )
    const id = add({
      client,
      invoice,
      kind: 'income',
      account: income,
      tax: 'reduced_8',
      taxAmount: 7
    })
    const ins = db.sqlite.prepare(
      "INSERT INTO receipts (record_id, original_name, file_path, mime_type, file_size, sha256, removed_at) VALUES (?, ?, 'receipts/x.pdf', 'application/pdf', 1, 'h', ?)"
    )
    ins.run(id, 'b.pdf', null)
    ins.run(id, 'removed.pdf', '2026-09-29')
    ins.run(id, 'a.pdf', null)
    add({ tax: 'tax_exempt', taxAmount: 0 })
    add({ tax: 'not_applicable', taxAmount: 0 })
    add({ tax: null, taxAmount: 0 })
    const lines = service.build('2026-09', '2026-09').content.split('\r\n').slice(1, -1)
    expect(lines[0]).toBe(
      '2026-09-28,入金,サンプル商事株式会社,6600,売上高,インターネット回線,8%(軽減),7,b.pdf; a.pdf,2026-012,有効'
    )
    expect(lines.slice(1).map((l) => l.split(',')[6])).toEqual(['非課税', '対象外', ''])
  })

  it('文字列項目の数式インジェクションを無効化し、金額・消費税額・日付には適用しない。カンマ・引用符・改行はエスケープする', () => {
    add({ desc: '=HYPERLINK("http://x")' })
    add({ desc: '+1,2' })
    add({ desc: '日本語\n改行' })
    const lines = service.build('2026-09', '2026-09').content
    expect(lines).toContain(
      `'=HYPERLINK(""http://x"")`.replace("'=HYPERLINK", '"\'=HYPERLINK').replace('"")', '"")"')
    )
    expect(lines).toContain('"\'+1,2"')
    expect(lines).toContain('"日本語\n改行"')
    expect(lines).toContain('2026-09-28,経費,,6600,')
  })

  it('exportはUTF-8(BOM付き)で書き込み、件数を返す。書き込み失敗はCsvWriteError', () => {
    add({})
    const path = join(work, 'out.csv')
    expect(service.export('2026-09', '2026-09', path)).toEqual({ count: 1 })
    const bytes = readFileSync(path)
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(() => service.export('2026-09', '2026-09', join(work, 'nodir', 'out.csv'))).toThrow(
      CsvWriteError
    )
  })

  it('消費税額は保存された値をそのまま出力する(再計算しない)', () => {
    add({ amount: 6600, tax: 'standard_10', taxAmount: 123 })
    expect(service.build('2026-09', '2026-09').content).toContain(',10%,123,')
  })
})
