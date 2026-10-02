import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { Database } from '../db/db'
import { ClientRepository } from './client.repository'
import { QuoteRepository } from './quote.repository'
import type { QuoteInput } from '@shared/schemas/quote.schema'
import type { ClientInput } from '@shared/schemas/client.schema'

const baseClient: ClientInput = {
  name: '株式会社サンプル',
  furigana: 'カブシキガイシャサンプル',
  honorific: '御中',
  contactPerson: '',
  postalCode: '',
  address: '',
  phone: '',
  email: '',
  invoiceRegistrationNumber: '',
  memo: ''
}

const baseInput: QuoteInput = {
  clientId: 1,
  issueDate: '2026-09-20',
  validUntil: '2026-10-20',
  remarks: '概算見積です。',
  lineItems: [
    { name: 'Webサイト制作一式', quantity: 1, unit: '式', unitPrice: 300000, taxRate: 10 },
    { name: 'サーバー保守(月額)', quantity: 1, unit: '式', unitPrice: 30000, taxRate: 10 }
  ]
}

describe('QuoteRepository', () => {
  let db: Database
  let repository: QuoteRepository
  let clientId: number

  beforeEach(() => {
    db = new Database(':memory:')
    db.initialize()
    repository = new QuoteRepository(db)
    const clientRepository = new ClientRepository(db)
    clientId = clientRepository.insert(baseClient).id
  })

  afterEach(() => {
    db.close()
  })

  it('insertで下書きとして登録し、税額を計算して保存する', () => {
    const { id } = repository.insert({ ...baseInput, clientId })
    const found = repository.findById(id)

    expect(found).not.toBeNull()
    expect(found?.status).toBe('draft')
    expect(found?.quoteNumber).toBeNull()
    expect(found?.clientId).toBe(clientId)
    expect(found?.clientName).toBe('株式会社サンプル')
    expect(found?.subtotal10).toBe(330000)
    expect(found?.taxAmount10).toBe(33000)
    expect(found?.totalAmount).toBe(363000)
    expect(found?.lineItems).toHaveLength(2)
    expect(found?.lineItems[0]?.amount).toBe(300000)
    expect(found?.lineItems[0]?.lineNo).toBe(1)
    expect(found?.lineItems[1]?.lineNo).toBe(2)
  })

  it('findByIdで存在しないIDを指定した場合はnullを返す', () => {
    expect(repository.findById(9999)).toBeNull()
  })

  it('updateで明細行を全置換し、税額を再計算する', () => {
    const { id } = repository.insert({ ...baseInput, clientId })
    repository.update(id, {
      ...baseInput,
      clientId,
      lineItems: [{ name: '新しい品目', quantity: 2, unit: '個', unitPrice: 1000, taxRate: 8 }]
    })

    const found = repository.findById(id)
    expect(found?.lineItems).toHaveLength(1)
    expect(found?.lineItems[0]?.name).toBe('新しい品目')
    expect(found?.subtotal8).toBe(2000)
    expect(found?.taxAmount8).toBe(160)
    expect(found?.subtotal10).toBe(0)
  })

  it('finalizeで採番結果・記載形式・状態を更新する', () => {
    const { id } = repository.insert({ ...baseInput, clientId })
    repository.finalize(id, { quoteNumber: '2026-001', invoiceFormat: 'qualified' })

    const found = repository.findById(id)
    expect(found?.quoteNumber).toBe('2026-001')
    expect(found?.invoiceFormat).toBe('qualified')
    expect(found?.status).toBe('finalized')
  })

  it('updatePdfInfoでpdfPath・pdfHashを更新する', () => {
    const { id } = repository.insert({ ...baseInput, clientId })
    repository.finalize(id, { quoteNumber: '2026-001', invoiceFormat: 'qualified' })
    repository.updatePdfInfo(id, { pdfPath: '/tmp/2026-001.pdf', pdfHash: 'abc123' })

    const found = repository.findById(id)
    expect(found?.pdfPath).toBe('/tmp/2026-001.pdf')
    expect(found?.pdfHash).toBe('abc123')
  })

  it('revertToDraftで下書き状態・番号なしへ戻す', () => {
    const { id } = repository.insert({ ...baseInput, clientId })
    repository.finalize(id, { quoteNumber: '2026-001', invoiceFormat: 'qualified' })
    repository.revertToDraft(id)

    const found = repository.findById(id)
    expect(found?.status).toBe('draft')
    expect(found?.quoteNumber).toBeNull()
    expect(found?.invoiceFormat).toBeNull()
  })

  it('findAllは既定で発行日の新しい順に一覧を返す', () => {
    repository.insert({ ...baseInput, clientId, issueDate: '2026-09-01' })
    repository.insert({ ...baseInput, clientId, issueDate: '2026-09-15' })

    const list = repository.findAll()
    expect(list.map((q) => q.issueDate)).toEqual(['2026-09-15', '2026-09-01'])
    expect(list[0]?.clientName).toBe('株式会社サンプル')
  })

  it('findAllはclientIdで絞り込める', () => {
    const otherClientId = new ClientRepository(db).insert({ ...baseClient, name: '別の取引先' }).id
    repository.insert({ ...baseInput, clientId })
    repository.insert({ ...baseInput, clientId: otherClientId })

    const list = repository.findAll({ clientId })
    expect(list).toHaveLength(1)
    expect(list[0]?.clientId).toBe(clientId)
  })

  it('findAllは発行日の範囲で絞り込める', () => {
    repository.insert({ ...baseInput, clientId, issueDate: '2026-01-01' })
    repository.insert({ ...baseInput, clientId, issueDate: '2026-06-01' })
    repository.insert({ ...baseInput, clientId, issueDate: '2026-12-01' })

    const list = repository.findAll({ dateFrom: '2026-02-01', dateTo: '2026-11-01' })
    expect(list.map((q) => q.issueDate)).toEqual(['2026-06-01'])
  })

  it('findAllは金額の範囲で絞り込める', () => {
    repository.insert({
      ...baseInput,
      clientId,
      lineItems: [{ name: '安い品目', quantity: 1, unit: '', unitPrice: 1000, taxRate: 10 }]
    })
    repository.insert({
      ...baseInput,
      clientId,
      lineItems: [{ name: '高い品目', quantity: 1, unit: '', unitPrice: 500000, taxRate: 10 }]
    })

    const list = repository.findAll({ amountMin: 100000 })
    expect(list).toHaveLength(1)
    expect(list[0]?.totalAmount).toBeGreaterThanOrEqual(100000)
  })

  it('findAllはstatusで絞り込める(既定はすべて)', () => {
    const { id } = repository.insert({ ...baseInput, clientId })
    repository.finalize(id, { quoteNumber: '2026-001', invoiceFormat: 'qualified' })
    repository.insert({ ...baseInput, clientId })

    expect(repository.findAll().length).toBe(2)
    expect(repository.findAll({ status: 'finalized' }).length).toBe(1)
    expect(repository.findAll({ status: 'draft' }).length).toBe(1)
  })
})
