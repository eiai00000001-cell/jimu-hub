import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { mapExportTable, readExport, renameEntryInZip } from './backup/test-helpers'
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

  it('エクスポート: スキーマv5のmanifest・JSON Linesに新テーブルを含め、領収書のfilePathは`documents/`始まり、履歴はオブジェクト、領収書ファイルを同梱する(外した領収書も)', async () => {
    seed()
    expect((await src.service.exportData(zipPath)).success).toBe(true)
    const exported = readExport(zipPath)
    expect(exported.manifest.schemaVersion).toBe(5)
    expect(exported.records('accounts')).toHaveLength(INITIAL_ACCOUNTS.length)
    expect(exported.records('cashRecords')).toHaveLength(2)
    expect(exported.records('cashRecords').find((r) => r.isDeleted === true)).toBeDefined()
    expect(exported.records('receipts')).toHaveLength(2)
    for (const r of exported.records('receipts')) {
      expect(r.filePath).toMatch(/^documents\/receipts\/\d{4}\/[0-9a-f-]{36}\.pdf$/)
    }
    const history = exported.records('cashRecordHistory')
    expect(history.length).toBeGreaterThanOrEqual(4)
    expect(typeof history[0]!.snapshotAfter).toBe('object')
    expect(
      [...exported.entries.keys()].filter((n) => n.startsWith('documents/receipts/'))
    ).toHaveLength(2)
  })

  it('往復: 別の環境へ復元すると、ID・履歴・領収書ファイルが復元され、照合の不一致は0件。履歴のトリガーも再作成される', async () => {
    const { recordId } = seed()
    await src.service.exportData(zipPath)
    const result = await dst.service.importData(zipPath)
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

  it('復元時の照合: 領収書の改変・欠落・記録の改ざんを件数で返し、復元は中断しない', async () => {
    seed()
    await src.service.exportData(zipPath)
    const zip = new AdmZip(zipPath)
    const receiptEntries = zip
      .getEntries()
      .filter((e) => e.entryName.startsWith('documents/receipts/') && !e.isDirectory)
    zip.updateFile(receiptEntries[0]!.entryName, Buffer.from('%PDF-1.4\ntampered'))
    zip.deleteFile(receiptEntries[1]!.entryName)
    const tampered = join(src.dir, 'tampered.zip')
    zip.writeZip(tampered)
    mapExportTable(tampered, 'cashRecords', (row, i) => (i === 0 ? { ...row, amount: 1 } : row))

    const result = await dst.service.importData(tampered)
    expect(result).toMatchObject({
      success: true,
      receiptHashMismatchCount: 2,
      recordHashMismatchCount: 1
    })
    expect(dst.records.cashRecordService.listRecords({}).totalCount).toBe(1)
  })

  it('復元時の照合: ハッシュが一致しても、中身が拡張子と異なる(マジックナンバー不一致)領収書は不一致に数える(R-17)', async () => {
    seed()
    await src.service.exportData(zipPath)
    const zip = new AdmZip(zipPath)
    const targetPath = String(readExport(zipPath).records('receipts')[0]!.filePath)
    const fake = Buffer.from('MZ not a pdf')
    zip.updateFile(targetPath, fake)
    const forged = join(src.dir, 'forged.zip')
    zip.writeZip(forged)
    mapExportTable(forged, 'receipts', (row, i) =>
      i === 0 ? { ...row, sha256: createHash('sha256').update(fake).digest('hex') } : row
    )

    const result = await dst.service.importData(forged)
    expect(result).toMatchObject({ success: true, receiptHashMismatchCount: 1 })
    expect(dst.records.cashRecordService.listRecords({}).totalCount).toBe(1)
  })

  it('不正なエントリ・パスは採用しない(形式に一致しない領収書エントリ・パストラバーサル。filePathは空文字で欠落扱い)', async () => {
    seed()
    await src.service.exportData(zipPath)
    const zip = new AdmZip(zipPath)
    zip.addFile('documents/receipts/2026/evil.exe', Buffer.from('MZ'))
    zip.addFile('documents/receipts/2026/not-a-uuid.pdf', dummyPdf('x'))
    const evil = join(src.dir, 'evil.zip')
    zip.writeZip(evil)
    mapExportTable(evil, 'receipts', (row, i) =>
      i === 0 ? { ...row, filePath: '../../etc/hosts.pdf' } : row
    )

    const result = await dst.service.importData(evil)
    expect(result).toMatchObject({ success: true, receiptHashMismatchCount: 1 })
    const row = dst.db.sqlite.prepare('SELECT file_path FROM receipts ORDER BY id').all() as Array<{
      file_path: string
    }>
    expect(row[0]!.file_path).toBe('')
    const names = readdirSync(join(dst.documentsDir, 'receipts'), { recursive: true }).map(String)
    expect(names.some((n) => n.includes('evil') || n.includes('not-a-uuid'))).toBe(false)
    expect(existsSync(join(dst.dir, 'outside.pdf'))).toBe(false)
  })

  it('親ディレクトリ参照を含むエントリがあるZIPは、細工されたファイルとして復元を中断し、現在のデータを変更しない(ZIPスリップ対策)', async () => {
    seed()
    await src.service.exportData(zipPath)
    const slipName = 'documents/receipts/../../outside.pdf'
    const placeholder = 'x'.repeat(slipName.length)
    const zip = new AdmZip(zipPath)
    zip.addFile(placeholder, dummyPdf('y'))
    const slip = join(src.dir, 'slip.zip')
    zip.writeZip(slip)
    renameEntryInZip(slip, placeholder, slipName)

    const result = await dst.service.importData(slip)
    expect(result.success).toBe(false)
    expect(result.error).toContain('読み込めませんでした')
    expect(existsSync(join(dst.dir, 'outside.pdf'))).toBe(false)
    expect(dst.records.cashRecordService.listRecords({}).totalCount).toBe(0)
  })

  it('旧形式(スキーマv3)の復元: 勘定科目は初期科目14件、入出金・領収書・履歴は空になる(ZIPではdocumentsも全置換)', async () => {
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

    const result = await dst.service.importData(v3Zip)
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

  it('旧形式(JSON単体・v3)の復元では、documentsフォルダに手を加えない', async () => {
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
    const result = await dst.service.importData(json)
    expect(result.success).toBe(true)
    expect(result.receiptHashMismatchCount).toBeUndefined()
    expect(existsSync(join(dst.documentsDir, 'receipts'))).toBe(true)
  })

  it('復元の途中で失敗した場合は、ロールバックして元のデータ・トリガーを維持する', async () => {
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
    await src.service.exportData(zipPath)
    const broken = join(src.dir, 'broken.zip')
    new AdmZip(zipPath).writeZip(broken)
    mapExportTable(broken, 'cashRecords', (row, i) => (i === 0 ? { ...row, kind: 'invalid' } : row))

    const result = await dst.service.importData(broken)
    expect(result.success).toBe(false)
    expect(result.error).toContain('復元に失敗しました')
    expect(dst.records.cashRecordService.listRecords({}).items[0]!.description).toBe('元のデータ')
    expect(() => dst.db.sqlite.prepare('DELETE FROM cash_record_history').run()).toThrow(
      '履歴は削除できません'
    )
  })

  it('進捗: エクスポートはテーブル→ファイル1件ごと→仕上げの順、復元は展開→照合の順に、現在件数と総数を通知する', async () => {
    seed()
    const exp: Array<[string, number, number]> = []
    await src.service.exportData(zipPath, (p) => exp.push([p.stage, p.current, p.total]))
    const records = exp.filter(([stage]) => stage === 'records')
    expect(records).toHaveLength(12)
    expect(records.at(-1)).toEqual(['records', 12, 12])
    // PDF・領収書ファイル(領収書2件)は、1件ごとに通知する。最後はZIPの仕上げ中を示す通知(packing)
    expect(exp.filter(([stage]) => stage === 'files')).toEqual([
      ['files', 1, 2],
      ['files', 2, 2]
    ])
    expect(exp.filter(([stage]) => stage === 'packing')).toEqual([['packing', 2, 2]])

    const imp: Array<[string, string, number, number]> = []
    await dst.service.importData(zipPath, (p) => imp.push([p.phase, p.stage, p.current, p.total]))
    // 展開したファイル(manifest・.jsonl・領収書)ごとに通知する
    const extract = imp.filter(([, stage]) => stage === 'extract')
    expect(extract).toHaveLength(15)
    expect(extract.at(-1)).toEqual(['import', 'extract', 15, 15])
    expect(imp.every(([phase]) => phase === 'import')).toBe(true)
  })

  it('80%超の警告: 領収書・PDFの見込みサイズが復元上限の80%を超える場合のみtrue(上限は差し替え可能)', async () => {
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
