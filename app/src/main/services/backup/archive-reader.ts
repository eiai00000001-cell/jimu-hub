import { createWriteStream, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, extname, resolve, sep } from 'node:path'
import { Transform, type TransformCallback } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'
import { BackupParseError, BackupSizeLimitError } from './errors'

export const MANIFEST_ENTRY = 'manifest.json'
export const LEGACY_DATA_ENTRY = 'data.json'

/** 領収書ファイルのエントリ名の形式(SEC-10。大文字・小文字を区別しない) */
const RECEIPT_ENTRY_PATTERN =
  /^documents\/receipts\/\d{4}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|jpeg|png)$/i
const JSONL_ENTRY_PATTERN = /^data\/[A-Za-z][A-Za-z0-9]*\.jsonl$/

/** ZIP内のエントリ名が、展開の対象(許可リスト)かどうか。許可リストに無いエントリは展開しない(詳細設計書4.3章手順3)。 */
export function isAllowedEntryName(name: string): boolean {
  if (name.split('/').includes('..') || name.startsWith('/')) return false
  if (name === MANIFEST_ENTRY || name === LEGACY_DATA_ENTRY) return true
  if (JSONL_ENTRY_PATTERN.test(name)) return true
  if (name.startsWith('documents/receipts/')) return RECEIPT_ENTRY_PATTERN.test(name)
  return name.startsWith('documents/') && extname(name).toLowerCase() === '.pdf'
}

export interface ArchiveLimits {
  maxEntries: number
  /** 全エントリの展開後サイズ(宣言値)の合計の上限(バイト) */
  maxTotalUncompressedBytes: number
}

export interface ScanResult {
  /** 展開の対象となるエントリ名と宣言サイズ */
  entries: Array<{ name: string; size: number }>
  /** 展開の対象の宣言サイズの合計(空き容量の確認に使う) */
  extractBytes: number
  hasManifest: boolean
  hasLegacyData: boolean
}

export interface ExtractResult {
  /** エントリ名→SHA-256(PDF・領収書の照合用。展開しながら計算する) */
  hashes: Map<string, string>
}

/**
 * 実際に流れたバイト数を数え、宣言値・全体の上限を超えた時点で中止し、SHA-256をその場で計算する。
 * 宣言値を偽装したZIP(解凍爆弾)から守る(詳細設計書4.3章手順3(2)。SEC-09)。
 */
export class LimitedCountingTransform extends Transform {
  private bytes = 0
  private readonly hash = createHash('sha256')
  digest = ''

  constructor(
    private readonly declaredSize: number,
    private readonly total: { bytes: number },
    private readonly maxTotalBytes: number
  ) {
    super()
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.bytes += chunk.length
    this.total.bytes += chunk.length
    if (this.bytes > this.declaredSize || this.total.bytes > this.maxTotalBytes) {
      callback(new BackupSizeLimitError('uncompressed size exceeded'))
      return
    }
    this.hash.update(chunk)
    callback(null, chunk)
  }

  override _flush(callback: TransformCallback): void {
    this.digest = this.hash.digest('hex')
    callback()
  }
}

/**
 * `yauzl`のラッパー。ZIPの目録の確認(展開しない)と、エントリ1件ずつのストリーム展開を行う。
 * 参照元: 詳細設計書4.3章手順3、5章(`BackupArchiveReader`)
 */
export class BackupArchiveReader {
  private zipfile: yauzl.ZipFile | null = null
  private accepted: yauzl.Entry[] = []

  constructor(
    private readonly zipPath: string,
    private readonly limits: ArchiveLimits
  ) {}

  /**
   * 目録(中央ディレクトリ)だけを読み、エントリ数・宣言サイズの合計・エントリ名を確認する。
   * 親ディレクトリ参照・絶対パス・暗号化・未対応の圧縮方式は解析エラーとして中断する。
   */
  async scan(): Promise<ScanResult> {
    const zipfile = await this.open()
    this.zipfile = zipfile
    const result: ScanResult = {
      entries: [],
      extractBytes: 0,
      hasManifest: false,
      hasLegacyData: false
    }
    let count = 0
    let declaredTotal = 0

    const inspect = (entry: yauzl.Entry): void => {
      count += 1
      if (count > this.limits.maxEntries) throw new BackupParseError('too many entries')
      declaredTotal += entry.uncompressedSize
      if (declaredTotal > this.limits.maxTotalUncompressedBytes) {
        throw new BackupSizeLimitError('uncompressed size too large')
      }
      if (entry.fileName.endsWith('/')) return
      if (entry.isEncrypted()) throw new BackupParseError('encrypted entry')
      if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
        throw new BackupParseError('unsupported compression method')
      }
      if (!isAllowedEntryName(entry.fileName)) return
      this.accepted.push(entry)
      result.entries.push({ name: entry.fileName, size: entry.uncompressedSize })
      result.extractBytes += entry.uncompressedSize
      if (entry.fileName === MANIFEST_ENTRY) result.hasManifest = true
      if (entry.fileName === LEGACY_DATA_ENTRY) result.hasLegacyData = true
    }

    try {
      await new Promise<void>((resolvePromise, reject) => {
        zipfile.on('error', (error) => reject(toBackupError(error)))
        zipfile.on('end', () => resolvePromise())
        zipfile.on('entry', (entry: yauzl.Entry) => {
          try {
            inspect(entry)
            zipfile.readEntry()
          } catch (error) {
            reject(error)
          }
        })
        zipfile.readEntry()
      })
    } catch (error) {
      this.close()
      throw error
    }
    if (!result.hasManifest && !result.hasLegacyData) {
      this.close()
      throw new BackupParseError('manifest.json or data.json not found')
    }
    return result
  }

  /** 目録の確認(`scan`)で許可したエントリを、一時フォルダへ1件ずつストリームで書き出す */
  async extractTo(
    stagingDir: string,
    onEntry?: (current: number, total: number) => void
  ): Promise<ExtractResult> {
    const zipfile = this.zipfile
    if (!zipfile) throw new Error('scan() must be called before extractTo()')
    const root = resolve(stagingDir)
    const hashes = new Map<string, string>()
    const total = { bytes: 0 }
    let done = 0
    for (const entry of this.accepted) {
      const target = resolve(root, entry.fileName)
      if (!target.startsWith(root + sep)) throw new BackupParseError('invalid entry path')
      mkdirSync(dirname(target), { recursive: true })
      const counter = new LimitedCountingTransform(
        entry.uncompressedSize,
        total,
        this.limits.maxTotalUncompressedBytes
      )
      try {
        const input = await new Promise<NodeJS.ReadableStream>((resolvePromise, reject) => {
          zipfile.openReadStream(entry, (error, stream) =>
            error || !stream ? reject(error ?? new Error('no stream')) : resolvePromise(stream)
          )
        })
        await pipeline(input, counter, createWriteStream(target, { mode: 0o600 }))
      } catch (error) {
        throw toBackupError(error)
      }
      hashes.set(entry.fileName, counter.digest)
      done += 1
      onEntry?.(done, this.accepted.length)
    }
    return { hashes }
  }

  close(): void {
    this.zipfile?.close()
    this.zipfile = null
  }

  private open(): Promise<yauzl.ZipFile> {
    return new Promise((resolvePromise, reject) => {
      yauzl.open(
        this.zipPath,
        { lazyEntries: true, validateEntrySizes: true, autoClose: false },
        (error, zipfile) =>
          error || !zipfile ? reject(toBackupError(error)) : resolvePromise(zipfile)
      )
    })
  }
}

/** `yauzl`・ストリームの例外を、業務上のエラーへ変換する(容量超過とそれ以外の解析エラーを区別する) */
function toBackupError(error: unknown): Error {
  if (error instanceof BackupParseError) return error
  const message = error instanceof Error ? error.message : String(error)
  if (/too many bytes/i.test(message)) return new BackupSizeLimitError(message)
  return new BackupParseError(message)
}
