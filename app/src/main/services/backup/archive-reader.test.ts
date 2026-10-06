import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BackupArchiveReader, LimitedCountingTransform, isAllowedEntryName } from './archive-reader'
import { BackupParseError, BackupSizeLimitError } from './errors'
import {
  buildZip,
  overwriteDeclaredSizes,
  patchCentralHeaders,
  renameEntryInZip
} from './test-helpers'

const LIMITS = { maxEntries: 100, maxTotalUncompressedBytes: 1024 * 1024 }
const RECEIPT = 'documents/receipts/2026/123e4567-e89b-12d3-a456-426614174000.pdf'

describe('isAllowedEntryName(許可リスト。SEC-10)', () => {
  it.each([
    'manifest.json',
    'data.json',
    'data/clients.jsonl',
    'data/cashRecordHistory.jsonl',
    'documents/quotes/2026/2026-001_x.pdf',
    'documents/quotes/2026/2026-001_x.PDF',
    RECEIPT,
    'documents/receipts/2026/123E4567-E89B-12D3-A456-426614174000.JPG'
  ])('許可する: %s', (name) => expect(isAllowedEntryName(name)).toBe(true))

  it.each([
    'evil.sh',
    'data/clients.json',
    'data/sub/x.jsonl',
    'documents/run.sh',
    'documents/quotes/a.txt',
    'documents/receipts/2026/not-a-uuid.pdf',
    'documents/receipts/2026/123e4567-e89b-12d3-a456-426614174000.exe',
    'documents/../outside.pdf',
    '/documents/a.pdf'
  ])('許可しない: %s', (name) => expect(isAllowedEntryName(name)).toBe(false))
})

describe('BackupArchiveReader(F-32。詳細設計書4.3章手順3)', () => {
  let dir: string
  let zipPath: string
  let staging: string
  const readers: BackupArchiveReader[] = []

  function reader(limits = LIMITS): BackupArchiveReader {
    const r = new BackupArchiveReader(zipPath, limits)
    readers.push(r)
    return r
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'archive-reader-test-'))
    zipPath = join(dir, 'in.zip')
    staging = join(dir, 'staging')
  })
  afterEach(() => {
    for (const r of readers.splice(0)) r.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('目録を確認し、許可リストに一致するエントリのみを展開の対象にする', async () => {
    buildZip(zipPath, {
      'manifest.json': '{}',
      'data/clients.jsonl': '{"id":1}\n',
      'documents/q/a.pdf': 'pdf',
      [RECEIPT]: 'img',
      'documents/run.sh': 'echo',
      'notes.txt': 'x'
    })
    const scan = await reader().scan()
    expect(scan.entries.map((e) => e.name).sort()).toEqual(
      ['manifest.json', 'data/clients.jsonl', 'documents/q/a.pdf', RECEIPT].sort()
    )
    expect(scan.hasManifest).toBe(true)
    expect(scan.hasLegacyData).toBe(false)
    expect(scan.extractBytes).toBe(2 + 9 + 3 + 3)
  })

  it('従来形式(data.json)も目録の確認を通る', async () => {
    buildZip(zipPath, { 'data.json': '{}' })
    const scan = await reader().scan()
    expect(scan.hasLegacyData).toBe(true)
    expect(scan.hasManifest).toBe(false)
  })

  it('manifest.jsonもdata.jsonも無いZIPは解析エラー', async () => {
    buildZip(zipPath, { 'documents/a.pdf': 'x' })
    await expect(reader().scan()).rejects.toBeInstanceOf(BackupParseError)
  })

  it('ZIPでないファイルは解析エラー', async () => {
    writeFileSync(zipPath, 'not a zip')
    await expect(reader().scan()).rejects.toBeInstanceOf(BackupParseError)
  })

  it('エントリ数の超過は解析エラー(容量超過とは区別する)', async () => {
    buildZip(zipPath, { 'manifest.json': '{}', 'documents/a.pdf': 'x', 'documents/b.pdf': 'y' })
    const error = await reader({ ...LIMITS, maxEntries: 2 })
      .scan()
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(BackupParseError)
    expect(error).not.toBeInstanceOf(BackupSizeLimitError)
  })

  it('展開後サイズ(宣言値)の合計の超過は容量超過のエラー', async () => {
    buildZip(zipPath, { 'manifest.json': '{}', 'documents/a.pdf': 'x'.repeat(100) })
    await expect(
      reader({ ...LIMITS, maxTotalUncompressedBytes: 50 }).scan()
    ).rejects.toBeInstanceOf(BackupSizeLimitError)
  })

  it.each(['documents/../../evil.pdf', 'documents/../evil.pdf', '/abs/documents/evil.pdf'])(
    '親ディレクトリ参照・絶対パスのエントリ(%s)は、細工されたファイルとして中断する',
    async (name) => {
      // adm-zipは危険な名前を拒否するため、同じ長さの名前で作ってから書き換える
      const placeholder = 'x'.repeat(name.length)
      buildZip(zipPath, { 'manifest.json': '{}', [placeholder]: 'x' })
      renameEntryInZip(zipPath, placeholder, name)
      await expect(reader().scan()).rejects.toBeInstanceOf(BackupParseError)
    }
  )

  it('暗号化されたエントリは解析エラー', async () => {
    buildZip(zipPath, { 'manifest.json': '{}' })
    patchCentralHeaders(zipPath, (bytes, at) =>
      bytes.writeUInt16LE(bytes.readUInt16LE(at + 8) | 1, at + 8)
    )
    await expect(reader().scan()).rejects.toBeInstanceOf(BackupParseError)
  })

  it('未対応の圧縮方式は解析エラー', async () => {
    buildZip(zipPath, { 'manifest.json': '{}' })
    patchCentralHeaders(zipPath, (bytes, at) => bytes.writeUInt16LE(99, at + 10))
    await expect(reader().scan()).rejects.toBeInstanceOf(BackupParseError)
  })

  it('許可したエントリを一時フォルダへ1件ずつ展開し、SHA-256と進捗を返す', async () => {
    buildZip(zipPath, {
      'manifest.json': '{"a":1}',
      'documents/q/a.pdf': Buffer.from('%PDF-a'),
      'documents/run.sh': 'echo'
    })
    const r = reader()
    await r.scan()
    const progress: Array<[number, number]> = []
    const { hashes } = await r.extractTo(staging, (c, t) => progress.push([c, t]))

    expect(readFileSync(join(staging, 'documents/q/a.pdf'), 'utf-8')).toBe('%PDF-a')
    expect(readFileSync(join(staging, 'manifest.json'), 'utf-8')).toBe('{"a":1}')
    expect(existsSync(join(staging, 'documents/run.sh'))).toBe(false)
    expect(hashes.get('documents/q/a.pdf')).toBe(
      createHash('sha256').update('%PDF-a').digest('hex')
    )
    expect(progress).toEqual([
      [1, 2],
      [2, 2]
    ])
  })

  it('宣言サイズを偽装したZIP(実際は宣言より大きい)は、展開中に容量超過のエラーで止める', async () => {
    buildZip(zipPath, { 'manifest.json': '{}', 'documents/a.pdf': 'x'.repeat(5000) })
    overwriteDeclaredSizes(zipPath, 10, 1000)
    const r = reader()
    await r.scan()
    await expect(r.extractTo(staging)).rejects.toBeInstanceOf(BackupSizeLimitError)
  })

  it('scanの前にextractToを呼ぶとエラー', async () => {
    await expect(reader().extractTo(staging)).rejects.toThrow()
  })
})

describe('LimitedCountingTransform', () => {
  function run(
    declared: number,
    total: { bytes: number },
    max: number,
    ...chunks: string[]
  ): Promise<void> {
    const t = new LimitedCountingTransform(declared, total, max)
    return new Promise((resolve, reject) => {
      t.on('error', reject)
      t.on('finish', resolve)
      t.resume()
      for (const c of chunks) t.write(Buffer.from(c))
      t.end()
    })
  }

  it('宣言値以内ならハッシュを計算して通す', async () => {
    const total = { bytes: 0 }
    await run(5, total, 100, 'ab', 'cde')
    expect(total.bytes).toBe(5)
  })

  it('エントリの宣言値を超えたら中止する', async () => {
    await expect(run(3, { bytes: 0 }, 100, 'ab', 'cd')).rejects.toBeInstanceOf(BackupSizeLimitError)
  })

  it('全体の実測の累計が上限を超えたら中止する', async () => {
    await expect(run(100, { bytes: 8 }, 10, 'abc')).rejects.toBeInstanceOf(BackupSizeLimitError)
  })
})
