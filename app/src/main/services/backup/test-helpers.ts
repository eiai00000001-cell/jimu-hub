import { readFileSync, writeFileSync } from 'node:fs'
import AdmZip from 'adm-zip'

/**
 * テスト用: ZIP(エントリ名→内容)を作る。`adm-zip`はテストの検証用にのみ使う(配布物には含めない)。
 */
export function buildZip(path: string, entries: Record<string, Buffer | string>): void {
  const zip = new AdmZip()
  for (const [name, content] of Object.entries(entries)) {
    zip.addFile(name, typeof content === 'string' ? Buffer.from(content, 'utf-8') : content)
  }
  zip.writeZip(path)
}

/** テスト用: ZIPのエントリ名→内容を読む */
export function readZipEntries(path: string): Map<string, Buffer> {
  const result = new Map<string, Buffer>()
  for (const entry of new AdmZip(path).getEntries()) {
    if (!entry.isDirectory) result.set(entry.entryName, entry.getData())
  }
  return result
}

/** テスト用: エクスポートしたZIPの`manifest.json`と各テーブルのレコードを読む */
export function readExport(path: string): {
  entries: Map<string, Buffer>
  manifest: {
    format: string
    schemaVersion: number
    appVersion: string
    exportedAt: string
    tables: Record<string, { file: string; count: number }>
  }
  records: (table: string) => Array<Record<string, unknown>>
} {
  const entries = readZipEntries(path)
  const manifest = JSON.parse(entries.get('manifest.json')!.toString('utf-8'))
  return {
    entries,
    manifest,
    records: (table) =>
      entries
        .get(`data/${table}.jsonl`)!
        .toString('utf-8')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line))
  }
}

/**
 * テスト用: 展開後サイズ(宣言値)が`minSize`以上のエントリの宣言値を、`size`へ書き換える。
 * 宣言値を偽装したZIP(解凍爆弾)の再現に使う。
 */
export function overwriteDeclaredSizes(path: string, size: number, minSize: number): void {
  const bytes = readFileSync(path)
  for (let i = 0; i + 4 <= bytes.length; i += 1) {
    const signature = bytes.readUInt32LE(i)
    if (signature === 0x04034b50 && bytes.readUInt32LE(i + 22) >= minSize) {
      bytes.writeUInt32LE(size, i + 22)
    }
    if (signature === 0x02014b50 && bytes.readUInt32LE(i + 24) >= minSize) {
      bytes.writeUInt32LE(size, i + 24)
    }
  }
  writeFileSync(path, bytes)
}

/**
 * テスト用: ZIP内のエントリ名を、同じ長さの別の名前へ書き換える(`adm-zip`が拒否する`..`等の再現用)。
 */
export function renameEntryInZip(path: string, from: string, to: string): void {
  if (Buffer.byteLength(from) !== Buffer.byteLength(to)) throw new Error('length mismatch')
  const bytes = readFileSync(path)
  const source = Buffer.from(from)
  const target = Buffer.from(to)
  let at = bytes.indexOf(source)
  while (at !== -1) {
    target.copy(bytes, at)
    at = bytes.indexOf(source, at + source.length)
  }
  writeFileSync(path, bytes)
}

/** テスト用: 全エントリの中央ディレクトリの項目(オフセット位置)を書き換える */
export function patchCentralHeaders(
  path: string,
  patch: (bytes: Buffer, headerOffset: number) => void
): void {
  const bytes = readFileSync(path)
  for (let i = 0; i + 4 <= bytes.length; i += 1) {
    if (bytes.readUInt32LE(i) === 0x02014b50) patch(bytes, i)
  }
  writeFileSync(path, bytes)
}
