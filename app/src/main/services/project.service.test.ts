import { ProjectSummaryRepository } from '../repositories/project-summary.repository'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PROJECT_MESSAGES } from '@shared/messages/messages'
import type { ProjectInput } from '@shared/schemas/project.schema'
import { Database } from '../db/db'
import { ClientRepository } from '../repositories/client.repository'
import { ProjectRepository } from '../repositories/project.repository'
import { ProjectError, ProjectService } from './project.service'

const input = (overrides: Partial<ProjectInput> = {}): ProjectInput => ({
  name: 'アルファ商事 保守契約',
  clientId: null,
  startDate: '',
  endDate: '',
  memo: '',
  ...overrides
})

describe('ProjectService(F-27〜F-29。詳細設計書4.27〜4.29章)', () => {
  let dir: string
  let db: Database
  let service: ProjectService
  let clients: ClientRepository

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'project-service-test-'))
    db = new Database(join(dir, 'data.sqlite'))
    db.initialize()
    clients = new ClientRepository(db)
    service = new ProjectService(db, new ProjectRepository(db), new ProjectSummaryRepository(db))
  })
  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const client = (name = '取引先', status: 'active' | 'inactive' = 'active'): number => {
    const { id } = clients.insert({
      name,
      furigana: '',
      honorific: '御中',
      contactPerson: '',
      postalCode: '',
      address: '',
      phone: '',
      email: '',
      invoiceRegistrationNumber: '',
      memo: ''
    })
    if (status === 'inactive')
      db.sqlite.prepare("UPDATE clients SET status = 'inactive' WHERE id = ?").run(id)
    return id
  }

  /** 見積書を1件、案件へ紐づけた状態にする(紐づけの変更は、付け替えの処理〔T-63-4〕が担うため、ここでは直接更新する) */
  const linkQuote = (clientId: number, projectId: number): void => {
    db.sqlite
      .prepare(
        `INSERT INTO quotes (client_id, issue_date, status, project_id) VALUES (?, '2026-10-01', 'draft', ?)`
      )
      .run(clientId, projectId)
  }

  describe('登録・更新', () => {
    it('進行中の案件として登録し、空の項目はnullで保存する。同名の案件も登録できる', () => {
      const a = service.createProject(input({ name: '  案件A  ' }))
      const b = service.createProject(input({ name: '案件A' }))

      expect(b.id).not.toBe(a.id)
      expect(service.getProject(a.id)).toMatchObject({
        name: '案件A',
        clientId: null,
        clientName: null,
        startDate: null,
        endDate: null,
        memo: null,
        status: 'active',
        deletable: true
      })
    })

    it('取引先・期間・メモを保存できる', () => {
      const clientId = client('アルファ商事')
      const { id } = service.createProject(
        input({ clientId, startDate: '2026-04-01', endDate: '2026-09-30', memo: 'メモ' })
      )
      expect(service.getProject(id)).toMatchObject({
        clientId,
        clientName: 'アルファ商事',
        startDate: '2026-04-01',
        endDate: '2026-09-30',
        memo: 'メモ'
      })
    })

    it.each([
      [{ name: '   ' }, PROJECT_MESSAGES.nameRequired],
      [{ name: 'あ'.repeat(101) }, PROJECT_MESSAGES.nameTooLong],
      [{ memo: 'あ'.repeat(1001) }, PROJECT_MESSAGES.memoTooLong],
      [{ startDate: '2026-10-02', endDate: '2026-10-01' }, PROJECT_MESSAGES.periodInvalid]
    ])('入力の検証: %j', (overrides, message) => {
      expect(() => service.createProject(input(overrides))).toThrow(message)
    })

    it('名称は100文字ちょうど、メモは1000文字ちょうど、開始日と終了日が同じ日でも登録できる', () => {
      expect(() =>
        service.createProject(
          input({
            name: 'あ'.repeat(100),
            memo: 'あ'.repeat(1000),
            startDate: '2026-10-01',
            endDate: '2026-10-01'
          })
        )
      ).not.toThrow()
    })

    it('存在しない・利用停止の取引先は指定できない', () => {
      expect(() => service.createProject(input({ clientId: 999 }))).toThrow(
        PROJECT_MESSAGES.clientNotSelectable
      )
      const inactive = client('停止中', 'inactive')
      expect(() => service.createProject(input({ clientId: inactive }))).toThrow(
        PROJECT_MESSAGES.clientNotSelectable
      )
    })

    it('編集では、現在の取引先が利用停止になっていても、そのまま保持できる(他の停止中の取引先へは変更できない)', () => {
      const clientId = client('のちに停止')
      const { id } = service.createProject(input({ clientId }))
      db.sqlite.prepare("UPDATE clients SET status = 'inactive' WHERE id = ?").run(clientId)

      expect(() => service.updateProject(id, input({ clientId, name: '改名' }))).not.toThrow()
      expect(service.getProject(id).name).toBe('改名')
      const other = client('別の停止中', 'inactive')
      expect(() => service.updateProject(id, input({ clientId: other }))).toThrow(
        PROJECT_MESSAGES.clientNotSelectable
      )
    })

    it('更新しても状態は変わらない。存在しない案件の更新はエラー', () => {
      const { id } = service.createProject(input())
      service.completeProject(id)
      service.updateProject(id, input({ name: '更新後' }))
      expect(service.getProject(id)).toMatchObject({ name: '更新後', status: 'completed' })
      expect(() => service.updateProject(999, input())).toThrow(PROJECT_MESSAGES.notFound)
    })
  })

  describe('削除', () => {
    it('紐づけが0件なら削除できる', () => {
      const { id } = service.createProject(input())
      service.deleteProject(id)
      expect(() => service.getProject(id)).toThrow(PROJECT_MESSAGES.notFound)
    })

    it('取引先は紐づけに数えないため、取引先のある案件も削除できる', () => {
      const { id } = service.createProject(input({ clientId: client() }))
      expect(() => service.deleteProject(id)).not.toThrow()
    })

    it('見積書が1件でも紐づいていると削除できず、案件は残る', () => {
      const { id } = service.createProject(input())
      linkQuote(client(), id)
      expect(service.getProject(id).deletable).toBe(false)
      expect(() => service.deleteProject(id)).toThrow(PROJECT_MESSAGES.hasLinks)
      expect(service.getProject(id).id).toBe(id)
    })

    it('請求書・入出金(取消済を含む)が紐づいていても削除できない', () => {
      const clientId = client()
      const invoiceProject = service.createProject(input({ name: '請求書あり' })).id
      db.sqlite
        .prepare(
          `INSERT INTO invoices (client_id, issue_date, status, project_id) VALUES (?, '2026-10-01', 'draft', ?)`
        )
        .run(clientId, invoiceProject)
      expect(() => service.deleteProject(invoiceProject)).toThrow(PROJECT_MESSAGES.hasLinks)

      const recordProject = service.createProject(input({ name: '入出金あり' })).id
      const account = (db.sqlite.prepare('SELECT id FROM accounts LIMIT 1').get() as { id: number })
        .id
      db.sqlite
        .prepare(
          `INSERT INTO cash_records (record_date, kind, amount, account_id, description, status, project_id)
           VALUES ('2026-10-01', 'income', 100, ?, 'x', 'cancelled', ?)`
        )
        .run(account, recordProject)
      expect(() => service.deleteProject(recordProject)).toThrow(PROJECT_MESSAGES.hasLinks)
    })

    it('削除しても、付け替え履歴は残る', () => {
      const { id } = service.createProject(input())
      db.sqlite
        .prepare(
          `INSERT INTO project_link_history (target_type, target_id, target_label, to_project_id, to_project_name, kind)
           VALUES ('quote', 1, '下書き', ?, '案件', 'assign')`
        )
        .run(id)
      service.deleteProject(id)
      expect(
        (db.sqlite.prepare('SELECT COUNT(*) AS c FROM project_link_history').get() as { c: number })
          .c
      ).toBe(1)
    })

    it('存在しない案件の削除はエラー', () => {
      expect(() => service.deleteProject(999)).toThrow(PROJECT_MESSAGES.notFound)
    })
  })

  describe('完了・再開', () => {
    it('完了にすると進行中の候補から外れ(現在の案件は含められる)、再開すると戻る。紐づけ・データは変わらない', () => {
      const { id } = service.createProject(input())
      linkQuote(client(), id)

      service.completeProject(id)
      expect(service.getProject(id).status).toBe('completed')
      expect(service.listSelectable()).toEqual([])
      expect(service.listSelectable(id)).toEqual([
        { id, name: 'アルファ商事 保守契約', status: 'completed' }
      ])
      expect(service.getProject(id).quotes).toHaveLength(1)

      service.reopenProject(id)
      expect(service.listSelectable().map((p) => p.id)).toEqual([id])
    })

    it('すでに目的の状態の場合・存在しない場合はエラー', () => {
      const { id } = service.createProject(input())
      expect(() => service.reopenProject(id)).toThrow(PROJECT_MESSAGES.alreadyActive)
      service.completeProject(id)
      expect(() => service.completeProject(id)).toThrow(PROJECT_MESSAGES.alreadyCompleted)
      expect(() => service.completeProject(999)).toThrow(PROJECT_MESSAGES.notFound)
      expect(() => service.reopenProject(999)).toThrow(ProjectError)
    })
  })

  describe('一覧・検索(F-28)', () => {
    function seed(): { a: number; b: number; c: number; clientA: number } {
      const clientA = client('アルファ商事')
      const a = service.createProject(
        input({
          name: '保守契約_2026',
          clientId: clientA,
          startDate: '2026-04-01',
          endDate: '2026-09-30'
        })
      ).id
      const b = service.createProject(input({ name: '100%_達成案件', startDate: '2026-10-01' })).id
      const c = service.createProject(input({ name: '期間なし案件' })).id
      service.completeProject(c)
      return { a, b, c, clientA }
    }

    it('登録の新しい順(idの降順)に、取引先名とともに返す', () => {
      const { a, b, c } = seed()
      const all = service.listProjects({ status: 'all' })
      expect(all.map((p) => p.id)).toEqual([c, b, a])
      expect(all[2]).toMatchObject({ clientName: 'アルファ商事', status: 'active' })
    })

    it('キーワードは部分一致。%・_は文字として扱う', () => {
      const { a, b } = seed()
      expect(service.listProjects({ status: 'all', keyword: '保守' }).map((p) => p.id)).toEqual([a])
      expect(service.listProjects({ status: 'all', keyword: '100%' }).map((p) => p.id)).toEqual([b])
      expect(service.listProjects({ status: 'all', keyword: '%' }).map((p) => p.id)).toEqual([b])
      expect(service.listProjects({ status: 'all', keyword: '_' }).map((p) => p.id)).toEqual([b, a])
    })

    it('取引先・状態で絞り込む(状態の既定は指定しない場合すべて)', () => {
      const { a, c, clientA } = seed()
      expect(service.listProjects({ clientId: clientA }).map((p) => p.id)).toEqual([a])
      expect(service.listProjects({ status: 'completed' }).map((p) => p.id)).toEqual([c])
      expect(service.listProjects({ status: 'active' })).toHaveLength(2)
      expect(service.listProjects()).toHaveLength(3)
    })

    it('期間は、案件の期間と重なる案件。期間を指定すると、開始日・終了日がともに空の案件は対象外', () => {
      const { a, b } = seed()
      const ids = (periodFrom?: string, periodTo?: string): number[] =>
        service.listProjects({ status: 'all', periodFrom, periodTo }).map((p) => p.id)

      expect(ids('2026-09-30', '2026-09-30')).toEqual([a])
      expect(ids('2026-10-01', '2026-10-31')).toEqual([b])
      expect(ids('2026-03-01', '2026-03-31')).toEqual([])
      // 片方のみ: 終了日が未定の案件(b)は、将来の期間にも重なる
      expect(ids('2027-01-01')).toEqual([b])
      expect(ids(undefined, '2026-03-31')).toEqual([])
      expect(ids(undefined, '2026-04-01')).toEqual([a])
    })

    it('期間の終了日が開始日より前の場合はエラー', () => {
      expect(() =>
        service.listProjects({ periodFrom: '2026-10-02', periodTo: '2026-10-01' })
      ).toThrow(PROJECT_MESSAGES.periodFilterInvalid)
    })
  })

  describe('詳細(F-27・F-30)', () => {
    it('紐づく見積書・請求書・入出金と、案件に関する付け替え履歴(新しい順)を返す', () => {
      const clientId = client('アルファ商事')
      const { id } = service.createProject(input())
      linkQuote(clientId, id)
      db.sqlite
        .prepare(
          `INSERT INTO invoices (client_id, issue_date, status, total_amount, project_id)
           VALUES (?, '2026-10-02', 'draft', 1100, ?)`
        )
        .run(clientId, id)
      const account = (db.sqlite.prepare('SELECT id FROM accounts LIMIT 1').get() as { id: number })
        .id
      db.sqlite
        .prepare(
          `INSERT INTO cash_records (record_date, kind, amount, account_id, description, project_id)
           VALUES ('2026-10-03', 'expense', 500, ?, '交通費', ?)`
        )
        .run(account, id)
      const history = db.sqlite.prepare(
        `INSERT INTO project_link_history (target_type, target_id, target_label, from_project_id, to_project_id, kind)
         VALUES ('quote', 1, '下書き', ?, ?, 'change')`
      )
      history.run(id, 99)
      history.run(98, id)
      history.run(97, 96)

      const detail = service.getProject(id)

      expect(detail.quotes).toEqual([
        {
          id: 1,
          documentNumber: null,
          issueDate: '2026-10-01',
          clientName: 'アルファ商事',
          totalAmount: 0,
          status: 'draft'
        }
      ])
      expect(detail.invoices[0]).toMatchObject({ totalAmount: 1100, documentNumber: null })
      expect(detail.records).toEqual([
        {
          id: 1,
          recordDate: '2026-10-03',
          kind: 'expense',
          amount: 500,
          description: '交通費',
          status: 'active'
        }
      ])
      expect(detail.history.map((h) => [h.fromProjectId, h.toProjectId])).toEqual([
        [98, id],
        [id, 99]
      ])
    })

    it('対象ごとの付け替え履歴を、新しい順に返す', () => {
      db.sqlite.exec(
        `INSERT INTO project_link_history (target_type, target_id, target_label, kind) VALUES
         ('quote', 1, '下書き', 'assign'), ('quote', 1, '2026-001', 'unassign'), ('invoice', 1, 'x', 'assign')`
      )
      expect(service.listHistory('quote', 1).map((h) => h.kind)).toEqual(['unassign', 'assign'])
      expect(service.listHistory('cash_record', 1)).toEqual([])
    })
  })

  describe('案件別収支(F-31。詳細設計書4.31章)', () => {
    it('一覧と詳細に、同じ集計(売上・経費・差引)を返す', () => {
      const id = service.createProject(input()).id
      const accountId = (
        db.sqlite.prepare('SELECT id FROM accounts LIMIT 1').get() as { id: number }
      ).id
      db.sqlite
        .prepare(
          `INSERT INTO invoices (client_id, issue_date, status, total_amount, withholding_tax_amount, project_id)
           VALUES (?, '2026-10-01', 'finalized', 363000, 30630, ?)`
        )
        .run(client(), id)
      db.sqlite
        .prepare(
          `INSERT INTO cash_records (record_date, kind, amount, account_id, description, project_id)
           VALUES ('2026-10-02', 'expense', 55000, ?, 'x', ?)`
        )
        .run(accountId, id)

      const listed = service.listProjects({ status: 'all' })[0]!
      const detail = service.getProject(id)

      expect([listed.sales, listed.expense, listed.balance]).toEqual([363000, 55000, 308000])
      expect(detail.summary).toMatchObject({
        sales: 363000,
        withholding: 30630,
        expense: 55000,
        balance: 308000,
        counts: { invoicesIssued: 1, expenses: 1 }
      })
    })

    it('紐づくデータが無い案件は、0円・0件', () => {
      const id = service.createProject(input()).id
      expect(service.listProjects()[0]).toMatchObject({ sales: 0, expense: 0, balance: 0 })
      expect(service.getProject(id).summary.counts).toEqual({
        quotes: 0,
        invoicesIssued: 0,
        invoicesDraft: 0,
        incomes: 0,
        expenses: 0
      })
    })
  })
})
