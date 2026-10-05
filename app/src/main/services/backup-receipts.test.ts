import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { Database } from '../db/db'
import { ClientRepository } from '../repositories/client.repository'
import { BackupService } from './backup.service'
import { MigrationService } from './migration.service'
import { createRecordServices } from './record-services'
import { INITIAL_ACCOUNTS } from '@shared/constants/accounts'

/** ダミーの領収書(実ファイルは使わない) */
const dummyPdf = (tag: string): Buffer => Buffer.from(`%PDF-1.4\n${tag}`)

interface Env {
  dir: string
  db: Database
  documentsDir: string
  service: BackupService
  records: ReturnType<typeof createRecordServices>
}

function createEnv(name: string, restoreLimits?: { maxFileBytes: number }): Env {
  const dir = mkdtempSync(join(tmpdir(), `jimuhub-bk-${name}-`))
  const dbFile = join(dir, 'data.sqlite')
  const documentsDir = join(dir, 'documents')
  const db = new Database(dbFile)
  db.initialize()
  const service = new BackupService({
    database: db,
    clientRepository: new ClientRepository(db),
    migrationService: new MigrationService(),
    dbFilePath: dbFile,
    backupsDir: join(dir, 'backups'),
    documentsDir,
    appVersion: '0.3.0',
    restoreLimits
  })
  return { dir, db, documentsDir, service, records: createRecordServices(db, documentsDir) }
}

describe('BackupService: 入出金・領収書のエクスポート/復元(F-02/F-03・F-22。詳細設計書4.2・4.3章)', () => {
  let src: Env
  let dst: Env
  let zipPath: string
  let expenseAccount: number

  beforeEach(() => {
    src = createEnv('src')
    dst = createEnv('dst')
    zipPath = join(src.dir, 'export.zip')
    expenseAccount = (
      src.db.sqlite.prepare("SELECT id FROM accounts WHERE name = '通信費'").get() as { id: number }
    ).id
  })
  afterEach(() => {
    src.db.close()
    dst.db.close()
    rmSync(src.dir, { recursive: true, force: true })
    rmSync(dst.dir, { recursive: true, force: true })
  })

  /** 領収書2件(うち1件は外す)つきの記録と、削除済みの記録を作る */
  function seed(): { recordId: number } {
    const stage = (name: string, content: Buffer): string => {
      const p = join(src.dir, name)
      writeFileSync(p, content)
      return src.records.receiptService.pickAndStage([p]).files[0]!.token
    }
    const input = {
      kind: 'expense' as const,
      recordDate: '2026-09-28',
      amount: 6600,
      accountId: expenseAccount,
      description: 'インターネット回線',
      clientId: null,
      paymentMethod: null,
      taxCategory: 'standard_10' as const
    }
    const { id } = src.records.cashRecordService.createRecord({
      ...input,
      receiptTokens: [stage('a.pdf', dummyPdf('a')), stage('b.pdf', dummyPdf('b'))]
    })
    const first = src.records.cashRecordService.getRecord(id).receipts[0]!.id
    src.records.cashRecordService.updateRecord({
      ...input,
      id,
      removeReceiptIds: [first],
      reason: '外す'
    })
    const deleted = src.records.cashRecordService.createRecord({
      ...input,
      description: '削除する記録'
    })
    src.records.cashRecordService.deleteRecord({ id: deleted.id, reason: '誤登録' })
    return { recordId: id }
  }

  type Rows = Array<Record<string, unknown>>
  interface Payload {
    schemaVersion: number
    data: { accounts: Rows; cashRecords: Rows; receipts: Rows; cashRecordHistory: Rows }
  }
  const readPayload = (path: string): Payload =>
    JSON.parse(new AdmZip(path).getEntry('data.json')!.getData().toString('utf-8'))

  it('エクスポート: スキーマv4のdata.jsonに新テーブルを含め、領収書のfilePathは`documents/`始まり、履歴はオブジェクト、領収書ファイルを同梱する(外した領収書も)', () => {
    seed()
    expect(src.service.exportData(zipPath).success).toBe(true)
    const payload = readPayload(zipPath)
    expect(payload.schemaVersion).toBe(4)
    expect(payload.data.accounts).toHaveLength(INITIAL_ACCOUNTS.length)
    expect(payload.data.cashRecords).toHaveLength(2)
    expect(payload.data.cashRecords.find((r) => r.isDeleted === true)).toBeDefined()
    expect(payload.data.receipts).toHaveLength(2)
    for (const r of payload.data.receipts) {
      expect(r.filePath).toMatch(/^documents\/receipts\/\d{4}\/[0-9a-f-]{36}\.pdf$/)
    }
    expect(payload.data.cashRecordHistory.length).toBeGreaterThanOrEqual(4)
    expect(typeof payload.data.cashRecordHistory[0]!.snapshotAfter).toBe('object')
    const entries = new AdmZip(zipPath).getEntries().map((e) => e.entryName)
    expect(entries.filter((n) => n.startsWith('documents/receipts/'))).toHaveLength(2)
  })

  it('往復: 別の環境へ復元すると、ID・履歴・領収書ファイルが復元され、照合の不一致は0件。履歴のトリガーも再作成される', () => {
    const { recordId } = seed()
    src.service.exportData(zipPath)
    const result = dst.service.importData(zipPath)
    expect(result).toMatchObject({
      success: true,
      pdfHashMismatchCount: 0,
      receiptHashMismatchCount: 0,
      recordHashMismatchCount: 0
    })
    const restored = dst.records.cashRecordService.getRecord(recordId)
    expect(restored.receipts).toHaveLength(2)
    expect(restored.receipts.map((r) => [r.removed, r.state])).toEqual([
      [true, 'ok'],
      [false, 'ok']
    ])
    expect(restored.history.map((h) => h.operation)).toEqual(['update', 'create'])
    expect(restored.integrity).toMatchObject({ recordHashOk: true, historyHashOk: true })
    expect(dst.records.cashRecordService.listRecords({}).totalCount).toBe(1)
    expect(() => dst.db.sqlite.prepare('DELETE FROM cash_record_history').run()).toThrow(
      '履歴は削除できません'
    )
    expect(() =>
      dst.db.sqlite.prepare("UPDATE cash_record_history SET reason = 'x'").run()
    ).toThrow('履歴は変更できません')
    const receiptFiles = readdirSync(join(dst.documentsDir, 'receipts'), {
      recursive: true,
      withFileTypes: true
    }).filter((e) => e.isFile())
    expect(receiptFiles).toHaveLength(2)
  })

  it('復元時の照合: 領収書の改変・欠落・記録の改ざんを件数で返し、復元は中断しない', () => {
    seed()
    src.service.exportData(zipPath)
    const zip = new AdmZip(zipPath)
    const receiptEntries = zip
      .getEntries()
      .filter((e) => e.entryName.startsWith('documents/receipts/') && !e.isDirectory)
    zip.updateFile(receiptEntries[0]!.entryName, Buffer.from('%PDF-1.4\ntampered'))
    zip.deleteFile(receiptEntries[1]!.entryName)
    const payload = JSON.parse(zip.getEntry('data.json')!.getData().toString('utf-8'))
    payload.data.cashRecords[0].amount = 1
    zip.updateFile('data.json', Buffer.from(JSON.stringify(payload)))
    const tampered = join(src.dir, 'tampered.zip')
    zip.writeZip(tampered)

    const result = dst.service.importData(tampered)
    expect(result).toMatchObject({
      success: true,
      receiptHashMismatchCount: 2,
      recordHashMismatchCount: 1
    })
    expect(dst.records.cashRecordService.listRecords({}).totalCount).toBe(1)
  })

  it('復元時の照合: ハッシュが一致しても、中身が拡張子と異なる(マジックナンバー不一致)領収書は不一致に数える(R-17)', () => {
    seed()
    src.service.exportData(zipPath)
    const zip = new AdmZip(zipPath)
    const payload = JSON.parse(zip.getEntry('data.json')!.getData().toString('utf-8'))
    const target = payload.data.receipts[0]
    const fake = Buffer.from('MZ not a pdf')
    zip.updateFile(target.filePath, fake)
    target.sha256 = createHash('sha256').update(fake).digest('hex')
    zip.updateFile('data.json', Buffer.from(JSON.stringify(payload)))
    const forged = join(src.dir, 'forged.zip')
    zip.writeZip(forged)

    const result = dst.service.importData(forged)
    expect(result).toMatchObject({ success: true, receiptHashMismatchCount: 1 })
    expect(dst.records.cashRecordService.listRecords({}).totalCount).toBe(1)
  })

  it('不正なエントリ・パスは採用しない(形式に一致しない領収書エントリ・パストラバーサル。filePathは空文字で欠落扱い)', () => {
    seed()
    src.service.exportData(zipPath)
    const zip = new AdmZip(zipPath)
    zip.addFile('documents/receipts/2026/evil.exe', Buffer.from('MZ'))
    zip.addFile('documents/receipts/2026/not-a-uuid.pdf', dummyPdf('x'))
    zip.addFile('documents/receipts/../../outside.pdf', dummyPdf('y'))
    const payload = JSON.parse(zip.getEntry('data.json')!.getData().toString('utf-8'))
    payload.data.receipts[0].filePath = '../../etc/hosts.pdf'
    zip.updateFile('data.json', Buffer.from(JSON.stringify(payload)))
    const evil = join(src.dir, 'evil.zip')
    zip.writeZip(evil)

    const result = dst.service.importData(evil)
    expect(result).toMatchObject({ success: true, receiptHashMismatchCount: 1 })
    const row = dst.db.sqlite.prepare('SELECT file_path FROM receipts ORDER BY id').all() as Array<{
      file_path: string
    }>
    expect(row[0]!.file_path).toBe('')
    const names = readdirSync(join(dst.documentsDir, 'receipts'), { recursive: true }).map(String)
    expect(names.some((n) => n.includes('evil') || n.includes('not-a-uuid'))).toBe(false)
    expect(existsSync(join(dst.dir, 'outside.pdf'))).toBe(false)
  })

  it('旧形式(スキーマv3)の復元: 勘定科目は初期科目14件、入出金・領収書・履歴は空になる(ZIPではdocumentsも全置換)', () => {
    const v3 = {
      schemaVersion: 3,
      appVersion: '0.2.0',
      exportedAt: '2026-09-28T00:00:00.000Z',
      data: {
        clients: [],
        companyProfile: null,
        quotes: [],
        quoteLineItems: [],
        invoices: [],
        invoiceLineItems: []
      }
    }
    const zip = new AdmZip()
    zip.addFile('data.json', Buffer.from(JSON.stringify(v3)))
    const v3Zip = join(src.dir, 'v3.zip')
    zip.writeZip(v3Zip)
    // 復元先には、事前に入出金と領収書がある
    const dummy = join(dst.dir, 'pre.pdf')
    writeFileSync(dummy, dummyPdf('pre'))
    dst.records.cashRecordService.createRecord({
      kind: 'expense',
      recordDate: '2026-09-01',
      amount: 100,
      accountId: expenseAccount,
      description: 'x',
      clientId: null,
      paymentMethod: null,
      taxCategory: null,
      receiptTokens: dst.records.receiptService.pickAndStage([dummy]).files.map((f) => f.token)
    })

    const result = dst.service.importData(v3Zip)
    expect(result).toMatchObject({
      success: true,
      receiptHashMismatchCount: 0,
      recordHashMismatchCount: 0
    })
    const accounts = dst.db.sqlite
      .prepare('SELECT name, is_default, default_key FROM accounts ORDER BY id')
      .all() as Array<{ name: string; is_default: number; default_key: string | null }>
    expect(accounts).toHaveLength(14)
    expect(accounts.every((a) => a.is_default === 1)).toBe(true)
    expect(accounts.find((a) => a.default_key === 'sales_revenue')?.name).toBe('売上高')
    for (const table of ['cash_records', 'receipts', 'cash_record_history']) {
      expect(
        (dst.db.sqlite.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c
      ).toBe(0)
    }
    expect(existsSync(join(dst.documentsDir, 'receipts'))).toBe(false)
  })

  it('旧形式(JSON単体・v3)の復元では、documentsフォルダに手を加えない', () => {
    const dummy = join(dst.dir, 'pre.pdf')
    writeFileSync(dummy, dummyPdf('pre'))
    dst.records.cashRecordService.createRecord({
      kind: 'expense',
      recordDate: '2026-09-01',
      amount: 100,
      accountId: expenseAccount,
      description: 'x',
      clientId: null,
      paymentMethod: null,
      taxCategory: null,
      receiptTokens: dst.records.receiptService.pickAndStage([dummy]).files.map((f) => f.token)
    })
    const json = join(src.dir, 'old.json')
    writeFileSync(
      json,
      JSON.stringify({
        schemaVersion: 3,
        appVersion: '0.2.0',
        exportedAt: 'x',
        data: { clients: [] }
      })
    )
    const result = dst.service.importData(json)
    expect(result.success).toBe(true)
    expect(result.receiptHashMismatchCount).toBeUndefined()
    expect(existsSync(join(dst.documentsDir, 'receipts'))).toBe(true)
  })

  it('復元の途中で失敗した場合は、ロールバックして元のデータ・トリガーを維持する', () => {
    dst.records.cashRecordService.createRecord({
      kind: 'expense',
      recordDate: '2026-09-01',
      amount: 100,
      accountId: expenseAccount,
      description: '元のデータ',
      clientId: null,
      paymentMethod: null,
      taxCategory: null
    })
    seed()
    src.service.exportData(zipPath)
    const zip = new AdmZip(zipPath)
    const payload = JSON.parse(zip.getEntry('data.json')!.getData().toString('utf-8'))
    payload.data.cashRecords[0].kind = 'invalid'
    zip.updateFile('data.json', Buffer.from(JSON.stringify(payload)))
    const broken = join(src.dir, 'broken.zip')
    zip.writeZip(broken)

    const result = dst.service.importData(broken)
    expect(result.success).toBe(false)
    expect(result.error).toContain('復元に失敗しました')
    expect(dst.records.cashRecordService.listRecords({}).items[0]!.description).toBe('元のデータ')
    expect(() => dst.db.sqlite.prepare('DELETE FROM cash_record_history').run()).toThrow(
      '履歴は削除できません'
    )
  })

  it('進捗: エクスポート・復元ともに、ファイル1件ごとに現在件数と総数を通知する', () => {
    seed()
    const exp: Array<[number, number]> = []
    src.service.exportData(zipPath, (p) => exp.push([p.current, p.total]))
    // 最後は、ZIPの生成・書き込み中を示す通知(packing)
    expect(exp).toEqual([
      [1, 2],
      [2, 2],
      [2, 2]
    ])
    const stages: Array<string | undefined> = []
    src.service.exportData(zipPath, (p) => stages.push(p.stage))
    expect(stages).toEqual([undefined, undefined, 'packing'])
    const imp: Array<[string, number, number]> = []
    dst.service.importData(zipPath, (p) => imp.push([p.phase, p.current, p.total]))
    expect(imp).toEqual([
      ['import', 1, 2],
      ['import', 2, 2]
    ])
  })

  it('80%超の警告: 領収書・PDFの見込みサイズが復元上限の80%を超える場合のみtrue(上限は差し替え可能)', () => {
    seed()
    expect(src.service.isLargeBackup()).toBe(false)
    const small = createEnv('small', { maxFileBytes: 20 })
    try {
      // 同じDBファイルの別サービスは使えないため、小さな上限のサービスで領収書を登録して確認する
      const stagePath = join(small.dir, 'r.pdf')
      writeFileSync(stagePath, dummyPdf('large-enough-content'))
      const acc = (
        small.db.sqlite.prepare("SELECT id FROM accounts WHERE name = '通信費'").get() as {
          id: number
        }
      ).id
      small.records.cashRecordService.createRecord({
        kind: 'expense',
        recordDate: '2026-09-01',
        amount: 100,
        accountId: acc,
        description: 'x',
        clientId: null,
        paymentMethod: null,
        taxCategory: null,
        receiptTokens: small.records.receiptService
          .pickAndStage([stagePath])
          .files.map((f) => f.token)
      })
      expect(small.service.isLargeBackup()).toBe(true)
      // 上限(20バイト)を超える見込みサイズなら、書き出し中止の対象(通常の上限では対象外)
      expect(small.service.isTooLargeBackup()).toBe(true)
      expect(src.service.isTooLargeBackup()).toBe(false)
    } finally {
      small.db.close()
      rmSync(small.dir, { recursive: true, force: true })
    }
  })
})
