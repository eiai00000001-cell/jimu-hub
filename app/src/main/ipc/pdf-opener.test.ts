import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { openPath, showItemInFolder } = vi.hoisted(() => ({
  openPath: vi.fn().mockResolvedValue(''),
  showItemInFolder: vi.fn()
}))

vi.mock('electron', () => ({
  shell: { openPath, showItemInFolder }
}))

import { PdfOpener } from './pdf-opener'

describe('PdfOpener', () => {
  let root: string
  let documentsDir: string
  let opener: PdfOpener

  beforeEach(() => {
    vi.clearAllMocks()
    openPath.mockResolvedValue('')
    root = mkdtempSync(join(tmpdir(), 'jimuhub-pdf-opener-'))
    documentsDir = join(root, 'documents')
    mkdirSync(join(documentsDir, 'quotes', '2026'), { recursive: true })
    opener = new PdfOpener(documentsDir)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('documents配下に存在するPDF(拡張子の大文字小文字を問わない)はOSへ渡す', async () => {
    const pdf = join(documentsDir, 'quotes', '2026', '2026-001_サンプル.PDF')
    writeFileSync(pdf, '%PDF')

    expect(await opener.open(pdf)).toEqual({ success: true })
    expect(opener.showInFolder(pdf)).toEqual({ success: true })
    expect(openPath).toHaveBeenCalledWith(pdf)
    expect(showItemInFolder).toHaveBeenCalledWith(pdf)
  })

  it.each(['evil.terminal', 'evil.command', 'evil.app', 'evil.pdf.command', 'evil'])(
    'documents配下でも拡張子が.pdf以外(%s)の場合はOSへ渡さない(SEC-10)',
    async (fileName) => {
      const target = join(documentsDir, 'quotes', '2026', fileName)
      writeFileSync(target, 'x')

      const open = await opener.open(target)
      const show = opener.showInFolder(target)

      expect(open.success).toBe(false)
      expect(show.success).toBe(false)
      expect(openPath).not.toHaveBeenCalled()
      expect(showItemInFolder).not.toHaveBeenCalled()
    }
  )
})
