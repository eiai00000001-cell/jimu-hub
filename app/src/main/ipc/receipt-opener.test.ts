import { describe, expect, it, vi, beforeEach, type Mock } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { openPath, showItemInFolder } = vi.hoisted(() => ({
  openPath: vi.fn().mockResolvedValue(''),
  showItemInFolder: vi.fn()
}))
vi.mock('electron', () => ({ shell: { openPath, showItemInFolder } }))

import { ReceiptOpener, type ConfirmOpen } from './receipt-opener'

describe('ReceiptOpener', () => {
  let docs: string
  let opener: ReceiptOpener
  let confirm: Mock<ConfirmOpen>
  beforeEach(() => {
    vi.clearAllMocks()
    openPath.mockResolvedValue('')
    docs = join(mkdtempSync(join(tmpdir(), 'jimuhub-ro-')), 'documents')
    mkdirSync(join(docs, 'receipts', '2026'), { recursive: true })
    mkdirSync(join(docs, 'quotes'), { recursive: true })
    writeFileSync(join(docs, 'receipts', '2026', 'a.pdf'), '%PDF-')
    writeFileSync(join(docs, 'quotes', 'q.pdf'), '%PDF-')
    confirm = vi.fn<ConfirmOpen>().mockResolvedValue(true)
    opener = new ReceiptOpener(docs, confirm)
  })

  const sha = (content: string): string => createHash('sha256').update(content).digest('hex')

  it('receipts配下の存在するファイルを開く・Finderで表示する', async () => {
    expect(await opener.open('receipts/2026/a.pdf', sha('%PDF-'))).toEqual({ success: true })
    expect(openPath).toHaveBeenCalledWith(join(docs, 'receipts', '2026', 'a.pdf'))
    expect(opener.showInFolder('receipts/2026/a.pdf')).toEqual({ success: true })
    expect(showItemInFolder).toHaveBeenCalled()
  })

  it('配下でない・存在しない・nullは領収書用の文言で失敗し、OSへ渡さない', async () => {
    for (const p of ['quotes/q.pdf', 'receipts/2026/none.pdf', '../x.pdf', null]) {
      const r = await opener.open(p, sha('%PDF-'))
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
    expect((await opener.open('receipts/2026/a.pdf', sha('%PDF-'))).success).toBe(false)
  })

  describe('改変・欠落が疑われる場合は、開く前に確認する(R-16)', () => {
    it('照合が一致すれば確認なしで開く', async () => {
      await opener.open('receipts/2026/a.pdf', sha('%PDF-'))
      expect(confirm).not.toHaveBeenCalled()
      expect(openPath).toHaveBeenCalledTimes(1)
    })

    it('ハッシュ不一致は警告の確認を挟み、続行を選べば開く', async () => {
      expect(await opener.open('receipts/2026/a.pdf', sha('other'))).toEqual({ success: true })
      expect(confirm).toHaveBeenCalledWith(expect.stringContaining('改変が疑われます'))
      expect(openPath).toHaveBeenCalledTimes(1)
    })

    it('中止を選べば開かず、エラーにもしない', async () => {
      confirm.mockResolvedValue(false)
      expect(await opener.open('receipts/2026/a.pdf', sha('other'))).toEqual({ success: true })
      expect(openPath).not.toHaveBeenCalled()
    })

    it('ハッシュは一致しても中身が拡張子と合わない場合は確認する', async () => {
      writeFileSync(join(docs, 'receipts', '2026', 'b.pdf'), 'MZ fake')
      await opener.open('receipts/2026/b.pdf', sha('MZ fake'))
      expect(confirm).toHaveBeenCalledTimes(1)
    })
  })
})
