import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BackupArchiveWriter } from './archive-writer'

describe('BackupArchiveWriter(F-32)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'archive-writer-test-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('ファイルをストリームでZIPへ追加し、エントリごとに通知して、作業用ファイルの実サイズを返す', async () => {
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'src/a.txt'), 'あいう'.repeat(1000))
    writeFileSync(join(dir, 'src/b.bin'), Buffer.from([1, 2, 3]))
    const partial = join(dir, 'out.zip.partial')
    const names: string[] = []
    const writer = new BackupArchiveWriter(partial, (name) => names.push(name))
    writer.addFile(join(dir, 'src/a.txt'), 'data/a.txt')
    writer.addFile(join(dir, 'src/b.bin'), 'documents/b.bin')
    const size = await writer.finalize()

    expect(size).toBeGreaterThan(0)
    expect(names).toEqual(['data/a.txt', 'documents/b.bin'])
    const zip = new AdmZip(partial)
    expect(zip.getEntry('data/a.txt')!.getData().toString('utf-8')).toBe('あいう'.repeat(1000))
    expect([...zip.getEntry('documents/b.bin')!.getData()]).toEqual([1, 2, 3])
  })

  it('空のZIPも書き出せる', async () => {
    const partial = join(dir, 'empty.partial')
    const size = await new BackupArchiveWriter(partial).finalize()
    expect(size).toBeGreaterThan(0)
  })

  it('追加したファイルが読めない場合は、finalizeが失敗する', async () => {
    const partial = join(dir, 'broken.partial')
    const writer = new BackupArchiveWriter(partial)
    writer.addFile(join(dir, 'no-such-file'), 'data/x')
    await expect(writer.finalize()).rejects.toThrow()
    await writer.abort()
    expect(existsSync(partial)).toBe(false)
  })

  it('abortで作業用ファイルを削除する', async () => {
    const partial = join(dir, 'abort.partial')
    writeFileSync(join(dir, 'f.txt'), 'x')
    const writer = new BackupArchiveWriter(partial)
    writer.addFile(join(dir, 'f.txt'), 'f.txt')
    await writer.abort()
    expect(existsSync(partial)).toBe(false)
  })
})
