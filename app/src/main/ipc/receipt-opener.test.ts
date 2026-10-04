import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { openPath, showItemInFolder } = vi.hoisted(() => ({
  openPath: vi.fn().mockResolvedValue(''),
  showItemInFolder: vi.fn()
}))
vi.mock('electron', () => ({ shell: { openPath, showItemInFolder } }))

import { ReceiptOpener } from './receipt-opener'

describe('ReceiptOpener', () => {
  let docs: string
  let opener: ReceiptOpener
  beforeEach(() => {
    vi.clearAllMocks()
    openPath.mockResolvedValue('')
    docs = join(mkdtempSync(join(tmpdir(), 'jimuhub-ro-')), 'documents')
    mkdirSync(join(docs, 'receipts', '2026'), { recursive: true })
    mkdirSync(join(docs, 'quotes'), { recursive: true })
    writeFileSync(join(docs, 'receipts', '2026', 'a.pdf'), '%PDF-')
    writeFileSync(join(docs, 'quotes', 'q.pdf'), '%PDF-')
    opener = new ReceiptOpener(docs)
  })

  it('receipts配下の存在するファイルを開く・Finderで表示する', async () => {
    expect(await opener.open('receipts/2026/a.pdf')).toEqual({ success: true })
    expect(openPath).toHaveBeenCalledWith(join(docs, 'receipts', '2026', 'a.pdf'))
    expect(opener.showInFolder('receipts/2026/a.pdf')).toEqual({ success: true })
    expect(showItemInFolder).toHaveBeenCalled()
  })

  it('配下でない・存在しない・nullは領収書用の文言で失敗し、OSへ渡さない', async () => {
    for (const p of ['quotes/q.pdf', 'receipts/2026/none.pdf', '../x.pdf', null]) {
      const r = await opener.open(p)
      expect(r).toEqual({
        success: false,
        error: expect.stringContaining('領収書ファイルが見つかりません')
      })
      expect(opener.showInFolder(p).success).toBe(false)
    }
    expect(openPath).not.toHaveBeenCalled()
    expect(showItemInFolder).not.toHaveBeenCalled()
  })

  it('OSが開けなかった場合も失敗として返す', async () => {
    openPath.mockResolvedValue('error')
    expect((await opener.open('receipts/2026/a.pdf')).success).toBe(false)
  })
})
