import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import * as fsModule from 'node:fs'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import AdmZip from 'adm-zip'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Database } from '../db/db'
import { ClientRepository } from '../repositories/client.repository'
import { QuoteRepository } from '../repositories/quote.repository'
import { InvoiceRepository } from '../repositories/invoice.repository'
import { CompanyProfileRepository } from '../repositories/company-profile.repository'
import { MigrationService } from './migration.service'
import { BackupService } from './backup.service'
import { CURRENT_SCHEMA_VERSION, type BackupFile } from '@shared/backup/backup-file'
import { BACKUP_MESSAGES } from '@shared/messages/messages'
import type { ClientInput } from '@shared/schemas/client.schema'

/**
 * copyFileSyncのみモック化し、既定では実際のファイルコピーを行う(通常のテストへの影響を避けるため)。
 * 個別のテストでのみ`mockImplementationOnce`で一時的に失敗させる(No.2対応の検証用)。
 */
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fsModule>()
  return { ...actual, copyFileSync: vi.fn(actual.copyFileSync) }
})

const baseInput: ClientInput = {
  name: '株式会社サンプル',
  furigana: 'カブシキガイシャサンプル',
  honorific: '御中',
  contactPerson: '山田太郎',
  postalCode: '123-4567',
  address: '東京都千代田区1-1-1',
  phone: '03-1234-5678',
  email: 'sample@example.com',
  invoiceRegistrationNumber: 'T1234567890123',
  memo: '備考'
}

/**
 * status列のCHECK制約('active'/'inactive'以外は拒否)に違反する復元データ。
 * トランザクション内(insertWithId)で意図的に例外を発生させ、ロールバック・退避復旧を検証するために使用する。
 */
function buildBrokenPayload(): BackupFile {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    appVersion: '0.1.0',
    exportedAt: '2026-09-26T12:00:00.000Z',
    data: {
      companyProfile: null,
      quotes: [],
      quoteLineItems: [],
      invoices: [],
      invoiceLineItems: [],
      clients: [
        {
          id: 999,
          name: '不正データ',
          honorific: '御中',
          contactPerson: null,
          postalCode: null,
          address: null,
          phone: null,
          email: null,
          invoiceRegistrationNumber: null,
          memo: null,
          status: 'invalid-status',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ]
    }
  }
}

describe('BackupService', () => {
  let dir: string
  let dbFilePath: string
  let backupsDir: string
  let exportPath: string
  let documentsDir: string
  let db: Database
  let repository: ClientRepository
  let service: BackupService

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jimuhub-backup-test-'))
    dbFilePath = join(dir, 'data.sqlite')
    backupsDir = join(dir, 'backups')
    exportPath = join(dir, 'export.zip')
    documentsDir = join(dir, 'documents')

    db = new Database(dbFilePath)
    db.initialize()
    repository = new ClientRepository(db)
    service = new BackupService({
      database: db,
      clientRepository: repository,
      migrationService: new MigrationService(),
      dbFilePath,
      backupsDir,
      documentsDir,
      appVersion: '0.1.0'
    })
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('exportDataで全データを含むZIPファイル(data.json)を書き出す', () => {
    repository.insert(baseInput)
    repository.insert({ ...baseInput, name: '2件目' })

    const result = service.exportData(exportPath)

    expect(result.success).toBe(true)
    const written = JSON.parse(
      new AdmZip(exportPath).getEntry('data.json')!.getData().toString('utf-8')
    )
    expect(written.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(written.appVersion).toBe('0.1.0')
    expect(written.data.clients).toHaveLength(2)
  })

  it('exportDataは書き込み失敗時にsuccess:falseを返す', () => {
    const invalidPath = join(dir, 'no-such-directory', 'export.zip')
    const result = service.exportData(invalidPath)
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('exportしたファイルをimportすると同じ件数が復元される(往復確認)', () => {
    repository.insert(baseInput)
    repository.insert({ ...baseInput, name: '2件目' })
    service.exportData(exportPath)

    repository.deleteAll()
    const result = service.importData(exportPath)

    expect(result.success).toBe(true)
    expect(result.importedCount).toBe(2)
    expect(repository.findAllForBackup()).toHaveLength(2)
  })

  it('importDataは復元前にidを保持したまま置き換える(全置換)', () => {
    const { id } = repository.insert(baseInput)
    service.exportData(exportPath)

    repository.insert({ ...baseInput, name: '復元前に追加された取引先' })
    const result = service.importData(exportPath)

    expect(result.success).toBe(true)
    const all = repository.findAllForBackup()
    expect(all.map((c) => c.id)).toEqual([id])
  })

  it('importDataはJSONとして解析できないファイルの場合エラーを返す', () => {
    writeFileSync(exportPath, '{ 壊れたJSON', 'utf-8')
    const result = service.importData(exportPath)

    expect(result.success).toBe(false)
    expect(result.error).toContain('読み込めませんでした')
  })

  it('importDataはschemaVersionが現行より新しい場合エラーを返す', () => {
    writeFileSync(
      exportPath,
      JSON.stringify({
        schemaVersion: CURRENT_SCHEMA_VERSION + 1,
        appVersion: '9.9.9',
        exportedAt: '2026-09-26T12:00:00.000Z',
        data: { clients: [] }
      }),
      'utf-8'
    )

    const result = service.importData(exportPath)
    expect(result.success).toBe(false)
    expect(result.error).toContain('新しいバージョン')
  })

  it('importData実行前に現行DBファイルを退避コピーする', () => {
    repository.insert(baseInput)
    service.exportData(exportPath)

    service.importData(exportPath)

    expect(existsSync(backupsDir)).toBe(true)
    const files = readdirSync(backupsDir)
    expect(files.length).toBeGreaterThan(0)
  })

  it('退避コピーは直近3世代のみ保持する', () => {
    repository.insert(baseInput)
    service.exportData(exportPath)

    for (let i = 0; i < 5; i += 1) {
      service.importData(exportPath)
    }

    const files = readdirSync(backupsDir)
    expect(files.filter((f) => f.endsWith('.sqlite')).length).toBe(3)
    expect(files.filter((f) => f.startsWith('documents_')).length).toBe(3)
  })

  it('復元処理中に例外が発生した場合は、ロールバックし退避コピーから復旧する(詳細設計書4.3章手順8)', () => {
    repository.insert(baseInput)
    service.exportData(exportPath)

    // status列のCHECK制約に違反するデータで、トランザクション内(insertWithId)を意図的に失敗させる
    writeFileSync(exportPath, JSON.stringify(buildBrokenPayload()), 'utf-8')

    const result = service.importData(exportPath)

    // (1) importTransactionFailureが返ること
    expect(result.success).toBe(false)
    expect(result.error).toBe(BACKUP_MESSAGES.importTransactionFailure)

    // (2) データが退避コピー(直前のexportData時点)の内容に戻ること
    const restored = repository.findAllForBackup()
    expect(restored.map((c) => c.name)).toEqual(['株式会社サンプル'])

    // (3) reopenしたあとも正常に動くこと(読み書きが継続できる)
    const { id } = repository.insert({ ...baseInput, name: '再接続後に登録した取引先' })
    expect(repository.findById(id)?.name).toBe('再接続後に登録した取引先')
    expect(repository.findAllForBackup()).toHaveLength(2)
  })

  it('退避コピーからの復旧自体が失敗した場合も、例外を投げずにエラー結果を返す', async () => {
    repository.insert(baseInput)
    service.exportData(exportPath)
    writeFileSync(exportPath, JSON.stringify(buildBrokenPayload()), 'utf-8')

    const { copyFileSync: realCopyFileSync } = await vi.importActual<typeof fsModule>('node:fs')
    const mockedCopyFileSync = vi.mocked(fsModule.copyFileSync)
    // 1回目(復元前の退避コピー作成)は成功させ、2回目(失敗時の復旧コピー)だけ失敗させる
    mockedCopyFileSync.mockImplementationOnce((...args: Parameters<typeof fsModule.copyFileSync>) =>
      realCopyFileSync(...args)
    )
    mockedCopyFileSync.mockImplementationOnce(() => {
      throw new Error('シミュレートしたディスク障害')
    })

    const result = service.importData(exportPath)

    expect(result.success).toBe(false)
    expect(result.error).toBe(BACKUP_MESSAGES.importSafeguardRestoreFailure)
  })

  describe('見積書・請求書・PDFを含むバックアップ(F-02/F-03、T-34)', () => {
    function seedDocuments(): { quoteId: number; invoiceId: number; pdfPath: string } {
      const clientId = repository.insert(baseInput).id
      new CompanyProfileRepository(db).upsert({
        name: 'サンプル商店',
        address: '東京都',
        invoiceRegistrationNumber: 'T1234567890123',
        bankName: '',
        bankBranch: '',
        accountType: '',
        accountNumber: '',
        accountHolder: ''
      })
      const line = {
        name: '品目',
        quantity: 1,
        unit: '式',
        unitPrice: 300000,
        taxRate: 10 as const
      }
      const quoteRepo = new QuoteRepository(db)
      const quoteId = quoteRepo.insert({
        clientId,
        issueDate: '2026-09-20',
        validUntil: '',
        remarks: '',
        lineItems: [line]
      }).id
      quoteRepo.finalize(quoteId, { quoteNumber: '2026-003', invoiceFormat: 'qualified' })
      const pdfPath = join(documentsDir, 'quotes', '2026', '2026-003_株式会社サンプル.pdf')
      mkdirSync(join(documentsDir, 'quotes', '2026'), { recursive: true })
      const pdf = Buffer.from('%PDF quote')
      writeFileSync(pdfPath, pdf)
      quoteRepo.updatePdfInfo(quoteId, {
        pdfPath,
        pdfHash: createHash('sha256').update(pdf).digest('hex')
      })
      const invoiceRepo = new InvoiceRepository(db)
      const invoiceId = invoiceRepo.insert({
        clientId,
        issueDate: '2026-09-22',
        dueDate: '',
        remarks: '',
        lineItems: [{ ...line, withholdingTarget: true }]
      }).id
      invoiceRepo.finalize(invoiceId, { invoiceNumber: '2026-007', invoiceFormat: 'qualified' })
      return { quoteId, invoiceId, pdfPath }
    }

    it('exportDataはPDFをdocuments/配下の相対パスでZIPへ同梱し、data.jsonのpdfPathも相対パスにする', () => {
      const { pdfPath } = seedDocuments()
      service.exportData(exportPath)

      const zip = new AdmZip(exportPath)
      expect(zip.getEntry('documents/quotes/2026/2026-003_株式会社サンプル.pdf')).not.toBeNull()
      const data = JSON.parse(zip.getEntry('data.json')!.getData().toString('utf-8'))
      expect(data.data.quotes[0].pdfPath).toBe(
        'documents/quotes/2026/2026-003_株式会社サンプル.pdf'
      )
      expect(data.data.quotes[0].pdfPath).not.toContain(dir)
      expect(data.data.invoices).toHaveLength(1)
      expect(data.data.companyProfile.name).toBe('サンプル商店')
      expect(existsSync(pdfPath)).toBe(true)
    })

    it('往復すると全データ・PDF・採番シーケンスが復元され、ハッシュ不一致は0件', () => {
      const { quoteId } = seedDocuments()
      service.exportData(exportPath)

      // 現状を壊してから復元する(PDF削除・データ全削除)
      rmSync(documentsDir, { recursive: true, force: true })
      db.sqlite.prepare('DELETE FROM invoice_line_items').run()
      db.sqlite.prepare('DELETE FROM invoices').run()
      db.sqlite.prepare('DELETE FROM quote_line_items').run()
      db.sqlite.prepare('DELETE FROM quotes').run()

      const result = service.importData(exportPath)

      expect(result).toEqual({ success: true, importedCount: 3, pdfHashMismatchCount: 0 })
      const quote = new QuoteRepository(db).findById(quoteId)
      expect(quote?.quoteNumber).toBe('2026-003')
      expect(quote?.lineItems).toHaveLength(1)
      expect(quote?.pdfHashMismatch).toBe(false)
      expect(existsSync(quote!.pdfPath!)).toBe(true)
      expect(quote!.pdfPath).toBe(
        join(documentsDir, 'quotes', '2026', '2026-003_株式会社サンプル.pdf')
      )
      expect(new CompanyProfileRepository(db).get()?.name).toBe('サンプル商店')
      const seq = db.sqlite
        .prepare(
          'SELECT doc_type, year, last_number FROM document_number_sequences ORDER BY doc_type'
        )
        .all()
      expect(seq).toEqual([
        { doc_type: 'invoice', year: 2026, last_number: 7 },
        { doc_type: 'quote', year: 2026, last_number: 3 }
      ])
      const invoice = new InvoiceRepository(db).findAll()[0]
      expect(invoice?.invoiceNumber).toBe('2026-007')
    })

    it('PDFのハッシュが記録値と一致しない書類のみ個別に警告フラグを立て、復元自体は成功する', () => {
      const { quoteId } = seedDocuments()
      service.exportData(exportPath)

      // ZIP内のPDFを改変する
      const zip = new AdmZip(exportPath)
      zip.updateFile(
        'documents/quotes/2026/2026-003_株式会社サンプル.pdf',
        Buffer.from('%PDF tampered')
      )
      zip.writeZip(exportPath)

      const result = service.importData(exportPath)

      expect(result.success).toBe(true)
      expect(result.pdfHashMismatchCount).toBe(1)
      expect(new QuoteRepository(db).findById(quoteId)?.pdfHashMismatch).toBe(true)
      expect(result.success && BACKUP_MESSAGES.importSuccess(3, 1)).toContain('1件')
    })

    it('ZIP内にPDFが存在しない書類も不一致として扱う', () => {
      const { quoteId } = seedDocuments()
      service.exportData(exportPath)
      const zip = new AdmZip(exportPath)
      zip.deleteFile('documents/quotes/2026/2026-003_株式会社サンプル.pdf')
      zip.writeZip(exportPath)

      const result = service.importData(exportPath)
      expect(result.pdfHashMismatchCount).toBe(1)
      expect(new QuoteRepository(db).findById(quoteId)?.pdfHashMismatch).toBe(true)
    })

    it('ZIP形式の復元ではdocumentsフォルダを全置換し、孤立したPDFを残さない', () => {
      seedDocuments()
      service.exportData(exportPath)
      const orphan = join(documentsDir, 'quotes', '2026', 'orphan.pdf')
      writeFileSync(orphan, 'x')

      service.importData(exportPath)
      expect(existsSync(orphan)).toBe(false)
    })

    it('旧JSON形式(schemaVersion1・取引先のみ)も復元でき、documentsフォルダには手を加えない', () => {
      const { pdfPath } = seedDocuments()
      const legacy = {
        schemaVersion: 1,
        appVersion: '0.1.0',
        exportedAt: '2026-09-26T12:00:00.000Z',
        data: {
          clients: [
            {
              id: 50,
              name: '旧形式の取引先',
              honorific: '様',
              contactPerson: null,
              postalCode: null,
              address: null,
              phone: null,
              email: null,
              invoiceRegistrationNumber: null,
              memo: null,
              status: 'active',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z'
            }
          ]
        }
      }
      const jsonPath = join(dir, 'legacy.json')
      writeFileSync(jsonPath, JSON.stringify(legacy), 'utf-8')

      const result = service.importData(jsonPath)

      expect(result).toEqual({ success: true, importedCount: 1 })
      expect(repository.findById(50)?.furigana).toBeNull()
      expect(existsSync(pdfPath)).toBe(true)
      expect(new QuoteRepository(db).findAll()).toHaveLength(0)
    })

    it('旧JSON形式(schemaVersion2・PDFパスのみ記録)でも見積書・請求書を復元し、ハッシュ照合は行わない', () => {
      const { quoteId } = seedDocuments()
      service.exportData(exportPath)
      const data = JSON.parse(
        new AdmZip(exportPath).getEntry('data.json')!.getData().toString('utf-8')
      )
      data.schemaVersion = 2
      for (const q of data.data.quotes) delete q.pdfHashMismatch
      const jsonPath = join(dir, 'v2.json')
      writeFileSync(jsonPath, JSON.stringify(data), 'utf-8')

      const result = service.importData(jsonPath)

      expect(result.success).toBe(true)
      expect(result.pdfHashMismatchCount).toBeUndefined()
      expect(new QuoteRepository(db).findById(quoteId)?.pdfHashMismatch).toBe(false)
    })

    it('ZIPにdata.jsonが無い場合・壊れたZIPの場合は解析エラーを返す', () => {
      const noData = new AdmZip()
      noData.addFile('documents/a.pdf', Buffer.from('x'))
      noData.writeZip(join(dir, 'nodata.zip'))
      expect(service.importData(join(dir, 'nodata.zip')).error).toBe(
        BACKUP_MESSAGES.importParseFailure
      )

      const broken = Buffer.concat([Buffer.from('PK'), Buffer.from('壊れたZIP')])
      writeFileSync(join(dir, 'broken.zip'), broken)
      expect(service.importData(join(dir, 'broken.zip')).error).toBe(
        BACKUP_MESSAGES.importParseFailure
      )
    })

    it('ZIP内の親ディレクトリ参照を含むエントリは書き出さず、正常なPDFは復元する(ZIPスリップ対策)', () => {
      const { quoteId } = seedDocuments()
      service.exportData(exportPath)
      const zip = new AdmZip(exportPath)
      zip.addFile('documents/../../evil.txt', Buffer.from('x'))
      zip.addFile('documents/quotes/../../../evil2.txt', Buffer.from('x'))
      zip.writeZip(exportPath)
      rmSync(documentsDir, { recursive: true, force: true })

      const result = service.importData(exportPath)

      expect(result.success).toBe(true)
      expect(result.pdfHashMismatchCount).toBe(0)
      expect(
        existsSync(join(documentsDir, 'quotes', '2026', '2026-003_株式会社サンプル.pdf'))
      ).toBe(true)
      expect(new QuoteRepository(db).findById(quoteId)?.pdfHashMismatch).toBe(false)
      expect(existsSync(join(dir, '..', 'evil.txt'))).toBe(false)
      expect(existsSync(join(dir, 'evil.txt'))).toBe(false)
      expect(existsSync(join(dir, 'evil2.txt'))).toBe(false)
      expect(existsSync(join(documentsDir, '..', 'evil2.txt'))).toBe(false)
    })

    it.each(['/Applications/Calculator.app', 'documents/../../outside.pdf', '../outside.pdf'])(
      'data.jsonのpdfPathが %s のように documents/ 配下に収まらない場合は採用しない(I1-03)',
      (badPath) => {
        const { quoteId } = seedDocuments()
        service.exportData(exportPath)
        const zip = new AdmZip(exportPath)
        const data = JSON.parse(zip.getEntry('data.json')!.getData().toString('utf-8'))
        data.data.quotes[0].pdfPath = badPath
        zip.updateFile('data.json', Buffer.from(JSON.stringify(data)))
        zip.writeZip(exportPath)

        const result = service.importData(exportPath)

        expect(result.success).toBe(true)
        const restored = new QuoteRepository(db).findById(quoteId)
        expect(restored?.pdfPath).toBeNull()
      }
    )

    it('復元前の退避コピー作成に失敗した場合は、例外を投げず失敗結果を返しデータに触れない(I1-06)', () => {
      repository.insert(baseInput)
      service.exportData(exportPath)
      repository.insert({ ...baseInput, name: '復元前に追加した取引先' })
      vi.mocked(fsModule.copyFileSync).mockImplementationOnce(() => {
        throw new Error('シミュレートした容量不足')
      })

      const result = service.importData(exportPath)

      expect(result.success).toBe(false)
      expect(result.error).toBe(BACKUP_MESSAGES.importTransactionFailure)
      expect(repository.findAllForBackup()).toHaveLength(2)
    })

    it('ZIP形式の復元に失敗した場合、documentsフォルダも復元前の状態へ戻す', () => {
      const { pdfPath } = seedDocuments()
      const zip = new AdmZip()
      zip.addFile('data.json', Buffer.from(JSON.stringify(buildBrokenPayload())))
      zip.addFile('documents/new.pdf', Buffer.from('new'))
      zip.writeZip(join(dir, 'broken-data.zip'))

      const result = service.importData(join(dir, 'broken-data.zip'))

      expect(result.error).toBe(BACKUP_MESSAGES.importTransactionFailure)
      expect(existsSync(pdfPath)).toBe(true)
      expect(existsSync(join(documentsDir, 'new.pdf'))).toBe(false)
    })

    it('ZIP内の.pdf以外のエントリは書き出さず、data.jsonのpdfPathが.pdf以外を指す場合は採用しない(SEC-10)', () => {
      const { quoteId } = seedDocuments()
      service.exportData(exportPath)
      const zip = new AdmZip(exportPath)
      zip.addFile('documents/quotes/2026/evil.terminal', Buffer.from('x'))
      const data = JSON.parse(zip.getEntry('data.json')!.getData().toString('utf-8'))
      data.data.quotes[0].pdfPath = 'documents/quotes/2026/evil.terminal'
      zip.updateFile('data.json', Buffer.from(JSON.stringify(data)))
      zip.writeZip(exportPath)

      const result = service.importData(exportPath)

      expect(result.success).toBe(true)
      expect(existsSync(join(documentsDir, 'quotes', '2026', 'evil.terminal'))).toBe(false)
      expect(
        existsSync(join(documentsDir, 'quotes', '2026', '2026-003_株式会社サンプル.pdf'))
      ).toBe(true)
      expect(new QuoteRepository(db).findById(quoteId)?.pdfPath).toBeNull()
    })

    describe('復元ファイルのサイズ・エントリ数の上限(SEC-09)', () => {
      function serviceWithLimits(limits: {
        maxFileBytes?: number
        maxEntries?: number
        maxTotalUncompressedBytes?: number
      }): BackupService {
        return new BackupService({
          database: db,
          clientRepository: repository,
          migrationService: new MigrationService(),
          dbFilePath,
          backupsDir,
          documentsDir,
          appVersion: '0.1.0',
          restoreLimits: limits
        })
      }

      it('ファイルサイズが上限を超える場合は、展開せず解析エラーを返しデータに触れない', () => {
        repository.insert(baseInput)
        service.exportData(exportPath)
        repository.insert({ ...baseInput, name: '復元前に追加した取引先' })

        const result = serviceWithLimits({ maxFileBytes: 10 }).importData(exportPath)

        expect(result.error).toBe(BACKUP_MESSAGES.importParseFailure)
        expect(repository.findAllForBackup()).toHaveLength(2)
        expect(existsSync(backupsDir)).toBe(false)
      })

      it('ZIPのエントリ数が上限を超える場合は解析エラーを返す', () => {
        seedDocuments()
        service.exportData(exportPath)
        const zip = new AdmZip(exportPath)
        zip.addFile('documents/extra1.pdf', Buffer.from('x'))
        zip.addFile('documents/extra2.pdf', Buffer.from('x'))
        zip.writeZip(exportPath)

        const result = serviceWithLimits({ maxEntries: 3 }).importData(exportPath)

        expect(result.error).toBe(BACKUP_MESSAGES.importParseFailure)
      })

      it('展開後の合計サイズ(宣言値)が上限を超える場合は、展開せず解析エラーを返す(解凍爆弾対策)', () => {
        seedDocuments()
        service.exportData(exportPath)
        const zip = new AdmZip(exportPath)
        // 高圧縮率のエントリ(ZIPファイル自体は小さいが展開後は大きい)
        zip.addFile('documents/bomb.pdf', Buffer.alloc(1024 * 1024, 0))
        zip.writeZip(exportPath)

        const result = serviceWithLimits({ maxTotalUncompressedBytes: 512 * 1024 }).importData(
          exportPath
        )

        expect(result.error).toBe(BACKUP_MESSAGES.importParseFailure)
        expect(existsSync(join(documentsDir, 'bomb.pdf'))).toBe(false)
      })

      it('上限内であれば従来どおり復元できる(既定値)', () => {
        seedDocuments()
        service.exportData(exportPath)

        expect(service.importData(exportPath).success).toBe(true)
      })
    })

    it('detectFormatはPKシグネチャでZIP/JSONを判定する', () => {
      expect(service.detectFormat(Buffer.from('PK\u0003\u0004xxxx'))).toBe('zip')
      expect(service.detectFormat(Buffer.from('{"a":1}'))).toBe('json')
    })
  })
})
