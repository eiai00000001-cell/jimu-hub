import {
  closeSync,
  copyFileSync,
  openSync,
  readSync,
  renameSync,
  statfsSync,
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
import { randomBytes } from 'node:crypto'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  BackupClientRecordSchema,
  BackupFileSchema,
  CURRENT_SCHEMA_VERSION,
  type BackupFile,
  type BackupRow
} from '@shared/backup/backup-file'
import { BACKUP_MESSAGES } from '@shared/messages/messages'
import type { Database } from '../db/db'
import type { DataProgress } from '@shared/ipc/api'
import type { ClientRepository } from '../repositories/client.repository'
import type { MigrationService } from './migration.service'
import { CASH_RECORD_HISTORY_TRIGGERS_SQL, CASH_RECORD_HISTORY_TRIGGER_NAMES } from '../db/db'
import { CashRecordHistoryRepository } from '../repositories/cash-record-history.repository'
import { CashRecordRepository } from '../repositories/cash-record.repository'
import { ReceiptRepository } from '../repositories/receipt.repository'
import { IntegrityService } from './integrity/integrity.service'
import { resolveReceiptPath } from './receipts/receipt-path'
import { BackupArchiveWriter } from './backup/archive-writer'
import { BackupArchiveReader } from './backup/archive-reader'
import { BackupDiskShortError, BackupParseError, BackupSizeLimitError } from './backup/errors'
import { LegacyJsonRecordSource } from './backup/legacy-record-source'
import {
  JsonlRecordSource,
  LegacyRecordSourceAdapter,
  ManifestSchema,
  type Manifest,
  type RecordSource
} from './backup/record-source'
import { JsonlTableWriter, jsonlEntryName } from './backup/jsonl-table-writer'
import { BackupStagingArea } from './backup/staging-area'
import {
  BACKUP_TABLES,
  RECEIPTS_TABLE,
  INVOICES_TABLE,
  QUOTES_TABLE,
  insertRow,
  type TableDef
} from './backup-tables'

const MAX_BACKUP_GENERATIONS = 3
const BACKUP_FILE_PREFIX = 'data_'
const BACKUP_FILE_SUFFIX = '.sqlite'
const DOCUMENTS_BACKUP_PREFIX = 'documents_'
const DATA_JSON_ENTRY = 'data.json'
const MANIFEST_ENTRY = 'manifest.json'
const MANIFEST_FORMAT = 'jimuhub-backup'
/** 従来形式の`data.json`・旧形式のJSON単体の読み込み上限(256MiB。基本設計書8.1章★31) */
const MAX_LEGACY_JSON_BYTES = 256 * 1024 * 1024
const MAX_MANIFEST_BYTES = 1024 * 1024
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

/** 進捗の通知(`data:progress`としてRendererへ渡す) */
export type BackupProgressCallback = (progress: DataProgress) => void

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
  /** 一時フォルダの親(省略時は`<データ保存先>/tmp`。DBファイルと同じボリュームに置く) */
  tmpDir?: string
  /** エクスポートファイルに記録するアプリバージョン */
  appVersion: string
  /** 展開先の空き容量(バイト)の取得(省略時は`statfsSync`。テストで差し替える) */
  getFreeBytes?: (dir: string) => number
  /** 復元ファイルの読み込み上限(省略時は`DEFAULT_RESTORE_LIMITS`。テストで小さい値を指定する) */
  restoreLimits?: Partial<RestoreLimits>
}

type FileFormat = 'zip' | 'json'

/** 一時フォルダへの展開と確認が済んだ、復元の入力 */
interface PreparedRestore {
  schemaVersion: number
  /** 現行より新しい版の場合はnull(復元しない) */
  source: RecordSource | null
  /** `documents/`の入れ替えと、PDF・領収書の照合を行うか(ZIPの場合) */
  hasDocuments: boolean
  /** エントリ名→SHA-256(展開時に算出) */
  hashes: Map<string, string>
}

interface RestoreSummary {
  importedCount: number
  pdfHashMismatchCount: number
  receiptHashMismatchCount: number
  recordHashMismatchCount: number
}

/** 復元したPDFのハッシュ照合の対象(見積書・請求書) */
export interface PdfCheck {
  table: string
  id: number
  pdfPath: string
  hash: string
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
  private readonly tmpDir: string

  constructor(private readonly deps: BackupServiceDeps) {
    this.limits = { ...DEFAULT_RESTORE_LIMITS, ...deps.restoreLimits }
    this.tmpDir = deps.tmpDir ?? join(dirname(deps.dbFilePath), 'tmp')
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

  /**
   * エクスポート(詳細設計書4.2章手順4〜7)。DBレコードを一時フォルダへJSON Linesで書き出し(同期)、
   * `manifest.json`・`.jsonl`・PDF・領収書を、作業用ファイル(`.partial`)へストリームでZIP化してから、正式な名前へ変更する。
   */
  async exportData(
    filePath: string,
    onProgress?: BackupProgressCallback
  ): Promise<ExportDataResult> {
    const staging = new BackupStagingArea(this.tmpDir)
    const partialPath = `${filePath}.partial`
    let dir: string | null = null
    let writer: BackupArchiveWriter | null = null
    try {
      dir = staging.create('export')
      const files = new Map<string, string>()
      const counts = this.writeRecordFiles(dir, files, onProgress)
      this.writeManifest(dir, counts)

      const total = files.size
      let current = 0
      rmSync(partialPath, { force: true })
      writer = new BackupArchiveWriter(partialPath, (entryName) => {
        if (!entryName.startsWith(DOCUMENTS_ENTRY_PREFIX)) return
        current += 1
        onProgress?.({ phase: 'export', stage: 'files', current, total })
      })
      writer.addFile(join(dir, MANIFEST_ENTRY), MANIFEST_ENTRY)
      for (const entry of BACKUP_TABLES) {
        writer.addFile(join(dir, jsonlEntryName(entry.name)), jsonlEntryName(entry.name))
      }
      for (const [entryName, absolutePath] of files) {
        writer.addFile(absolutePath, entryName)
      }
      // ZIPの仕上げ(書き込みの完了待ち)は時間がかかるため、画面が止まって見えないよう通知する
      onProgress?.({ phase: 'export', stage: 'packing', current: total, total })
      const size = await writer.finalize()
      if (size > this.limits.maxFileBytes) {
        // 復元できない大きさのファイルは残さない(見込みサイズの確認に続く二重の確認。基本設計書8.1章★E19)
        rmSync(partialPath, { force: true })
        return { success: false, error: BACKUP_MESSAGES.exportTooLarge }
      }
      renameSync(partialPath, filePath)
      return { success: true, filePath }
    } catch {
      await writer?.abort()
      rmSync(partialPath, { force: true })
      return { success: false, error: BACKUP_MESSAGES.exportFailure }
    } finally {
      if (dir) staging.remove(dir)
    }
  }

  /**
   * 全テーブルを、同じ時点の内容で`data/<名前>.jsonl`へ書き出す(awaitを挟まない同期処理)。
   * あわせて、ZIPへ追加するPDF・領収書ファイル(エントリ名→絶対パス)を`files`へ集める(パスのみ。中身は読まない)。
   * @returns テーブルごとの書き出し件数
   */
  private writeRecordFiles(
    dir: string,
    files: Map<string, string>,
    onProgress?: BackupProgressCallback
  ): Map<string, number> {
    const writer = new JsonlTableWriter(this.deps.database.sqlite)
    const toRelativePdfPath = (row: BackupRow): BackupRow => {
      const pdfPath = row.pdfPath
      if (typeof pdfPath !== 'string') return row
      const relative = this.toEntryName(pdfPath)
      if (relative === null) return row
      if (existsSync(pdfPath)) files.set(relative, pdfPath)
      return { ...row, pdfPath: relative }
    }
    // 領収書: DBの`file_path`(`receipts/...`)を、`documents/`始まりのパスで書き出す。実ファイルが無い領収書は書き出さない
    const toRelativeReceiptPath = (row: BackupRow): BackupRow => {
      const filePathValue = typeof row.filePath === 'string' ? row.filePath : ''
      const absolute = resolveReceiptPath(this.deps.documentsDir, filePathValue)
      const entryName = `${DOCUMENTS_ENTRY_PREFIX}${filePathValue}`
      if (absolute) files.set(entryName, absolute)
      return { ...row, filePath: filePathValue === '' ? '' : entryName }
    }
    const mappers: Record<string, (row: BackupRow) => BackupRow> = {
      quotes: toRelativePdfPath,
      invoices: toRelativePdfPath,
      receipts: toRelativeReceiptPath
    }

    const counts = new Map<string, number>()
    let done = 0
    for (const entry of BACKUP_TABLES) {
      counts.set(entry.name, writer.writeTable(entry, dir, mappers[entry.name]))
      done += 1
      onProgress?.({
        phase: 'export',
        stage: 'records',
        current: done,
        total: BACKUP_TABLES.length
      })
    }
    return counts
  }

  private writeManifest(dir: string, counts: Map<string, number>): void {
    const tables: Record<string, { file: string; count: number }> = {}
    for (const entry of BACKUP_TABLES) {
      tables[entry.name] = { file: jsonlEntryName(entry.name), count: counts.get(entry.name) ?? 0 }
    }
    const manifest = {
      format: MANIFEST_FORMAT,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      appVersion: this.deps.appVersion,
      exportedAt: new Date().toISOString(),
      tables
    }
    writeFileSync(join(dir, MANIFEST_ENTRY), JSON.stringify(manifest, null, 2), 'utf-8')
  }

  /** ファイルの先頭バイトがZIPシグネチャ(`PK`)かどうかで形式を判定する(詳細設計書4.3章手順3) */
  detectFormat(buffer: Buffer): FileFormat {
    return buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b ? 'zip' : 'json'
  }

  /**
   * 復元(詳細設計書4.3章手順3〜9)。まず一時フォルダへ展開して内容を確認し(現在のデータは変更しない)、
   * その後、同期処理のトランザクションで全置換する。成功・失敗を問わず、一時フォルダは削除する。
   */
  async importData(
    filePath: string,
    onProgress?: BackupProgressCallback
  ): Promise<ImportDataResult> {
    const staging = new BackupStagingArea(this.tmpDir)
    let dir: string | null = null
    try {
      let prepared: PreparedRestore
      try {
        dir = staging.create('restore')
        prepared = await this.prepareRestore(filePath, dir, onProgress)
      } catch (error) {
        return { success: false, error: this.toParseErrorMessage(error) }
      }
      if (prepared.schemaVersion > CURRENT_SCHEMA_VERSION) {
        return { success: false, error: BACKUP_MESSAGES.importVersionTooNew }
      }

      let documentsBackupPath: string | null
      try {
        // 退避コピーの作成失敗(容量・権限不足等)も、データには未着手のため結果として返す
        documentsBackupPath = this.createSafeguardCopy(prepared.hasDocuments)
      } catch {
        return { success: false, error: BACKUP_MESSAGES.importTransactionFailure }
      }

      try {
        const summary = this.deps.database.transaction(() =>
          this.replaceAllData(prepared, dir as string, onProgress)
        )
        return {
          success: true,
          importedCount: summary.importedCount,
          ...(prepared.hasDocuments
            ? {
                pdfHashMismatchCount: summary.pdfHashMismatchCount,
                receiptHashMismatchCount: summary.receiptHashMismatchCount,
                recordHashMismatchCount: summary.recordHashMismatchCount
              }
            : {})
        }
      } catch {
        const restoreResult = this.restoreFromLatestSafeguardCopy(documentsBackupPath)
        if (!restoreResult.success) {
          return { success: false, error: BACKUP_MESSAGES.importSafeguardRestoreFailure }
        }
        return { success: false, error: BACKUP_MESSAGES.importTransactionFailure }
      }
    } finally {
      if (dir) staging.remove(dir)
    }
  }

  private toParseErrorMessage(error: unknown): string {
    if (error instanceof BackupSizeLimitError) return BACKUP_MESSAGES.importTooLarge
    if (error instanceof BackupDiskShortError) return BACKUP_MESSAGES.importDiskShort
    return BACKUP_MESSAGES.importParseFailure
  }

  /**
   * ファイルの確認と、一時フォルダへの展開(現在のデータは変更しない。手順3・4)。
   * ZIPはファイル全体を読み込まず、目録の確認→1件ずつの展開の順に処理する。
   */
  private async prepareRestore(
    filePath: string,
    dir: string,
    onProgress?: BackupProgressCallback
  ): Promise<PreparedRestore> {
    if (statSync(filePath).size > this.limits.maxFileBytes) {
      throw new BackupSizeLimitError('file too large')
    }
    if (this.detectFormat(this.readHeader(filePath)) === 'json') {
      // 旧形式(JSON単体。PDF・領収書を含まない)
      const text = this.readTextWithin(filePath, MAX_LEGACY_JSON_BYTES)
      return this.prepareLegacy(text, false)
    }

    const reader = new BackupArchiveReader(filePath, this.limits)
    try {
      const scan = await reader.scan()
      this.assertFreeSpace(scan.extractBytes)
      const { hashes } = await reader.extractTo(dir, (current, total) =>
        onProgress?.({ phase: 'import', stage: 'extract', current, total })
      )
      if (scan.hasManifest) {
        return this.prepareManifest(dir, hashes)
      }
      const text = this.readTextWithin(join(dir, DATA_JSON_ENTRY), MAX_LEGACY_JSON_BYTES)
      return { ...this.prepareLegacy(text, true), hashes }
    } finally {
      reader.close()
    }
  }

  private prepareManifest(dir: string, hashes: Map<string, string>): PreparedRestore {
    let manifest: Manifest
    try {
      const text = this.readTextWithin(join(dir, MANIFEST_ENTRY), MAX_MANIFEST_BYTES)
      manifest = ManifestSchema.parse(JSON.parse(text))
    } catch (error) {
      if (error instanceof BackupSizeLimitError) throw error
      throw new BackupParseError('invalid manifest')
    }
    return {
      schemaVersion: manifest.schemaVersion,
      source: new JsonlRecordSource(dir),
      hasDocuments: true,
      hashes
    }
  }

  /** 従来形式(`data.json`・JSON単体。スキーマバージョン1〜4)を読み込み、現行の構造へ変換する */
  private prepareLegacy(text: string, hasDocuments: boolean): PreparedRestore {
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      throw new BackupParseError('invalid json')
    }
    const validated = BackupFileSchema.safeParse(json)
    if (!validated.success) throw new BackupParseError('invalid backup file')
    const schemaVersion = validated.data.schemaVersion
    if (schemaVersion > CURRENT_SCHEMA_VERSION) {
      return { schemaVersion, source: null, hasDocuments, hashes: new Map() }
    }
    let migrated: BackupFile
    try {
      migrated = this.deps.migrationService.migrateExportData(validated.data, schemaVersion)
    } catch {
      throw new BackupParseError('migration failed')
    }
    return {
      schemaVersion,
      source: new LegacyRecordSourceAdapter(new LegacyJsonRecordSource(migrated)),
      hasDocuments,
      hashes: new Map()
    }
  }

  private readHeader(filePath: string): Buffer {
    const fd = openSync(filePath, 'r')
    try {
      const header = Buffer.alloc(2)
      const read = readSync(fd, header, 0, 2, 0)
      return header.subarray(0, read)
    } finally {
      closeSync(fd)
    }
  }

  /** 上限以内の大きさのテキストファイルのみを読み込む(超える場合は容量超過のエラー) */
  private readTextWithin(path: string, maxBytes: number): string {
    if (statSync(path).size > maxBytes) throw new BackupSizeLimitError('file too large')
    return readFileSync(path, 'utf-8')
  }

  /** 展開先の空き容量が、展開対象の宣言サイズの合計+10%以上あることを確認する(基本設計書8.1章★31) */
  private assertFreeSpace(extractBytes: number): void {
    mkdirSync(this.tmpDir, { recursive: true })
    const free = this.deps.getFreeBytes
      ? this.deps.getFreeBytes(this.tmpDir)
      : (() => {
          const stats = statfsSync(this.tmpDir)
          return Number(stats.bavail) * Number(stats.bsize)
        })()
    if (free < extractBytes * 1.1) throw new BackupDiskShortError('not enough free space')
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
   * DBレコードは1行ずつ読み込んでINSERTし、全行を配列に保持しない。
   * ZIPの場合は、`documents/`フォルダを全置換して、PDF・領収書のSHA-256を再照合する。
   */
  private replaceAllData(
    prepared: PreparedRestore,
    stagingDir: string,
    onProgress?: BackupProgressCallback
  ): RestoreSummary {
    const sqlite = this.deps.database.sqlite
    const source = prepared.source
    if (!source) throw new BackupParseError('no record source')

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

    const counts: Record<string, number> = {}
    const pdfChecks: PdfCheck[] = []
    const sequences = { quote: new Map<number, number>(), invoice: new Map<number, number>() }
    // pdf_pathは現在のデータ保存先の絶対パスへ変換し、照合結果(pdf_hash_mismatch)は後段で設定する
    const documentInserter =
      (def: TableDef, key: 'quote' | 'invoice') =>
      (row: BackupRow): void => {
        const pdfPath = this.toAbsolutePdfPath(row.pdfPath)
        insertRow(sqlite, def, row, { pdfPath, pdfHashMismatch: false })
        if (pdfPath && typeof row.pdfHash === 'string' && row.pdfHash !== '') {
          pdfChecks.push({ table: def.table, id: Number(row.id), pdfPath, hash: row.pdfHash })
        }
        this.trackSequence(sequences[key], row[key === 'quote' ? 'quoteNumber' : 'invoiceNumber'])
      }
    const inserters: Record<string, (row: BackupRow) => void> = {
      clients: (row) =>
        this.deps.clientRepository.insertWithId(BackupClientRecordSchema.parse(row)),
      quotes: documentInserter(QUOTES_TABLE, 'quote'),
      invoices: documentInserter(INVOICES_TABLE, 'invoice'),
      // 領収書の保存先は、所定の形式に一致するものだけを採用し、一致しないものは空文字とする(照合で欠落扱いになる)
      receipts: (row) =>
        insertRow(sqlite, RECEIPTS_TABLE, row, { filePath: this.toReceiptDbPath(row.filePath) })
    }
    for (const entry of BACKUP_TABLES) {
      const insert =
        inserters[entry.name] ?? ((row: BackupRow) => insertRow(sqlite, entry.def, row))
      counts[entry.name] = source.readSync(entry.name, insert)
    }
    sqlite.exec(CASH_RECORD_HISTORY_TRIGGERS_SQL)
    this.rebuildNumberSequences(sequences)

    const importedCount =
      (counts.clients ?? 0) +
      (counts.quotes ?? 0) +
      (counts.invoices ?? 0) +
      (counts.cashRecords ?? 0)
    if (!prepared.hasDocuments) {
      return {
        importedCount,
        pdfHashMismatchCount: 0,
        receiptHashMismatchCount: 0,
        recordHashMismatchCount: 0
      }
    }
    const pdfHashMismatchCount = this.restorePdfFiles(
      stagingDir,
      pdfChecks,
      prepared.hashes,
      onProgress
    )
    return { importedCount, pdfHashMismatchCount, ...this.verifyRecords() }
  }

  /** 見積書番号・請求書番号(`YYYY-NNN`)から、年ごとの最大採番値を集計する */
  private trackSequence(maxByYear: Map<number, number>, value: unknown): void {
    const match = /^(\d{4})-(\d+)$/.exec(String(value ?? ''))
    if (match) {
      const year = Number(match[1])
      maxByYear.set(year, Math.max(maxByYear.get(year) ?? 0, Number(match[2])))
    }
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
  private rebuildNumberSequences(sequences: {
    quote: Map<number, number>
    invoice: Map<number, number>
  }): void {
    const insert = this.deps.database.sqlite.prepare(
      'INSERT INTO document_number_sequences (year, doc_type, last_number) VALUES (?, ?, ?)'
    )
    for (const [year, last] of sequences.quote) insert.run(year, 'quote', last)
    for (const [year, last] of sequences.invoice) insert.run(year, 'invoice', last)
  }

  /**
   * 現在の`documents/`を削除し、一時フォルダへ展開済みの`documents/`を`rename`で移動して(コピー・メモリ使用なし)、
   * PDFのSHA-256(展開時に算出済み)を再照合する(詳細設計書4.3章手順7・`restorePdfFiles`)。
   * ハッシュが記録値と一致しない(またはPDFが存在しない)書類は、復元を中断せず`pdf_hash_mismatch`を1にする。
   * @returns ハッシュ不一致の件数
   */
  restorePdfFiles(
    stagingDir: string,
    checks: PdfCheck[],
    hashes: Map<string, string>,
    onProgress?: BackupProgressCallback
  ): number {
    const root = resolve(this.deps.documentsDir)
    rmSync(root, { recursive: true, force: true })
    const staged = join(stagingDir, 'documents')
    mkdirSync(dirname(root), { recursive: true })
    if (existsSync(staged)) {
      try {
        renameSync(staged, root)
      } catch {
        // 別のボリュームの場合は、コピーしてから削除する
        cpSync(staged, root, { recursive: true })
        rmSync(staged, { recursive: true, force: true })
      }
    } else {
      mkdirSync(root, { recursive: true })
    }

    const sqlite = this.deps.database.sqlite
    let mismatchCount = 0
    let checked = 0
    for (const check of checks) {
      const entryName = relative(dirname(root), check.pdfPath).split(sep).join('/')
      if (hashes.get(entryName) !== check.hash) {
        sqlite.prepare(`UPDATE ${check.table} SET pdf_hash_mismatch = 1 WHERE id = ?`).run(check.id)
        mismatchCount += 1
      }
      checked += 1
      onProgress?.({ phase: 'import', stage: 'verify', current: checked, total: checks.length })
    }
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
