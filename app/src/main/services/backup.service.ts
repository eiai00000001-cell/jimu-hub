import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { dirname, extname, isAbsolute, join, resolve, sep } from 'node:path'
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
import { CASH_RECORD_HISTORY_TRIGGERS_SQL, CASH_RECORD_HISTORY_TRIGGER_NAMES } from '../db/db'
import { CashRecordHistoryRepository } from '../repositories/cash-record-history.repository'
import { CashRecordRepository } from '../repositories/cash-record.repository'
import { ReceiptRepository } from '../repositories/receipt.repository'
import { IntegrityService } from './integrity/integrity.service'
import { resolveReceiptPath } from './receipts/receipt-path'
import {
  ACCOUNTS_TABLE,
  CASH_RECORD_HISTORY_TABLE,
  CASH_RECORDS_TABLE,
  RECEIPTS_TABLE,
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
const PDF_EXTENSION = '.pdf'

/**
 * 復元ファイルの読み込み上限(セキュリティチェック SEC-09。解凍爆弾・巨大ファイルによるメモリ枯渇の防止)。
 * 個人事業主の利用規模(書類数千件・各PDF数百KB程度)に対し、十分な余裕を持たせた値とする。
 */
export interface RestoreLimits {
  /** 復元ファイル(ZIP/JSON)自体のサイズ上限(バイト) */
  maxFileBytes: number
  /** ZIP内のエントリ数の上限 */
  maxEntries: number
  /** ZIP内の全エントリの展開後サイズ(宣言値)の合計上限(バイト) */
  maxTotalUncompressedBytes: number
}

export const DEFAULT_RESTORE_LIMITS: RestoreLimits = {
  maxFileBytes: 1024 * 1024 * 1024,
  maxEntries: 100_000,
  maxTotalUncompressedBytes: 2 * 1024 * 1024 * 1024
}

/** 見積書・請求書のPDFとして扱うのは拡張子`.pdf`のファイルのみ(SEC-10。PDF以外を「PDFを開く」でOSに渡さない) */
export function hasPdfExtension(path: string): boolean {
  return extname(path).toLowerCase() === PDF_EXTENSION
}

/** 進捗の通知(ファイル1件ごと。`data:progress`としてRendererへ渡す) */
export type BackupProgressCallback = (progress: {
  phase: 'export' | 'import'
  current: number
  total: number
  /** ZIPの生成・書き込み中(ファイルの書き出しが完了した後) */
  stage?: 'packing'
}) => void

export interface ExportDataResult {
  success: boolean
  filePath?: string
  error?: string
  /** 見込みサイズが復元上限の80%を超える場合の警告(基本設計書8.1章★E12。利用者が続行を選んだ場合のみ書き出す) */
  warnLargeBackup?: boolean
}

export interface ImportDataResult {
  success: boolean
  importedCount?: number
  pdfHashMismatchCount?: number
  /** 領収書のハッシュ不一致・欠落の件数(新形式のみ) */
  receiptHashMismatchCount?: number
  /** 記録ハッシュ・履歴ハッシュの不一致の件数(新形式のみ) */
  recordHashMismatchCount?: number
  error?: string
}

/** 見込みサイズが復元上限(ファイルサイズ)のこの割合を超える場合に、エクスポート前に警告する */
const LARGE_BACKUP_RATIO = 0.8

/** 領収書の保存先(`documents/`からの相対パス)の形式。これに一致しないパスは採用しない(SEC-10) */
const RECEIPT_PATH_PATTERN =
  /^receipts\/\d{4}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|jpeg|png)$/i

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
  /** 復元ファイルの読み込み上限(省略時は`DEFAULT_RESTORE_LIMITS`。テストで小さい値を指定する) */
  restoreLimits?: Partial<RestoreLimits>
}

type FileFormat = 'zip' | 'json'

interface ParsedBackup {
  format: FileFormat
  json: unknown
  /** ZIP内のPDF・領収書エントリ(キー: `documents/...`形式のエントリ名) */
  pdfEntries: Map<string, Buffer>
}

class BackupParseError extends Error {}

/** 容量上限の超過(復元ファイルの大きさ・展開後の合計サイズ) */
class BackupSizeLimitError extends BackupParseError {}

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
  private readonly limits: RestoreLimits

  constructor(private readonly deps: BackupServiceDeps) {
    this.limits = { ...DEFAULT_RESTORE_LIMITS, ...deps.restoreLimits }
  }

  /**
   * エクスポートの見込みサイズ(領収書の合計サイズ+PDFの合計サイズ)が、復元上限の80%を超えるか。
   * 超える場合は、書き出しの前に利用者へ確認する(基本設計書8.1章★E12。詳細設計書4.2章手順5)。
   */
  isLargeBackup(): boolean {
    return this.estimateExportBytes() > this.limits.maxFileBytes * LARGE_BACKUP_RATIO
  }

  /** 見込みサイズが復元上限を超え、書き出しても復元できないか(超える場合は書き出しを中止する) */
  isTooLargeBackup(): boolean {
    return this.estimateExportBytes() > this.limits.maxFileBytes
  }

  private estimateExportBytes(): number {
    const sqlite = this.deps.database.sqlite
    const receipts = sqlite
      .prepare('SELECT COALESCE(SUM(file_size), 0) AS s FROM receipts')
      .get() as {
      s: number
    }
    let pdfBytes = 0
    for (const table of ['quotes', 'invoices']) {
      const rows = sqlite
        .prepare(`SELECT pdf_path FROM ${table} WHERE pdf_path IS NOT NULL`)
        .all() as Array<{ pdf_path: string }>
      for (const row of rows) {
        if (existsSync(row.pdf_path)) pdfBytes += statSync(row.pdf_path).size
      }
    }
    return receipts.s + pdfBytes
  }

  exportData(filePath: string, onProgress?: BackupProgressCallback): ExportDataResult {
    try {
      const sqlite = this.deps.database.sqlite
      const zip = new AdmZip()
      const addedEntries = new Set<string>()
      // 進捗: 書き出す対象のファイル件数(PDF保存済みの書類+領収書の行)を総数とする
      const total = this.countExportFiles()
      let current = 0
      const progress = (): void => {
        current += 1
        onProgress?.({ phase: 'export', current, total })
      }

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
        progress()
        return { ...row, pdfPath: relative }
      }

      // 領収書: DBの`file_path`(`receipts/...`)を、`documents/`始まりのパスで書き出す。実ファイルが無い領収書は書き出さない
      const toRelativeReceiptPath = (row: BackupRow): BackupRow => {
        const filePathValue = typeof row.filePath === 'string' ? row.filePath : ''
        const absolute = resolveReceiptPath(this.deps.documentsDir, filePathValue)
        const entryName = `${DOCUMENTS_ENTRY_PREFIX}${filePathValue}`
        if (absolute && !addedEntries.has(entryName)) {
          zip.addFile(entryName, readFileSync(absolute))
          addedEntries.add(entryName)
        }
        progress()
        return { ...row, filePath: filePathValue === '' ? '' : entryName }
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
          invoiceLineItems: readRows(sqlite, INVOICE_LINE_ITEMS_TABLE),
          accounts: readRows(sqlite, ACCOUNTS_TABLE),
          cashRecords: readRows(sqlite, CASH_RECORDS_TABLE),
          receipts: readRows(sqlite, RECEIPTS_TABLE).map(toRelativeReceiptPath),
          cashRecordHistory: readRows(sqlite, CASH_RECORD_HISTORY_TABLE)
        }
      }
      zip.addFile(DATA_JSON_ENTRY, Buffer.from(JSON.stringify(payload, null, 2), 'utf-8'))
      // ZIPの生成・書き込みは時間がかかるため、画面が止まって見えないよう開始前に通知する
      onProgress?.({ phase: 'export', current: total, total, stage: 'packing' })
      writeFileSync(filePath, zip.toBuffer())
      return { success: true, filePath }
    } catch {
      return { success: false, error: BACKUP_MESSAGES.exportFailure }
    }
  }

  /** 書き出し対象のファイル件数(PDF保存済みの書類+領収書の行) */
  private countExportFiles(): number {
    const sqlite = this.deps.database.sqlite
    const count = (sql: string): number => (sqlite.prepare(sql).get() as { c: number }).c
    return (
      count('SELECT COUNT(*) AS c FROM quotes WHERE pdf_path IS NOT NULL') +
      count('SELECT COUNT(*) AS c FROM invoices WHERE pdf_path IS NOT NULL') +
      count('SELECT COUNT(*) AS c FROM receipts')
    )
  }

  /** ファイルの先頭バイトがZIPシグネチャ(`PK`)かどうかで形式を判定する(詳細設計書4.3章手順3) */
  detectFormat(buffer: Buffer): FileFormat {
    return buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b ? 'zip' : 'json'
  }

  importData(filePath: string, onProgress?: BackupProgressCallback): ImportDataResult {
    let parsed: ParsedBackup
    try {
      parsed = this.parseFile(filePath)
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof BackupSizeLimitError
            ? BACKUP_MESSAGES.importTooLarge
            : BACKUP_MESSAGES.importParseFailure
      }
    }

    const validated = BackupFileSchema.safeParse(parsed.json)
    if (!validated.success) {
      return { success: false, error: BACKUP_MESSAGES.importParseFailure }
    }

    if (validated.data.schemaVersion > CURRENT_SCHEMA_VERSION) {
      return { success: false, error: BACKUP_MESSAGES.importVersionTooNew }
    }

    const restorePdfs = parsed.format === 'zip'
    let backupFile: BackupFile
    let documentsBackupPath: string | null
    try {
      backupFile = this.deps.migrationService.migrateExportData(
        validated.data,
        validated.data.schemaVersion
      )
      // 退避コピーの作成失敗(容量・権限不足等)も、データには未着手のため結果として返す
      documentsBackupPath = this.createSafeguardCopy(restorePdfs)
    } catch {
      return { success: false, error: BACKUP_MESSAGES.importTransactionFailure }
    }

    try {
      const counts = this.deps.database.transaction(() =>
        this.replaceAllData(backupFile, restorePdfs ? parsed.pdfEntries : null, onProgress)
      )
      const d = backupFile.data
      return {
        success: true,
        importedCount:
          d.clients.length + d.quotes.length + d.invoices.length + d.cashRecords.length,
        ...(restorePdfs ? counts : {})
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
    if (statSync(filePath).size > this.limits.maxFileBytes) {
      throw new BackupSizeLimitError('file too large')
    }
    const buffer = readFileSync(filePath)
    if (this.detectFormat(buffer) === 'json') {
      return { format: 'json', json: JSON.parse(buffer.toString('utf-8')), pdfEntries: new Map() }
    }

    const zip = new AdmZip(buffer)
    const dataEntry = zip.getEntry(DATA_JSON_ENTRY)
    if (!dataEntry) {
      throw new BackupParseError('data.json not found')
    }
    const entries = zip.getEntries()
    // 解凍爆弾対策(SEC-09): 展開前にエントリ数と展開後サイズの宣言値の合計を確認する。
    // adm-zip 0.6.1は宣言値を超える展開を打ち切るため、宣言値の合計が実際の展開量の上限になる
    if (entries.length > this.limits.maxEntries) {
      throw new BackupParseError('too many entries')
    }
    const declaredTotal = entries.reduce((sum, entry) => sum + entry.header.size, 0)
    if (declaredTotal > this.limits.maxTotalUncompressedBytes) {
      throw new BackupSizeLimitError('uncompressed size too large')
    }
    const pdfEntries = new Map<string, Buffer>()
    for (const entry of entries) {
      const name = entry.entryName
      if (entry.isDirectory || !name.startsWith(DOCUMENTS_ENTRY_PREFIX)) {
        continue
      }
      // ZIPスリップ対策: 親ディレクトリ参照・絶対パスを含むエントリは無視する
      if (name.split('/').includes('..') || isAbsolute(name)) {
        continue
      }
      // 領収書(`documents/receipts/`配下)は、エントリ名が所定の形式に一致するものだけを採用する(SEC-10)
      if (name.startsWith(`${DOCUMENTS_ENTRY_PREFIX}receipts/`)) {
        if (!RECEIPT_PATH_PATTERN.test(name.slice(DOCUMENTS_ENTRY_PREFIX.length))) {
          continue
        }
      } else if (!hasPdfExtension(name)) {
        // PDF以外のファイル(実行可能な種類のファイル等)は書き出さない(SEC-10)
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
    // エクスポートは常に`documents/...`の相対パスで書き出すため、絶対パスは受け付けない
    if (isAbsolute(value)) {
      return null
    }
    // PDF以外のファイルを書類のPDFとして採用しない(SEC-10)
    if (!hasPdfExtension(value)) {
      return null
    }
    const resolved = resolve(dirname(this.deps.documentsDir), value)
    return resolved.startsWith(resolve(this.deps.documentsDir) + sep) ? resolved : null
  }

  /**
   * 全テーブルを削除して復元データで置き換える(トランザクション内で呼び出す。詳細設計書4.3章手順6・7)。
   * PDFを復元する場合は、documentsフォルダを全置換して書き出し、SHA-256を再照合する。
   * @returns ハッシュ不一致の件数(PDFを復元しない場合は0)
   */
  private replaceAllData(
    backup: BackupFile,
    pdfEntries: Map<string, Buffer> | null,
    onProgress?: BackupProgressCallback
  ): {
    pdfHashMismatchCount: number
    receiptHashMismatchCount: number
    recordHashMismatchCount: number
  } {
    const sqlite = this.deps.database.sqlite
    const d = backup.data

    // 履歴テーブルの更新・削除を拒否するトリガーは、全件削除・再投入のため一時的に削除し、コミット前に再作成する
    // (SQLiteのDDLはトランザクション内で巻き戻せるため、失敗時はトリガーも元に戻る)
    for (const name of CASH_RECORD_HISTORY_TRIGGER_NAMES) {
      sqlite.exec(`DROP TRIGGER IF EXISTS ${name}`)
    }
    for (const table of [
      'cash_record_history',
      'receipts',
      'cash_records',
      'accounts',
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
    for (const row of d.accounts) {
      insertRow(sqlite, ACCOUNTS_TABLE, row)
    }
    for (const row of d.cashRecords) {
      insertRow(sqlite, CASH_RECORDS_TABLE, row)
    }
    // 領収書の保存先は、所定の形式に一致するものだけを採用し、一致しないものは空文字とする(照合で欠落扱いになる)
    for (const row of d.receipts) {
      insertRow(sqlite, RECEIPTS_TABLE, row, { filePath: this.toReceiptDbPath(row.filePath) })
    }
    for (const row of d.cashRecordHistory) {
      insertRow(sqlite, CASH_RECORD_HISTORY_TABLE, row)
    }
    sqlite.exec(CASH_RECORD_HISTORY_TRIGGERS_SQL)
    this.rebuildNumberSequences(d.quotes, d.invoices)

    if (!pdfEntries) {
      return { pdfHashMismatchCount: 0, receiptHashMismatchCount: 0, recordHashMismatchCount: 0 }
    }
    const pdfHashMismatchCount = this.restorePdfFiles(pdfEntries, d.quotes, d.invoices, onProgress)
    return { pdfHashMismatchCount, ...this.verifyRecords() }
  }

  /** エクスポートファイルの領収書パス(`documents/receipts/...`)を、DBの`file_path`(`receipts/...`)へ変換する */
  private toReceiptDbPath(value: unknown): string {
    if (typeof value !== 'string') return ''
    const relative = value.startsWith(DOCUMENTS_ENTRY_PREFIX)
      ? value.slice(DOCUMENTS_ENTRY_PREFIX.length)
      : value
    return RECEIPT_PATH_PATTERN.test(relative) ? relative : ''
  }

  /** 復元後の記録ハッシュ・領収書ファイルの照合(`IntegrityService.verifyAllAfterRestore`)。復元は中断しない */
  private verifyRecords(): { receiptHashMismatchCount: number; recordHashMismatchCount: number } {
    const database = this.deps.database
    return new IntegrityService(
      new CashRecordRepository(database),
      new ReceiptRepository(database),
      new CashRecordHistoryRepository(database),
      this.deps.documentsDir
    ).verifyAllAfterRestore()
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
    invoices: BackupRow[],
    onProgress?: BackupProgressCallback
  ): number {
    const root = resolve(this.deps.documentsDir)
    rmSync(root, { recursive: true, force: true })
    let written = 0
    for (const [name, data] of entries) {
      const target = resolve(dirname(root), name)
      if (!target.startsWith(root + sep)) {
        continue
      }
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, data)
      written += 1
      onProgress?.({ phase: 'import', current: written, total: entries.size })
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
