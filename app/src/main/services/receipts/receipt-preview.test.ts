import { describe, expect, it, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Database } from '../../db/db'
import { ReceiptRepository } from '../../repositories/receipt.repository'
import { ReceiptPreviewService, type ImageProcessor } from './receipt-preview'

/** ダミーのPNG(最小のシグネチャ+任意バイト。実画像は使わない) */
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('dummy-image')
])
const pdf = Buffer.from('%PDF-1.4\ndummy')

const fakeImages: ImageProcessor = {
  load: (buffer) =>
    buffer.toString().includes('unreadable')
      ? null
      : { thumbnailDataUrl: (w) => `data:image/png;base64,THUMB${w}` }
}

describe('ReceiptPreviewService(F-22。詳細設計書4.22章)', () => {
  let docs: string
  let repo: ReceiptRepository
  let service: ReceiptPreviewService
  let db: Database

  beforeEach(() => {
    docs = join(mkdtempSync(join(tmpdir(), 'jimuhub-rp2-')), 'documents')
    mkdirSync(join(docs, 'receipts', '2026'), { recursive: true })
    db = new Database(':memory:')
    db.initialize()
    db.sqlite.exec(
      "INSERT INTO cash_records (record_date, kind, amount, account_id, description) VALUES ('2026-10-01', 'expense', 1, 1, 'x')"
    )
    repo = new ReceiptRepository(db)
    service = new ReceiptPreviewService(docs, repo, fakeImages)
  })

  function add(
    name: string,
    content: Buffer,
    opts: { sha?: string; mime?: string; path?: string } = {}
  ): number {
    writeFileSync(join(docs, 'receipts', '2026', name), content)
    return repo.insert({
      recordId: 1,
      originalName: name,
      filePath: opts.path ?? `receipts/2026/${name}`,
      mimeType: opts.mime ?? 'image/png',
      fileSize: content.length,
      sha256: opts.sha ?? createHash('sha256').update(content).digest('hex')
    }).id
  }

  it('画像: サムネイルは縮小画像、拡大表示は元のバッファのdata URLを返す(パス・ハッシュは含めない)', () => {
    const id = add('a.png', png)
    expect(service.getThumbnail(id)).toEqual({
      success: true,
      state: 'ok',
      kind: 'image',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,THUMB120'
    })
    const preview = service.getPreview(id)
    expect(preview).toEqual({
      success: true,
      state: 'ok',
      kind: 'image',
      mimeType: 'image/png',
      dataUrl: `data:image/png;base64,${png.toString('base64')}`
    })
    expect(JSON.stringify(preview)).not.toContain('receipts/')
  })

  it('PDF: 内容は返さず種別のみ返す', () => {
    const id = add('a.pdf', pdf, { mime: 'application/pdf' })
    expect(service.getPreview(id)).toEqual({ success: true, state: 'ok', kind: 'pdf' })
    expect(service.getThumbnail(id)).toEqual({ success: true, state: 'ok', kind: 'pdf' })
  })

  it('ハッシュ不一致は画像を返さずmismatch', () => {
    const id = add('a.png', png, { sha: 'deadbeef' })
    expect(service.getThumbnail(id)).toEqual({ success: false, state: 'mismatch' })
    expect(service.getPreview(id)).toEqual({ success: false, state: 'mismatch' })
  })

  it('存在しない・ファイル欠落・保存先が不正はmissing', () => {
    expect(service.getPreview(999)).toEqual({ success: false, state: 'missing' })
    const id = add('a.png', png)
    const missing = repo.insert({
      recordId: 1,
      originalName: 'x',
      filePath: 'receipts/2026/none.png',
      mimeType: 'image/png',
      fileSize: 1,
      sha256: 'x'
    }).id
    expect(service.getPreview(missing)).toEqual({ success: false, state: 'missing' })
    const evil = add('b.png', png, { path: '../quotes/b.png' })
    expect(service.getPreview(evil)).toEqual({ success: false, state: 'missing' })
    expect(service.getPreview(id).success).toBe(true)
  })

  it('画像として読み込めない場合・内容と拡張子が一致しない場合はunreadable', () => {
    const bad = Buffer.concat([png, Buffer.from('unreadable')])
    expect(service.getPreview(add('c.png', bad))).toEqual({ success: false, state: 'unreadable' })
    expect(service.getPreview(add('d.png', pdf))).toEqual({ success: false, state: 'unreadable' })
  })
})
