import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanupLeftoverPdfTempFiles, newPdfTempFilePath, pdfTempDir } from './temp-files'

describe('PDF一時ファイルの掃除(SEC-11)', () => {
  let base: string

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'jimuhub-temp-test-'))
  })
  afterEach(() => rmSync(base, { recursive: true, force: true }))

  it('専用フォルダ内の一時HTMLだけを削除し、それ以外には触れない', () => {
    const leftover1 = newPdfTempFilePath(base)
    const leftover2 = newPdfTempFilePath(base)
    writeFileSync(leftover1, '<html>x</html>')
    writeFileSync(leftover2, '<html>y</html>')
    const dir = pdfTempDir(base)
    const unrelatedInDir = join(dir, 'notes.txt')
    const lookalike = join(dir, 'render-abc.html')
    writeFileSync(unrelatedInDir, 'keep')
    writeFileSync(lookalike, 'keep')
    mkdirSync(join(dir, 'render-0123456789ab.html'))
    // 専用フォルダの外(旧形式の名前を含む)
    const outside = join(base, 'jimuhub-pdf-0123456789ab.html')
    const outsideOther = join(base, 'other.html')
    writeFileSync(outside, 'keep')
    writeFileSync(outsideOther, 'keep')

    expect(cleanupLeftoverPdfTempFiles(base)).toBe(2)

    expect(existsSync(leftover1)).toBe(false)
    expect(existsSync(leftover2)).toBe(false)
    for (const kept of [unrelatedInDir, lookalike, outside, outsideOther]) {
      expect(existsSync(kept)).toBe(true)
    }
    expect(existsSync(join(dir, 'render-0123456789ab.html'))).toBe(true)
  })

  it('シンボリックリンクの指す先は削除しない', () => {
    const target = join(base, 'precious.txt')
    writeFileSync(target, 'keep')
    const dir = pdfTempDir(base)
    mkdirSync(dir, { recursive: true })
    symlinkSync(target, join(dir, 'render-0123456789ab.html'))

    cleanupLeftoverPdfTempFiles(base)

    expect(existsSync(target)).toBe(true)
  })

  it('専用フォルダが無い場合は何もせず0件を返す', () => {
    expect(cleanupLeftoverPdfTempFiles(base)).toBe(0)
  })
})
