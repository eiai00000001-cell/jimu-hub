import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BACKUP_MESSAGES, PROJECT_MESSAGES } from '@shared/messages/messages'
import { Database } from '../db/db'
import { ClientRepository } from '../repositories/client.repository'
import { ProjectRepository } from '../repositories/project.repository'
import { BackupService } from './backup.service'
import { exportToLegacyJson, mapExportTable, readExport } from './backup/test-helpers'
import { MigrationService } from './migration.service'
import { ProjectService } from './project.service'
import { createRecordServices } from './record-services'
import { writeFileSync } from 'node:fs'

interface Env {
  dir: string
  db: Database
  service: BackupService
  records: ReturnType<typeof createRecordServices>
  projects: ProjectService
  clients: ClientRepository
}

function createEnv(name: string): Env {
  const dir = mkdtempSync(join(tmpdir(), `jimuhub-bkp-${name}-`))
  const dbFile = join(dir, 'data.sqlite')
  const documentsDir = join(dir, 'documents')
  const db = new Database(dbFile)
  db.initialize()
  const clients = new ClientRepository(db)
  return {
    dir,
    db,
    clients,
    service: new BackupService({
      database: db,
      clientRepository: clients,
      migrationService: new MigrationService(),
      dbFilePath: dbFile,
      backupsDir: join(dir, 'backups'),
      documentsDir,
      appVersion: '0.4.0'
    }),
    records: createRecordServices(db, documentsDir),
    projects: new ProjectService(db, new ProjectRepository(db))
  }
}

describe('BackupService: 案件のエクスポート・復元(F-27〜F-30・F-32。詳細設計書4.2・4.3章手順4・6。★F8)', () => {
  let src: Env
  let dst: Env
  let zipPath: string
  let clientId: number

  beforeEach(() => {
    src = createEnv('src')
    dst = createEnv('dst')
    zipPath = join(src.dir, 'export.zip')
    clientId = src.clients.insert({
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
  })
  afterEach(() => {
    src.db.close()
    dst.db.close()
    rmSync(src.dir, { recursive: true, force: true })
    rmSync(dst.dir, { recursive: true, force: true })
  })

  /** 案件2件(うち1件は完了)・見積書・入出金の紐づけ・付け替え履歴を作る */
  function seed(): { a: number; b: number; quoteId: number; recordId: number } {
    const a = src.projects.createProject({
      name: '案件A',
      clientId,
      startDate: '2026-04-01',
      endDate: '2026-09-30',
      memo: 'メモ'
    }).id
    const b = src.projects.createProject({
      name: '案件B',
      clientId: null,
      startDate: '',
      endDate: '',
      memo: ''
    }).id
    const quoteId = Number(
      src.db.sqlite
        .prepare(
          `INSERT INTO quotes (client_id, issue_date, status) VALUES (?, '2026-10-01', 'draft')`
        )
        .run(clientId).lastInsertRowid
    )
    const accountId = (
      src.db.sqlite.prepare('SELECT id FROM accounts LIMIT 1').get() as { id: number }
    ).id
    const { id: recordId } = src.records.cashRecordService.createRecord({
      kind: 'expense',
      recordDate: '2026-09-28',
      amount: 1000,
      accountId,
      description: '交通費',
      clientId: null,
      paymentMethod: null,
      taxCategory: null,
      projectId: a
    })
    src.records.projectLinkService.changeLink('quote', quoteId, a)
    src.records.projectLinkService.changeLink('quote', quoteId, b)
    src.projects.completeProject(b)
    return { a, b, quoteId, recordId }
  }

  const projectOf = (env: Env, table: string, id: number): number | null =>
    (
      env.db.sqlite.prepare(`SELECT project_id AS p FROM ${table} WHERE id = ?`).get(id) as {
        p: number | null
      }
    ).p

  it('エクスポート: manifestとJSON Linesに案件・付け替え履歴・案件IDを含める', async () => {
    const { a, b, quoteId } = seed()
    expect((await src.service.exportData(zipPath)).success).toBe(true)

    const exported = readExport(zipPath)
    expect(exported.manifest.tables.projects).toEqual({ file: 'data/projects.jsonl', count: 2 })
    expect(exported.manifest.tables.projectLinkHistory?.count).toBe(3)
    expect(exported.records('projects')[0]).toEqual({
      id: a,
      name: '案件A',
      clientId,
      startDate: '2026-04-01',
      endDate: '2026-09-30',
      memo: 'メモ',
      status: 'active',
      createdAt: expect.any(String),
      updatedAt: expect.any(String)
    })
    expect(exported.records('projects')[1]).toMatchObject({ id: b, status: 'completed' })
    expect(exported.records('quotes')[0]).toMatchObject({ id: quoteId, projectId: b })
    expect(exported.records('cashRecords')[0]).toMatchObject({ projectId: a })
    expect(exported.records('projectLinkHistory').map((h) => h.kind)).toEqual([
      'assign',
      'assign',
      'change'
    ])
  })

  it('往復: 案件・紐づけ・付け替え履歴がIDを保ったまま復元され、履歴のトリガーも再作成される', async () => {
    const { a, b, quoteId, recordId } = seed()
    await src.service.exportData(zipPath)

    const result = await dst.service.importData(zipPath)

    expect(result).toMatchObject({ success: true, projectLinkFixCount: 0 })
    const projects = dst.db.sqlite
      .prepare('SELECT id, name, client_id AS clientId, status FROM projects ORDER BY id')
      .all()
    expect(projects).toEqual([
      { id: a, name: '案件A', clientId, status: 'active' },
      { id: b, name: '案件B', clientId: null, status: 'completed' }
    ])
    expect(projectOf(dst, 'quotes', quoteId)).toBe(b)
    expect(projectOf(dst, 'cash_records', recordId)).toBe(a)
    expect(
      (
        dst.db.sqlite.prepare('SELECT COUNT(*) AS c FROM project_link_history').get() as {
          c: number
        }
      ).c
    ).toBe(3)
    expect(() => dst.db.sqlite.exec('DELETE FROM project_link_history')).toThrow(
      '付け替え履歴は削除できません'
    )
    expect(() => dst.db.sqlite.exec("UPDATE project_link_history SET kind = 'assign'")).toThrow(
      '付け替え履歴は変更できません'
    )
    expect(result.recordHashMismatchCount).toBe(0)
  })

  it('復元で、現在の案件・履歴・紐づけはすべて置き換わる(案件を含まない旧形式の復元では、案件が消える)', async () => {
    seed()
    await src.service.exportData(zipPath)
    // 復元先に、別の案件・紐づけがある
    await dst.service.importData(zipPath)
    dst.projects.createProject({
      name: '復元後に追加',
      clientId: null,
      startDate: '',
      endDate: '',
      memo: ''
    })

    // 案件を含まない旧形式(スキーマバージョン4のdata.json)
    const legacy = exportToLegacyJson(zipPath, 4) as { data: Record<string, unknown> }
    delete legacy.data.projects
    delete legacy.data.projectLinkHistory
    const legacyPath = join(dst.dir, 'legacy.json')
    writeFileSync(legacyPath, JSON.stringify(legacy))

    const result = await dst.service.importData(legacyPath)

    expect(result).toMatchObject({ success: true })
    for (const table of ['projects', 'project_link_history']) {
      expect(
        (dst.db.sqlite.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c
      ).toBe(0)
    }
    // 旧形式の見積書・入出金の案件は「案件なし」
    expect(
      (
        dst.db.sqlite
          .prepare('SELECT COUNT(*) AS c FROM quotes WHERE project_id IS NOT NULL')
          .get() as { c: number }
      ).c
    ).toBe(0)
  })

  it('整合の補正(★F8): 存在しない案件を指す紐づけ・存在しない取引先を指す案件は「なし」にして保存し、件数を返す', async () => {
    const { a, quoteId, recordId } = seed()
    await src.service.exportData(zipPath)
    mapExportTable(zipPath, 'quotes', (row) => ({ ...row, projectId: 999 }))
    mapExportTable(zipPath, 'cashRecords', (row) => ({ ...row, projectId: 998 }))
    mapExportTable(zipPath, 'projects', (row) => (row.id === a ? { ...row, clientId: 997 } : row))

    const result = await dst.service.importData(zipPath)

    expect(result.success).toBe(true)
    expect(result.projectLinkFixCount).toBe(3)
    expect(projectOf(dst, 'quotes', quoteId)).toBeNull()
    expect(projectOf(dst, 'cash_records', recordId)).toBeNull()
    expect(
      (
        dst.db.sqlite.prepare('SELECT client_id AS c FROM projects WHERE id = ?').get(a) as {
          c: number | null
        }
      ).c
    ).toBeNull()
    expect(BACKUP_MESSAGES.importSuccess(1, 0, 0, 0, 3)).toContain(
      '案件への紐づけ3件を、対応する案件が無いため「案件なし」にしました'
    )
  })

  it('案件のあるデータを、案件のあるバックアップで復元する際、取り込み順(取引先→案件→見積書等)の外部キーを満たす', async () => {
    seed()
    await src.service.exportData(zipPath)
    // 同じ環境へ復元(現在の案件・取引先・見積書が先に全削除され、再投入される)
    expect((await src.service.importData(zipPath)).success).toBe(true)
    expect(src.projects.listProjects({ status: 'all' })).toHaveLength(2)
  })

  it('復元の途中で失敗した場合は、案件・付け替え履歴・トリガーを元の状態に戻す', async () => {
    const { a } = seed()
    await src.service.exportData(zipPath)
    mapExportTable(zipPath, 'cashRecords', (row) => ({ ...row, kind: 'invalid' }))

    const result = await src.service.importData(zipPath)

    expect(result.success).toBe(false)
    expect(result.error).toContain('復元に失敗しました')
    expect(src.projects.getProject(a).name).toBe('案件A')
    expect(
      (
        src.db.sqlite.prepare('SELECT COUNT(*) AS c FROM project_link_history').get() as {
          c: number
        }
      ).c
    ).toBe(3)
    expect(() => src.db.sqlite.exec('DELETE FROM project_link_history')).toThrow(
      '付け替え履歴は削除できません'
    )
  })

  it('復元後の案件は、削除・付け替えなど通常どおり操作できる', async () => {
    const { a, quoteId } = seed()
    await src.service.exportData(zipPath)
    await dst.service.importData(zipPath)

    expect(() => dst.projects.deleteProject(a)).toThrow(PROJECT_MESSAGES.hasLinks)
    dst.records.projectLinkService.changeLink('quote', quoteId, a)
    expect(projectOf(dst, 'quotes', quoteId)).toBe(a)
    const next = dst.projects.createProject({
      name: '次の案件',
      clientId: null,
      startDate: '',
      endDate: '',
      memo: ''
    })
    expect(next.id).toBeGreaterThan(Math.max(a, 2))
  })
})
