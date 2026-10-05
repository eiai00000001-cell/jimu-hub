import { describe, expect, it, beforeEach } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveReceiptPath } from './receipt-path'

describe('resolveReceiptPath', () => {
  let docs: string
  beforeEach(() => {
    docs = join(mkdtempSync(join(tmpdir(), 'jimuhub-rp-')), 'documents')
    mkdirSync(join(docs, 'receipts', '2026'), { recursive: true })
    writeFileSync(join(docs, 'receipts', '2026', 'a.pdf'), '%PDF-')
    writeFileSync(join(docs, 'receipts', '2026', 'a.exe'), 'x')
    mkdirSync(join(docs, 'quotes'), { recursive: true })
    writeFileSync(join(docs, 'quotes', 'q.pdf'), '%PDF-')
  })

  it('documents/receipts配下の存在するファイルのみ解決する', () => {
    expect(resolveReceiptPath(docs, 'receipts/2026/a.pdf')).toBe(
      join(docs, 'receipts', '2026', 'a.pdf')
    )
  })

  it('配下でないパス・パストラバーサル・絶対パス・許可外の拡張子・存在しないファイル・空は拒否する', () => {
    for (const p of [
      'quotes/q.pdf',
      'receipts/../quotes/q.pdf',
      '../etc/passwd.pdf',
      '/etc/hosts.pdf',
      'receipts/2026/a.exe',
      'receipts/2026/missing.pdf',
      'receipts',
      ''
    ]) {
      expect(resolveReceiptPath(docs, p)).toBeNull()
    }
  })
})
