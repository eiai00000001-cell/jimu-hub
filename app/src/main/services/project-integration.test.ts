import { ProjectSummaryRepository } from '../repositories/project-summary.repository'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROJECT_MESSAGES } from '@shared/messages/messages'
import type { InvoiceInput } from '@shared/schemas/invoice.schema'
import type { QuoteInput } from '@shared/schemas/quote.schema'
import { Database } from '../db/db'
import { ClientRepository } from '../repositories/client.repository'
import { CompanyProfileRepository } from '../repositories/company-profile.repository'
import { DocumentNumberSequenceRepository } from '../repositories/document-number-sequence.repository'
import { InvoiceRepository } from '../repositories/invoice.repository'
import { ProjectRepository } from '../repositories/project.repository'
import { QuoteRepository } from '../repositories/quote.repository'
import { InvoiceService } from './invoice.service'
import { NumberingService } from './numbering.service'
import { ProjectService } from './project.service'
import { QuoteService } from './quote.service'
import { createRecordServices } from './record-services'

const quoteInput = (clientId: number, projectId?: number | null): QuoteInput => ({
  clientId,
  issueDate: '2026-09-20',
  validUntil: '',
  remarks: '',
  lineItems: [{ name: '制作', quantity: 1, unit: '式', unitPrice: 100000, taxRate: 10 }],
  ...(projectId === undefined ? {} : { projectId })
})
const invoiceInput = (clientId: number, projectId?: number | null): InvoiceInput => ({
  clientId,
  issueDate: '2026-09-22',
  dueDate: '',
  remarks: '',
  lineItems: [
    {
      name: '制作',
      quantity: 1,
      unit: '式',
      unitPrice: 100000,
      taxRate: 10,
      withholdingTarget: false
    }
  ],
  ...(projectId === undefined ? {} : { projectId })
})

describe('案件の紐づけと、見積書・請求書・入出金・経費の保存・削除の連携(F-30。詳細設計書4.30章手順3〜6)', () => {
  let dir: string
  let db: Database
  let quotes: QuoteService
  let invoices: InvoiceService
  let records: ReturnType<typeof createRecordServices>
  let projects: ProjectService
  let clientId: number
  let accountId: number

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'project-integration-test-'))
    db = new Database(join(dir, 'data.sqlite'))
    db.initialize()
    records = createRecordServices(db, join(dir, 'documents'))
    projects = new ProjectService(db, new ProjectRepository(db), new ProjectSummaryRepository(db))
    const companyProfileRepository = new CompanyProfileRepository(db)
    companyProfileRepository.upsert({
      name: '自社',
      address: '東京都',
      invoiceRegistrationNumber: 'T1234567890123',
      bankName: '',
      bankBranch: '',
      accountType: '',
      accountNumber: '',
      accountHolder: ''
    })
    const numberingService = new NumberingService(new DocumentNumberSequenceRepository(db))
    const pdfService = {
      generateQuotePdf: vi.fn().mockResolvedValue({ pdfPath: '/tmp/q.pdf', pdfHash: 'h' }),
      generateInvoicePdf: vi.fn().mockResolvedValue({ pdfPath: '/tmp/i.pdf', pdfHash: 'h' })
    } as never
    const quoteRepository = new QuoteRepository(db)
    quotes = new QuoteService({
      database: db,
      repository: quoteRepository,
      companyProfileRepository,
      numberingService,
      pdfService,
      projectLinkService: records.projectLinkService
    })
    invoices = new InvoiceService({
      database: db,
      repository: new InvoiceRepository(db),
      quoteRepository,
      companyProfileRepository,
      numberingService,
      pdfService,
      paymentRecorder: records.cashRecordService,
      projectLinkService: records.projectLinkService
    })
    clientId = new ClientRepository(db).insert({
      name: '取引先',
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
    accountId = (
      db.sqlite.prepare("SELECT id FROM accounts WHERE name = '通信費'").get() as { id: number }
    ).id
  })
  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const project = (name = '案件'): number =>
    projects.createProject({ name, clientId: null, startDate: '', endDate: '', memo: '' }).id
  const projectOf = (table: string, id: number): number | null =>
    (
      db.sqlite.prepare(`SELECT project_id AS p FROM ${table} WHERE id = ?`).get(id) as {
        p: number | null
      }
    ).p
  const historyKinds = (): string[] =>
    (
      db.sqlite.prepare('SELECT kind FROM project_link_history ORDER BY id').all() as Array<{
        kind: string
      }>
    ).map((r) => r.kind)
  const count = (table: string): number =>
    (db.sqlite.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c

  describe('見積書', () => {
    it('新規の下書き保存で案件を紐づけ、編集で付け替え・解除できる。同じ値・省略では履歴を作らない', () => {
      const a = project('A')
      const b = project('B')
      const { id } = quotes.saveDraft(quoteInput(clientId, a))
      expect(projectOf('quotes', id)).toBe(a)

      quotes.saveDraft(quoteInput(clientId, a), id)
      quotes.saveDraft(quoteInput(clientId), id)
      expect(projectOf('quotes', id)).toBe(a)
      expect(historyKinds()).toEqual(['assign'])

      quotes.saveDraft(quoteInput(clientId, b), id)
      quotes.saveDraft(quoteInput(clientId, null), id)
      expect(projectOf('quotes', id)).toBeNull()
      expect(historyKinds()).toEqual(['assign', 'change', 'unassign'])
    })

    it('案件なしで保存した場合は、履歴を作らない', () => {
      quotes.saveDraft(quoteInput(clientId, null))
      quotes.saveDraft(quoteInput(clientId))
      expect(historyKinds()).toEqual([])
    })

    it('完了の案件を指定すると、保存全体が取り消される(見積書は作られない)', () => {
      const done = project('完了')
      projects.completeProject(done)
      expect(() => quotes.saveDraft(quoteInput(clientId, done))).toThrow(
        PROJECT_MESSAGES.projectNotSelectable
      )
      expect(count('quotes')).toBe(0)
    })

    it('現在の案件が完了になった下書きは、案件を変えずにそのまま保存できる', () => {
      const a = project('A')
      const { id } = quotes.saveDraft(quoteInput(clientId, a))
      projects.completeProject(a)
      expect(() => quotes.saveDraft(quoteInput(clientId, a), id)).not.toThrow()
      expect(projectOf('quotes', id)).toBe(a)
    })

    it('PDF保存(確定)でも案件を紐づける', async () => {
      const a = project('A')
      const result = await quotes.finalizeQuote(quoteInput(clientId, a))
      expect(projectOf('quotes', result.id)).toBe(a)
      // 下書きから確定する場合は、下書きと同じ案件のまま(履歴を増やさない)
      const draft = quotes.saveDraft(quoteInput(clientId, a))
      await quotes.finalizeQuote(quoteInput(clientId, a), draft.id)
      expect(historyKinds()).toEqual(['assign', 'assign'])
    })

    it('下書きを削除すると、案件の紐づけを解除(auto_release)して履歴に残し、見積書を削除する', () => {
      const a = project('A')
      const { id } = quotes.saveDraft(quoteInput(clientId, a))
      quotes.deleteDraft(id)
      expect(count('quotes')).toBe(0)
      expect(historyKinds()).toEqual(['assign', 'auto_release'])
      // 案件は、紐づけが無くなるため削除できる
      expect(() => projects.deleteProject(a)).not.toThrow()
    })
  })

  describe('請求書', () => {
    it('保存・確定で案件を紐づけ、下書きの削除で解除する', async () => {
      const a = project('A')
      const draft = invoices.saveDraft(invoiceInput(clientId, a))
      expect(projectOf('invoices', draft.id)).toBe(a)
      await invoices.finalizeInvoice(invoiceInput(clientId, a), draft.id)
      const another = invoices.saveDraft(invoiceInput(clientId, a))
      invoices.deleteDraft(another.id)
      expect(historyKinds()).toEqual(['assign', 'assign', 'auto_release'])
    })

    it('完了の案件を指定すると、保存全体が取り消される', () => {
      const done = project('完了')
      projects.completeProject(done)
      expect(() => invoices.saveDraft(invoiceInput(clientId, done))).toThrow(
        PROJECT_MESSAGES.projectNotSelectable
      )
      expect(count('invoices')).toBe(0)
    })

    it('見積書から変換すると、見積書の案件(進行中)を引き継ぎ、履歴にも残す', async () => {
      const a = project('A')
      const quote = await quotes.finalizeQuote(quoteInput(clientId, a))

      const { invoiceId } = invoices.convertFromQuote(quote.id)

      expect(projectOf('invoices', invoiceId)).toBe(a)
      expect(historyKinds()).toEqual(['assign', 'assign'])
    })

    it('見積書の案件が完了の場合は引き継がない。案件なしの見積書からは、案件なしで作成する', async () => {
      const a = project('A')
      const quote = await quotes.finalizeQuote(quoteInput(clientId, a))
      projects.completeProject(a)
      expect(projectOf('invoices', invoices.convertFromQuote(quote.id).invoiceId)).toBeNull()

      const plain = await quotes.finalizeQuote(quoteInput(clientId))
      expect(projectOf('invoices', invoices.convertFromQuote(plain.id).invoiceId)).toBeNull()
      expect(historyKinds()).toEqual(['assign'])
    })

    it('請求書を入金済みにして自動作成した入金記録は、案件を引き継がない', async () => {
      const a = project('A')
      const result = await invoices.finalizeInvoice(invoiceInput(clientId, a))
      invoices.updatePaymentStatus(result.id, { paymentStatus: 'paid', paymentDate: '2026-09-30' })

      const record = db.sqlite.prepare('SELECT id, project_id AS p FROM cash_records').get() as {
        id: number
        p: number | null
      }
      expect(record.p).toBeNull()
      expect(historyKinds()).toEqual(['assign'])

      // 取消済になっても紐づけは維持され、詳細画面から付け替えられる
      records.projectLinkService.changeLink('cash_record', record.id, a)
      invoices.updatePaymentStatus(result.id, { paymentStatus: 'unpaid' })
      expect(projectOf('cash_records', record.id)).toBe(a)
    })
  })

  describe('入出金・経費', () => {
    const input = (projectId?: number | null) => ({
      kind: 'expense' as const,
      recordDate: '2026-09-28',
      amount: 6600,
      accountId,
      description: 'インターネット回線',
      clientId: null,
      paymentMethod: null,
      taxCategory: 'standard_10' as const,
      ...(projectId === undefined ? {} : { projectId })
    })

    it('登録時に案件を紐づける(記録の履歴・記録ハッシュは案件の影響を受けない)', () => {
      const a = project('A')
      const linked = records.cashRecordService.createRecord(input(a))
      const plain = records.cashRecordService.createRecord(input())

      expect(projectOf('cash_records', linked.id)).toBe(a)
      expect(projectOf('cash_records', plain.id)).toBeNull()
      expect(count('cash_record_history')).toBe(2)
      expect(historyKinds()).toEqual(['assign'])

      // 紐づけ・付け替えをしても、記録ハッシュ・記録の履歴は変わらない
      const hashOf = (id: number): string =>
        (
          db.sqlite.prepare('SELECT record_hash AS h FROM cash_records WHERE id = ?').get(id) as {
            h: string
          }
        ).h
      const before = hashOf(plain.id)
      records.projectLinkService.changeLink('cash_record', plain.id, a)
      expect(hashOf(plain.id)).toBe(before)
      expect(count('cash_record_history')).toBe(2)
      expect(records.cashRecordService.getRecord(plain.id).integrity.recordHashOk).toBe(true)
    })

    it('完了の案件を指定すると、登録全体が取り消される', () => {
      const done = project('完了')
      projects.completeProject(done)
      expect(() => records.cashRecordService.createRecord(input(done))).toThrow(
        PROJECT_MESSAGES.projectNotSelectable
      )
      expect(count('cash_records')).toBe(0)
      expect(count('cash_record_history')).toBe(0)
    })

    it('更新では案件を扱わない(入力に含めても無視する)', () => {
      const a = project('A')
      const b = project('B')
      const { id } = records.cashRecordService.createRecord(input(a))

      records.cashRecordService.updateRecord({
        ...input(b),
        id,
        description: '更新',
        reason: ''
      } as never)

      expect(projectOf('cash_records', id)).toBe(a)
      expect(historyKinds()).toEqual(['assign'])
    })

    it('記録を削除すると、案件の紐づけを解除(auto_release)して履歴に残す', () => {
      const a = project('A')
      const { id } = records.cashRecordService.createRecord(input(a))

      records.cashRecordService.deleteRecord({ id, reason: '誤登録' })

      expect(projectOf('cash_records', id)).toBeNull()
      expect(historyKinds()).toEqual(['assign', 'auto_release'])
      expect(() => projects.deleteProject(a)).not.toThrow()
    })
  })
})
