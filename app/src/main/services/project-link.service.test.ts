import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PROJECT_MESSAGES } from '@shared/messages/messages'
import { Database } from '../db/db'
import { ProjectRepository } from '../repositories/project.repository'
import { ProjectLinkService } from './project-link.service'
import { ProjectService } from './project.service'

describe('ProjectLinkService(F-30。詳細設計書4.30章)', () => {
  let dir: string
  let db: Database
  let link: ProjectLinkService
  let projects: ProjectService
  let repository: ProjectRepository
  let clientId: number
  let accountId: number

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'project-link-test-'))
    db = new Database(join(dir, 'data.sqlite'))
    db.initialize()
    repository = new ProjectRepository(db)
    link = new ProjectLinkService(db, repository)
    projects = new ProjectService(db, repository)
    clientId = Number(
      db.sqlite.prepare("INSERT INTO clients (name, honorific) VALUES ('取引先', '御中')").run()
        .lastInsertRowid
    )
    accountId = (db.sqlite.prepare('SELECT id FROM accounts LIMIT 1').get() as { id: number }).id
  })
  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const project = (name: string): number =>
    projects.createProject({ name, clientId: null, startDate: '', endDate: '', memo: '' }).id
  const quote = (number: string | null = '2026-001'): number =>
    Number(
      db.sqlite
        .prepare(
          `INSERT INTO quotes (quote_number, client_id, issue_date, status, pdf_hash, updated_at)
           VALUES (?, ?, '2026-10-01', ?, 'hash-q', '2026-10-01T00:00:00.000Z')`
        )
        .run(number, clientId, number ? 'finalized' : 'draft').lastInsertRowid
    )
  const invoice = (number: string | null = '2026-010'): number =>
    Number(
      db.sqlite
        .prepare(
          `INSERT INTO invoices (invoice_number, client_id, issue_date, status, pdf_hash)
           VALUES (?, ?, '2026-10-01', ?, 'hash-i')`
        )
        .run(number, clientId, number ? 'finalized' : 'draft').lastInsertRowid
    )
  const record = (description = '交通費', deleted = 0): number =>
    Number(
      db.sqlite
        .prepare(
          `INSERT INTO cash_records (record_date, kind, amount, account_id, description, is_deleted, record_hash, updated_at)
           VALUES ('2026-10-03', 'expense', 500, ?, ?, ?, 'hash-r', '2026-10-03T00:00:00.000Z')`
        )
        .run(accountId, description, deleted).lastInsertRowid
    )
  const projectIdOf = (table: string, id: number): number | null =>
    (
      db.sqlite.prepare(`SELECT project_id AS p FROM ${table} WHERE id = ?`).get(id) as {
        p: number | null
      }
    ).p
  const history = (): Array<Record<string, unknown>> =>
    db.sqlite
      .prepare(
        `SELECT target_type AS targetType, target_id AS targetId, target_label AS label,
                from_project_id AS fromId, from_project_name AS fromName,
                to_project_id AS toId, to_project_name AS toName, kind
         FROM project_link_history ORDER BY id`
      )
      .all() as Array<Record<string, unknown>>

  it('案件なし→案件(assign)、案件→別の案件(change)、案件→案件なし(unassign)を履歴に記録する', () => {
    const a = project('案件A')
    const b = project('案件B')
    const q = quote()

    expect(link.changeLink('quote', q, a)).toEqual({ changed: true })
    link.changeLink('quote', q, b)
    link.changeLink('quote', q, null)

    expect(projectIdOf('quotes', q)).toBeNull()
    expect(history()).toEqual([
      {
        targetType: 'quote',
        targetId: q,
        label: '2026-001',
        fromId: null,
        fromName: null,
        toId: a,
        toName: '案件A',
        kind: 'assign'
      },
      {
        targetType: 'quote',
        targetId: q,
        label: '2026-001',
        fromId: a,
        fromName: '案件A',
        toId: b,
        toName: '案件B',
        kind: 'change'
      },
      {
        targetType: 'quote',
        targetId: q,
        label: '2026-001',
        fromId: b,
        fromName: '案件B',
        toId: null,
        toName: null,
        kind: 'unassign'
      }
    ])
  })

  it('現在と同じ案件を指定した場合は、何も変更せず、履歴も作らない', () => {
    const a = project('案件A')
    const i = invoice()
    link.changeLink('invoice', i, a)
    expect(link.changeLink('invoice', i, a)).toEqual({ changed: false })
    expect(link.changeLink('invoice', invoice('2026-011'), null)).toEqual({ changed: false })
    expect(history()).toHaveLength(1)
  })

  it('書類の本体は変更しない(updated_at・pdf_hash・record_hashは不変。記録の履歴にも追加しない)', () => {
    const a = project('案件A')
    const q = quote()
    const r = record()

    link.changeLink('quote', q, a)
    link.changeLink('cash_record', r, a)

    expect(
      db.sqlite
        .prepare('SELECT updated_at, pdf_hash, pdf_hash_mismatch FROM quotes WHERE id = ?')
        .get(q)
    ).toEqual({ updated_at: '2026-10-01T00:00:00.000Z', pdf_hash: 'hash-q', pdf_hash_mismatch: 0 })
    expect(
      db.sqlite.prepare('SELECT updated_at, record_hash FROM cash_records WHERE id = ?').get(r)
    ).toEqual({ updated_at: '2026-10-03T00:00:00.000Z', record_hash: 'hash-r' })
    expect(
      (db.sqlite.prepare('SELECT COUNT(*) AS c FROM cash_record_history').get() as { c: number }).c
    ).toBe(0)
  })

  it('対象の表示名: 下書きは「下書き」、入出金は「日付 摘要」の先頭30文字', () => {
    const a = project('案件A')
    link.changeLink('quote', quote(null), a)
    link.changeLink('invoice', invoice(null), a)
    link.changeLink('cash_record', record('あ'.repeat(40)), a)

    const labels = history().map((h) => h.label)
    expect(labels[0]).toBe('下書き')
    expect(labels[1]).toBe('下書き')
    expect(labels[2]).toBe(`2026-10-03 ${'あ'.repeat(19)}`)
    expect(String(labels[2])).toHaveLength(30)
  })

  it('完了の案件へは新しく紐づけられない。現在の案件が完了でも、別の案件・案件なしへは付け替えられる', () => {
    const open = project('進行中')
    const done = project('完了')
    const r = record()
    link.changeLink('cash_record', r, done)
    projects.completeProject(done)

    expect(() => link.changeLink('invoice', invoice(), done)).toThrow(
      PROJECT_MESSAGES.projectNotSelectable
    )
    expect(link.changeLink('cash_record', r, open)).toEqual({ changed: true })
    link.changeLink('cash_record', r, null)
    expect(projectIdOf('cash_records', r)).toBeNull()
  })

  it('存在しない案件・対象はエラー。削除済みの記録は紐づけられない', () => {
    const a = project('案件A')
    expect(() => link.changeLink('quote', 999, a)).toThrow(PROJECT_MESSAGES.targetNotFound)
    expect(() => link.changeLink('quote', quote(), 999)).toThrow(PROJECT_MESSAGES.notFound)
    expect(() => link.changeLink('cash_record', record('削除済み', 1), a)).toThrow(
      PROJECT_MESSAGES.targetDeleted
    )
    expect(history()).toHaveLength(0)
  })

  it('削除に伴う解除(auto_release)は、履歴に種類を残して案件を外す', () => {
    const a = project('案件A')
    const r = record()
    link.changeLink('cash_record', r, a)

    link.changeLink('cash_record', r, null, 'auto_release')

    expect(projectIdOf('cash_records', r)).toBeNull()
    expect(history().at(-1)).toMatchObject({ kind: 'auto_release', fromId: a, toId: null })
  })

  it('取消済の入金記録も、付け替えできる', () => {
    const a = project('案件A')
    const r = record()
    db.sqlite.prepare("UPDATE cash_records SET status = 'cancelled' WHERE id = ?").run(r)
    expect(link.changeLink('cash_record', r, a)).toEqual({ changed: true })
  })

  it('履歴を記録できなかった場合は、紐づけの更新もロールバックし、専用のエラーを返す', () => {
    const a = project('案件A')
    const q = quote()
    db.sqlite.exec('DROP TRIGGER trg_project_link_history_no_update')
    db.sqlite.exec('ALTER TABLE project_link_history RENAME TO project_link_history_broken')

    expect(() => link.changeLink('quote', q, a)).toThrow(PROJECT_MESSAGES.linkHistoryWriteFailure)
    expect(projectIdOf('quotes', q)).toBeNull()
  })

  it('呼び出し元のトランザクション内で失敗した場合は、呼び出し元の変更もまとめてロールバックされる', () => {
    const a = project('案件A')
    const q = quote()
    expect(() =>
      db.transaction(() => {
        link.changeLink('quote', q, a)
        link.changeLink('quote', 999, a)
      })
    ).toThrow(PROJECT_MESSAGES.targetNotFound)
    expect(projectIdOf('quotes', q)).toBeNull()
    expect(history()).toHaveLength(0)
  })

  it('案件の名称を変えても、過去の履歴にはその時点の名称が残る。案件を削除しても履歴は残る', () => {
    const a = project('旧名称')
    const q = quote()
    link.changeLink('quote', q, a)
    projects.updateProject(a, {
      name: '新名称',
      clientId: null,
      startDate: '',
      endDate: '',
      memo: ''
    })
    link.changeLink('quote', q, null)

    expect(history().map((h) => [h.fromName, h.toName])).toEqual([
      [null, '旧名称'],
      ['新名称', null]
    ])
    projects.deleteProject(a)
    expect(history()).toHaveLength(2)
  })

  it('対象に紐づく案件(名称・状態)を取得できる', () => {
    const a = project('案件A')
    const q = quote()
    expect(repository.findLinkedProjectRef('quote', q)).toBeNull()
    link.changeLink('quote', q, a)
    expect(repository.findLinkedProjectRef('quote', q)).toEqual({
      id: a,
      name: '案件A',
      status: 'active'
    })
    expect(repository.findLinkedProjectRef('quote', 999)).toBeNull()
  })
})
