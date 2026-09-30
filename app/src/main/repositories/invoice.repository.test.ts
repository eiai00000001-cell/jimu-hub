import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { Database } from '../db/db'
import { ClientRepository } from './client.repository'
import { InvoiceRepository } from './invoice.repository'
import type { InvoiceInput } from '@shared/schemas/invoice.schema'
import type { ClientInput } from '@shared/schemas/client.schema'

const baseClient: ClientInput = {
  name: '株式会社サンプル',
  furigana: '',
  honorific: '御中',
  contactPerson: '',
  postalCode: '',
  address: '',
  phone: '',
  email: '',
  invoiceRegistrationNumber: '',
  memo: ''
}

const baseInput: InvoiceInput = {
  clientId: 1,
  issueDate: '2026-09-22',
  dueDate: '2026-10-31',
  remarks: '',
  lineItems: [
    {
      name: 'Webサイト制作一式',
      quantity: 1,
      unit: '式',
      unitPrice: 300000,
      taxRate: 10,
      withholdingTarget: true
    },
    {
      name: 'サーバー保守(月額)',
      quantity: 1,
      unit: '式',
      unitPrice: 30000,
      taxRate: 10,
      withholdingTarget: false
    }
  ]
}

describe('InvoiceRepository', () => {
  let db: Database
  let repository: InvoiceRepository
  let clientId: number

  beforeEach(() => {
    db = new Database(':memory:')
    db.initialize()
    repository = new InvoiceRepository(db)
    clientId = new ClientRepository(db).insert(baseClient).id
  })

  afterEach(() => {
    db.close()
  })

  it('insertで下書き登録し、消費税・源泉徴収税額・請求金額を計算して保存する', () => {
    const { id } = repository.insert({ ...baseInput, clientId })
    const found = repository.findById(id)

    expect(found?.status).toBe('draft')
    expect(found?.invoiceNumber).toBeNull()
    expect(found?.paymentStatus).toBe('unpaid')
    expect(found?.sourceQuoteId).toBeNull()
    expect(found?.clientName).toBe('株式会社サンプル')
    expect(found?.totalAmount).toBe(363000)
    expect(found?.withholdingTaxAmount).toBe(30630)
    expect(found?.billingAmount).toBe(332370)
    expect(found?.lineItems[0]?.withholdingTarget).toBe(true)
    expect(found?.lineItems[0]?.withholdingAmount).toBe(30630)
    expect(found?.lineItems[1]?.withholdingAmount).toBe(0)
  })

  it('源泉徴収対象行がない場合、源泉徴収税額は0で請求金額=合計金額', () => {
    const { id } = repository.insert({
      ...baseInput,
      clientId,
      lineItems: [{ ...baseInput.lineItems[1]! }]
    })
    const found = repository.findById(id)
    expect(found?.withholdingTaxAmount).toBe(0)
    expect(found?.billingAmount).toBe(found?.totalAmount)
  })

  it('insertでsourceQuoteIdを指定できる(見積書からの変換用)', () => {
    db.sqlite
      .prepare(
        "INSERT INTO quotes (client_id, issue_date, created_at, updated_at) VALUES (?, '2026-09-01', 'x', 'x')"
      )
      .run(clientId)
    const { id } = repository.insert({ ...baseInput, clientId }, 1)
    expect(repository.findById(id)?.sourceQuoteId).toBe(1)
  })

  it('findByIdで存在しないIDはnullを返す', () => {
    expect(repository.findById(9999)).toBeNull()
  })

  it('updateで明細行を全置換し再計算する(sourceQuoteIdは維持)', () => {
    db.sqlite
      .prepare(
        "INSERT INTO quotes (client_id, issue_date, created_at, updated_at) VALUES (?, '2026-09-01', 'x', 'x')"
      )
      .run(clientId)
    const { id } = repository.insert({ ...baseInput, clientId }, 1)
    repository.update(id, {
      ...baseInput,
      clientId,
      lineItems: [
        {
          name: '新品目',
          quantity: 2,
          unit: '個',
          unitPrice: 1000,
          taxRate: 8,
          withholdingTarget: false
        }
      ]
    })
    const found = repository.findById(id)
    expect(found?.lineItems).toHaveLength(1)
    expect(found?.subtotal8).toBe(2000)
    expect(found?.withholdingTaxAmount).toBe(0)
    expect(found?.sourceQuoteId).toBe(1)
  })

  it('finalize・updatePdfInfo・revertToDraftが状態を更新する', () => {
    const { id } = repository.insert({ ...baseInput, clientId })
    repository.finalize(id, { invoiceNumber: '2026-001', invoiceFormat: 'qualified' })
    repository.updatePdfInfo(id, { pdfPath: '/tmp/a.pdf', pdfHash: 'h' })
    let found = repository.findById(id)
    expect(found?.status).toBe('finalized')
    expect(found?.invoiceNumber).toBe('2026-001')
    expect(found?.pdfPath).toBe('/tmp/a.pdf')

    repository.revertToDraft(id)
    found = repository.findById(id)
    expect(found?.status).toBe('draft')
    expect(found?.invoiceNumber).toBeNull()
  })

  it('findAllは発行日の新しい順で返し、各種条件で絞り込める', () => {
    const other = new ClientRepository(db).insert({ ...baseClient, name: '別の取引先' }).id
    const a = repository.insert({ ...baseInput, clientId, issueDate: '2026-09-01' })
    repository.insert({ ...baseInput, clientId: other, issueDate: '2026-09-15' })
    repository.finalize(a.id, { invoiceNumber: '2026-001', invoiceFormat: 'qualified' })

    expect(repository.findAll().map((i) => i.issueDate)).toEqual(['2026-09-15', '2026-09-01'])
    expect(repository.findAll({ clientId })).toHaveLength(1)
    expect(repository.findAll({ dateFrom: '2026-09-10' })).toHaveLength(1)
    expect(repository.findAll({ status: 'finalized' })).toHaveLength(1)
    expect(repository.findAll({ paymentStatus: 'paid' })).toHaveLength(0)
    expect(repository.findAll({ paymentStatus: 'unpaid' })).toHaveLength(2)
    expect(repository.findAll({ amountMin: 400000 })).toHaveLength(0)
  })
})
