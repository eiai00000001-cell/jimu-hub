import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import AdmZip from 'adm-zip'
import {
  BackupFileSchema,
  CURRENT_SCHEMA_VERSION,
  type BackupFile,
  type BackupRow
} from '@shared/backup/backup-file'
import { BACKUP_MESSAGES } from '@shared/messages/messages'
import type { Database } from '../db/db'
import type { ClientRepository } from '../repositories/client.repository'
import type { MigrationService } from './migration.service'
import {
  COMPANY_PROFILE_TABLE,
  INVOICE_LINE_ITEMS_TABLE,
  INVOICES_TABLE,
  QUOTE_LINE_ITEMS_TABLE,
  QUOTES_TABLE,
  insertRow,
  readRows
} from './backup-tables'

const MAX_BACKUP_GENERATIONS = 3
const BACKUP_FILE_PREFIX = 'data_'
const BACKUP_FILE_SUFFIX = '.sqlite'
const DOCUMENTS_BACKUP_PREFIX = 'documents_'
const DATA_JSON_ENTRY = 'data.json'
const DOCUMENTS_ENTRY_PREFIX = 'documents/'

export interface ExportDataResult {
  success: boolean
  filePath?: string
  error?: string
}

export interface ImportDataResult {
  success: boolean
  importedCount?: number
  pdfHashMismatchCount?: number
  error?: string
}

export interface BackupServiceDeps {
  database: Database
  clientRepository: ClientRepository
  migrationService: MigrationService
  /** 復元前の退避コピー元とする、現行DBファイルの実パス */
  dbFilePath: string
  /** 退避コピーの保存先ディレクトリ */
  backupsDir: string
  /** 見積書・請求書PDFの保存先ルート(`<データ保存先>/documents`) */
  documentsDir: string
  /** エクスポートファイルに記録するアプリバージョン */
  appVersion: string
}

type FileFormat = 'zip' | 'json'

interface ParsedBackup {
  format: FileFormat
  json: unknown
  /** ZIP内のPDFエントリ(キー: `documents/...`形式のエントリ名) */
  pdfEntries: Map<string, Buffer>
}

class BackupParseError extends Error {}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

/**
 * エクスポート・復元の一連の処理を統括するApplication Service層。
 * 参照元: 詳細設計書 4.2章(エクスポート)・4.3章(復元)、5章(クラス設計 `BackupService`)
 *
 * エクスポートはZIP形式(`data.json`+`documents/`配下のPDF)。復元はZIP形式・旧JSON形式(PDFを含まない)の
 * 双方に対応し、ZIP形式ではPDFのSHA-256を再照合して不一致の書類に個別の警告フラグ(`pdf_hash_mismatch`)を立てる
 * (復元自体は中断しない。基本設計書8.1章★D5)。
 */
export class BackupService {
  constructor(private readonly deps: BackupServiceDeps) {}

  exportData(filePath: string): ExportDataResult {
    try {
      const sqlite = this.deps.database.sqlite
      const zip = new AdmZip()
      const addedEntries = new Set<string>()

      const toRelativePdfPath = (row: BackupRow): BackupRow => {
        const pdfPath = row.pdfPath
        if (typeof pdfPath !== 'string') {
          return row
        }
        const relative = this.toEntryName(pdfPath)
        if (relative === null) {
          return row
        }
        if (!addedEntries.has(relative) && existsSync(pdfPath)) {
          zip.addFile(relative, readFileSync(pdfPath))
          addedEntries.add(relative)
        }
        return { ...row, pdfPath: relative }
      }

      const payload: BackupFile = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        appVersion: this.deps.appVersion,
        exportedAt: new Date().toISOString(),
        data: {
          clients: this.deps.clientRepository.findAllForBackup(),
          companyProfile: readRows(sqlite, COMPANY_PROFILE_TABLE)[0] ?? null,
          quotes: readRows(sqlite, QUOTES_TABLE).map(toRelativePdfPath),
          quoteLineItems: readRows(sqlite, QUOTE_LINE_ITEMS_TABLE),
          invoices: readRows(sqlite, INVOICES_TABLE).map(toRelativePdfPath),
          invoiceLineItems: readRows(sqlite, INVOICE_LINE_ITEMS_TABLE)
        }
      }
      zip.addFile(DATA_JSON_ENTRY, Buffer.from(JSON.stringify(payload, null, 2), 'utf-8'))
      writeFileSync(filePath, zip.toBuffer())
      return { success: true, filePath }
    } catch {
      return { success: false, error: BACKUP_MESSAGES.exportFailure }
    }
  }

  /** ファイルの先頭バイトがZIPシグネチャ(`PK`)かどうかで形式を判定する(詳細設計書4.3章手順3) */
  detectFormat(buffer: Buffer): FileFormat {
    return buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b ? 'zip' : 'json'
  }

  importData(filePath: string): ImportDataResult {
    let parsed: ParsedBackup
    try {
      parsed = this.parseFile(filePath)
    } catch {
      return { success: false, error: BACKUP_MESSAGES.importParseFailure }
    }

    const validated = BackupFileSchema.safeParse(parsed.json)
    if (!validated.success) {
      return { success: false, error: BACKUP_MESSAGES.importParseFailure }
    }

    if (validated.data.schemaVersion > CURRENT_SCHEMA_VERSION) {
      return { success: false, error: BACKUP_MESSAGES.importVersionTooNew }
    }

    const backupFile = this.deps.migrationService.migrateExportData(
      validated.data,
      validated.data.schemaVersion
    )
    const restorePdfs = parsed.format === 'zip'

    const documentsBackupPath = this.createSafeguardCopy(restorePdfs)

    try {
      const pdfHashMismatchCount = this.deps.database.transaction(() =>
        this.replaceAllData(backupFile, restorePdfs ? parsed.pdfEntries : null)
      )
      const d = backupFile.data
      return {
        success: true,
        importedCount: d.clients.length + d.quotes.length + d.invoices.length,
        ...(restorePdfs ? { pdfHashMismatchCount } : {})
      }
    } catch {
      const restoreResult = this.restoreFromLatestSafeguardCopy(documentsBackupPath)
      if (!restoreResult.success) {
        return { success: false, error: BACKUP_MESSAGES.importSafeguardRestoreFailure }
      }
      return { success: false, error: BACKUP_MESSAGES.importTransactionFailure }
    }
  }

  /** ファイルを読み込み、形式(ZIP/JSON)に応じてdata.jsonとPDFエントリを取り出す */
  private parseFile(filePath: string): ParsedBackup {
    const buffer = readFileSync(filePath)
    if (this.detectFormat(buffer) === 'json') {
      return { format: 'json', json: JSON.parse(buffer.toString('utf-8')), pdfEntries: new Map() }
    }

    const zip = new AdmZip(buffer)
    const dataEntry = zip.getEntry(DATA_JSON_ENTRY)
    if (!dataEntry) {
      throw new BackupParseError('data.json not found')
    }
    const pdfEntries = new Map<string, Buffer>()
    for (const entry of zip.getEntries()) {
      const name = entry.entryName
      if (entry.isDirectory || !name.startsWith(DOCUMENTS_ENTRY_PREFIX)) {
        continue
      }
      // ZIPスリップ対策: 親ディレクトリ参照・絶対パスを含むエントリは無視する
      if (name.split('/').includes('..') || isAbsolute(name)) {
        continue
      }
      pdfEntries.set(name, entry.getData())
    }
    return {
      format: 'zip',
      json: JSON.parse(dataEntry.getData().toString('utf-8')),
      pdfEntries
    }
  }

  /** `<documentsDir>`配下の絶対パスを、ZIP内エントリ名(`documents/...`)へ変換する。配下でなければnull */
  private toEntryName(absolutePath: string): string | null {
    const root = resolve(this.deps.documentsDir) + sep
    const target = resolve(absolutePath)
    if (!target.startsWith(root)) {
      return null
    }
    return `${DOCUMENTS_ENTRY_PREFIX}${target.slice(root.length).split(sep).join('/')}`
  }

  /** エクスポートファイル内の`documents/...`形式のパスを、現在のデータ保存先の絶対パスへ変換する */
  private toAbsolutePdfPath(value: unknown): string | null {
    if (typeof value !== 'string' || value === '') {
      return null
    }
    if (isAbsolute(value)) {
      return value
    }
    const resolved = resolve(dirname(this.deps.documentsDir), value)
    return resolved.startsWith(resolve(this.deps.documentsDir) + sep) ? resolved : null
  }

  /**
   * 全テーブルを削除して復元データで置き換える(トランザクション内で呼び出す。詳細設計書4.3章手順6・7)。
   * PDFを復元する場合は、documentsフォルダを全置換して書き出し、SHA-256を再照合する。
   * @returns ハッシュ不一致の書類件数(PDFを復元しない場合は0)
   */
  private replaceAllData(backup: BackupFile, pdfEntries: Map<string, Buffer> | null): number {
    const sqlite = this.deps.database.sqlite
    const d = backup.data

    for (const table of [
      'invoice_line_items',
      'invoices',
      'quote_line_items',
      'quotes',
      'company_profile',
      'document_number_sequences'
    ]) {
      sqlite.prepare(`DELETE FROM ${table}`).run()
    }
    this.deps.clientRepository.deleteAll()

    for (const record of d.clients) {
      this.deps.clientRepository.insertWithId(record)
    }
    if (d.companyProfile) {
      insertRow(sqlite, COMPANY_PROFILE_TABLE, d.companyProfile)
    }
    // pdf_pathは現在のデータ保存先の絶対パスへ変換し、照合結果(pdf_hash_mismatch)は後段で設定する
    const withPdfPath = (row: BackupRow): Record<string, unknown> => ({
      pdfPath: this.toAbsolutePdfPath(row.pdfPath),
      pdfHashMismatch: false
    })
    for (const row of d.quotes) {
      insertRow(sqlite, QUOTES_TABLE, row, withPdfPath(row))
    }
    for (const row of d.quoteLineItems) {
      insertRow(sqlite, QUOTE_LINE_ITEMS_TABLE, row)
    }
    for (const row of d.invoices) {
      insertRow(sqlite, INVOICES_TABLE, row, withPdfPath(row))
    }
    for (const row of d.invoiceLineItems) {
      insertRow(sqlite, INVOICE_LINE_ITEMS_TABLE, row)
    }
    this.rebuildNumberSequences(d.quotes, d.invoices)

    if (!pdfEntries) {
      return 0
    }
    return this.restorePdfFiles(pdfEntries, d.quotes, d.invoices)
  }

  /** 復元後の見積書・請求書の最大採番値から`document_number_sequences`を再計算する(詳細設計書4.3章手順6) */
  private rebuildNumberSequences(quotes: BackupRow[], invoices: BackupRow[]): void {
    const sqlite = this.deps.database.sqlite
    const collect = (rows: BackupRow[], key: string): Map<number, number> => {
      const maxByYear = new Map<number, number>()
      for (const row of rows) {
        const match = /^(\d{4})-(\d+)$/.exec(String(row[key] ?? ''))
        if (match) {
          const year = Number(match[1])
          maxByYear.set(year, Math.max(maxByYear.get(year) ?? 0, Number(match[2])))
        }
      }
      return maxByYear
    }
    const insert = sqlite.prepare(
      'INSERT INTO document_number_sequences (year, doc_type, last_number) VALUES (?, ?, ?)'
    )
    for (const [year, last] of collect(quotes, 'quoteNumber')) {
      insert.run(year, 'quote', last)
    }
    for (const [year, last] of collect(invoices, 'invoiceNumber')) {
      insert.run(year, 'invoice', last)
    }
  }

  /**
   * documentsフォルダを全置換してPDFを書き出し、SHA-256を再照合する(詳細設計書4.3章手順7・`restorePdfFiles`)。
   * ハッシュが記録値と一致しない(またはPDFが存在しない)書類は、復元を中断せず`pdf_hash_mismatch`を1にする。
   */
  restorePdfFiles(
    entries: Map<string, Buffer>,
    quotes: BackupRow[],
    invoices: BackupRow[]
  ): number {
    const root = resolve(this.deps.documentsDir)
    rmSync(root, { recursive: true, force: true })
    for (const [name, data] of entries) {
      const target = resolve(dirname(root), name)
      if (!target.startsWith(root + sep)) {
        continue
      }
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, data)
    }

    const sqlite = this.deps.database.sqlite
    let mismatchCount = 0
    const verify = (table: 'quotes' | 'invoices', rows: BackupRow[]): void => {
      const update = sqlite.prepare(`UPDATE ${table} SET pdf_hash_mismatch = 1 WHERE id = ?`)
      for (const row of rows) {
        const path = this.toAbsolutePdfPath(row.pdfPath)
        if (!path || typeof row.pdfHash !== 'string' || row.pdfHash === '') {
          continue
        }
        const matches = existsSync(path) && sha256(readFileSync(path)) === row.pdfHash
        if (!matches) {
          update.run(row.id as number)
          mismatchCount += 1
        }
      }
    }
    verify('quotes', quotes)
    verify('invoices', invoices)
    return mismatchCount
  }

  /**
   * 復元実行前に、現行DBファイル(ZIP形式の復元時は`documents/`フォルダも)をタイムスタンプ付きで
   * 退避コピーする(詳細設計書4.3章手順5)。documentsの退避先パス(退避しなかった場合はnull)を返す。
   */
  private createSafeguardCopy(includeDocuments: boolean): string | null {
    mkdirSync(this.deps.backupsDir, { recursive: true })
    // WAL上の未反映データを本体ファイルへ書き戻してからコピーする
    this.deps.database.sqlite.pragma('wal_checkpoint(FULL)')

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const uniqueSuffix = randomBytes(3).toString('hex')
    const backupPath = join(
      this.deps.backupsDir,
      `${BACKUP_FILE_PREFIX}${timestamp}-${uniqueSuffix}${BACKUP_FILE_SUFFIX}`
    )
    copyFileSync(this.deps.dbFilePath, backupPath)
    this.pruneOldBackups()

    if (!includeDocuments) {
      return null
    }
    const documentsBackup = join(
      this.deps.backupsDir,
      `${DOCUMENTS_BACKUP_PREFIX}${timestamp}-${uniqueSuffix}`
    )
    if (existsSync(this.deps.documentsDir)) {
      cpSync(this.deps.documentsDir, documentsBackup, { recursive: true })
    } else {
      mkdirSync(documentsBackup, { recursive: true })
    }
    this.pruneOldDocumentBackups()
    return documentsBackup
  }

  /** 直近3世代のみを保持し、それより古い世代は自動削除する(基本設計書7章) */
  private pruneOldBackups(): void {
    const files = this.listBackupFiles()
    const excess = files.length - MAX_BACKUP_GENERATIONS
    if (excess > 0) {
      for (const file of files.slice(0, excess)) {
        unlinkSync(join(this.deps.backupsDir, file))
      }
    }
  }

  private pruneOldDocumentBackups(): void {
    const dirs = this.listDocumentBackups()
    const excess = dirs.length - MAX_BACKUP_GENERATIONS
    if (excess > 0) {
      for (const dir of dirs.slice(0, excess)) {
        rmSync(join(this.deps.backupsDir, dir), { recursive: true, force: true })
      }
    }
  }

  private listBackupFiles(): string[] {
    if (!existsSync(this.deps.backupsDir)) {
      return []
    }
    return readdirSync(this.deps.backupsDir)
      .filter((name) => name.startsWith(BACKUP_FILE_PREFIX) && name.endsWith(BACKUP_FILE_SUFFIX))
      .sort()
  }

  private listDocumentBackups(): string[] {
    if (!existsSync(this.deps.backupsDir)) {
      return []
    }
    return readdirSync(this.deps.backupsDir)
      .filter((name) => name.startsWith(DOCUMENTS_BACKUP_PREFIX))
      .sort()
  }

  /**
   * 復元処理が失敗した場合、直近の退避コピーからDBファイル(ZIP形式の場合はdocumentsフォルダも)を
   * 復旧する(詳細設計書4.3章手順9)。復旧処理自体が失敗した場合も例外を投げず、
   * `{ success: false }`を返す(コーディング規約11章の方針)。
   */
  private restoreFromLatestSafeguardCopy(documentsBackupPath: string | null): {
    success: boolean
  } {
    try {
      const files = this.listBackupFiles()
      const latest = files.at(-1)
      if (latest) {
        copyFileSync(join(this.deps.backupsDir, latest), this.deps.dbFilePath)
        this.deps.database.reopen()
      }
      if (documentsBackupPath && existsSync(documentsBackupPath)) {
        rmSync(this.deps.documentsDir, { recursive: true, force: true })
        cpSync(documentsBackupPath, this.deps.documentsDir, { recursive: true })
      }
      return { success: true }
    } catch {
      return { success: false }
    }
  }
}
