import { describe, expect, it, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  statSync,
  truncateSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ReceiptService } from './receipt.service'
import { ReceiptStagingStore } from './receipt-staging-store'

/** ダミーの領収書(実ファイルは使わない) */
const dummyPdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('dummy receipt')])
const dummyPng = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(16)
])

describe('ReceiptService(F-22)', () => {
  let work: string
  let docs: string
  let staging: ReceiptStagingStore
  let service: ReceiptService

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'jimuhub-rs-'))
    docs = join(work, 'documents')
    staging = new ReceiptStagingStore()
    service = new ReceiptService(docs, staging)
  })

  const file = (name: string, content: Buffer): string => {
    const p = join(work, name)
    writeFileSync(p, content)
    return p
  }

  describe('容量の検証は読み込み前に行う(R-15)', () => {
    // 3GBのスパースファイル。読み込みを先に行うとNodeの上限エラーになり、「形式が不正」へ化ける
    const hugeFile = (name: string): string => {
      const p = file(name, dummyPdf)
      truncateSync(p, 3 * 1024 * 1024 * 1024)
      return p
    }

    it('pickAndStage: 上限超過は読み込まずに「1ファイル10MBまで」とする', () => {
      const result = service.pickAndStage([hugeFile('huge.pdf')])
      expect(result.files).toEqual([])
      expect(result.errors[0]!.error).toBe('領収書は1ファイル10MBまでです')
    })

    it('storeFromTokens: 選択後に大きくなったファイルも読み込まずに拒否し、何も保存しない', () => {
      const path = file('grow.pdf', dummyPdf)
      const picked = service.pickAndStage([path])
      truncateSync(path, 3 * 1024 * 1024 * 1024)
      expect(() => service.storeFromTokens([picked.files[0]!.token])).toThrow(
        '領収書は1ファイル10MBまでです'
      )
      expect(existsSync(join(docs, 'receipts'))).toBe(false)
    })
  })

  it('pickAndStage: 検証に通ったファイルは識別子つきで返し、通らないものはエラーとして返す(他は追加できる)', () => {
    const result = service.pickAndStage([
      file('a.pdf', dummyPdf),
      file('bad.pdf', Buffer.from('not a pdf')),
      file('c.png', dummyPng),
      join(work, 'missing.pdf')
    ])
    expect(result.files.map((f) => f.fileName)).toEqual(['a.pdf', 'c.png'])
    expect(result.files[0]).toEqual({
      token: expect.any(String),
      fileName: 'a.pdf',
      fileSize: dummyPdf.length
    })
    expect(result.errors.map((e) => e.fileName)).toEqual(['bad.pdf', 'missing.pdf'])
    expect(result.errors[0]!.error).toBe('領収書として添付できるのは、PDF・JPEG・PNGのファイルです')
  })

  it('storeFromTokens: receipts/<年>/<UUID>.<拡張子>へ保存し、SHA-256を算出する。元のファイル名はパスに使わない', () => {
    const picked = service.pickAndStage([file('私の領収書.pdf', dummyPdf)])
    const [stored] = service.storeFromTokens([picked.files[0]!.token])
    expect(stored).toMatchObject({
      originalName: '私の領収書.pdf',
      mimeType: 'application/pdf',
      fileSize: dummyPdf.length
    })
    expect(stored!.filePath).toMatch(
      new RegExp(`^receipts/${new Date().getFullYear()}/[0-9a-f-]{36}\\.pdf$`)
    )
    expect(stored!.sha256).toBe(createHash('sha256').update(dummyPdf).digest('hex'))
    const absolute = join(docs, stored!.filePath)
    expect(readFileSync(absolute)).toEqual(dummyPdf)
    expect(statSync(join(absolute, '..')).mode & 0o777).toBe(0o700)
  })

  it('保存の直前に再検証し、選択後にファイルが差し替えられた場合は拒否する', () => {
    const path = file('a.pdf', dummyPdf)
    const picked = service.pickAndStage([path])
    writeFileSync(path, Buffer.from('replaced content'))
    expect(() => service.storeFromTokens([picked.files[0]!.token])).toThrow(
      '領収書として添付できるのは、PDF・JPEG・PNGのファイルです'
    )
  })

  it('無効な識別子は拒否し、複数のうち1件でも失敗したら保存済みのファイルを削除する', () => {
    const picked = service.pickAndStage([file('a.pdf', dummyPdf)])
    expect(() => service.storeFromTokens(['unknown'])).toThrow(
      '選択したファイルが無効になりました。もう一度ファイルを選択してください'
    )
    expect(() => service.storeFromTokens([picked.files[0]!.token, 'unknown'])).toThrow()
    const dir = join(docs, 'receipts', String(new Date().getFullYear()))
    expect(existsSync(dir) ? readdirCount(dir) : 0).toBe(0)
  })

  it('discard: 保存済みファイルを削除する。releaseTokensで識別子を破棄する', () => {
    const picked = service.pickAndStage([file('a.pdf', dummyPdf)])
    const stored = service.storeFromTokens([picked.files[0]!.token])
    service.discard(stored)
    expect(existsSync(join(docs, stored[0]!.filePath))).toBe(false)
    service.releaseTokens([picked.files[0]!.token])
    expect(() => service.storeFromTokens([picked.files[0]!.token])).toThrow()
  })
})

import { readdirSync } from 'node:fs'
function readdirCount(dir: string): number {
  return readdirSync(dir).length
}
