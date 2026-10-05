import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IPC_CHANNELS } from '@shared/ipc/channels'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()
const { showOpenDialog } = vi.hoisted(() => ({ showOpenDialog: vi.fn() }))

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: { getFocusedWindow: () => null },
  dialog: { showOpenDialog },
  ipcMain: { handle: vi.fn((c: string, h: Handler) => handlers.set(c, h)) },
  nativeImage: {},
  shell: { openPath: vi.fn().mockResolvedValue(''), showItemInFolder: vi.fn() }
}))

import { ReceiptsIpcHandler } from './receipts.ipc-handler'
import { Database } from '../db/db'
import { createRecordServices } from '../services/record-services'

describe('ReceiptsIpcHandler(F-22)', () => {
  let work: string
  beforeEach(() => {
    handlers.clear()
    vi.clearAllMocks()
    work = mkdtempSync(join(tmpdir(), 'jimuhub-rih-'))
    const db = new Database(':memory:')
    db.initialize()
    const s = createRecordServices(db, join(work, 'documents'))
    new ReceiptsIpcHandler(s.receiptService, s.receiptRepository, join(work, 'documents'), {
      load: () => null
    }).registerHandlers()
  })
  const call = (c: string, ...a: unknown[]): Promise<unknown> =>
    Promise.resolve(handlers.get(c)!({}, ...a))

  it('全チャンネルを登録する', () => {
    for (const c of [
      'receiptsPick',
      'receiptsOpen',
      'receiptsShowInFolder',
      'receiptsThumbnail',
      'receiptsPreview'
    ] as const) {
      expect(handlers.has(IPC_CHANNELS[c])).toBe(true)
    }
  })

  it('receipts:pickはダイアログで選んだファイルを検証し、識別子のみを返す(パスを返さない)。キャンセルは空', async () => {
    const pdf = join(work, 'a.pdf')
    writeFileSync(pdf, '%PDF-1.4 dummy')
    const bad = join(work, 'b.txt')
    writeFileSync(bad, 'text')
    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [pdf, bad] })
    const result = (await call(IPC_CHANNELS.receiptsPick)) as {
      files: Array<Record<string, unknown>>
      errors: Array<{ fileName: string }>
    }
    expect(result.files).toHaveLength(1)
    expect(Object.keys(result.files[0]!).sort()).toEqual(['fileName', 'fileSize', 'token'])
    expect(JSON.stringify(result)).not.toContain(work)
    expect(result.errors.map((e) => e.fileName)).toEqual(['b.txt'])
    showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    expect(await call(IPC_CHANNELS.receiptsPick)).toEqual({ files: [], errors: [] })
  })

  it('存在しない領収書のopen・thumbnail・previewは例外にせず失敗結果を返し、不正なidは拒否する', async () => {
    expect(await call(IPC_CHANNELS.receiptsOpen, 999)).toMatchObject({ success: false })
    expect(await call(IPC_CHANNELS.receiptsThumbnail, 999)).toEqual({
      success: false,
      state: 'missing'
    })
    expect(await call(IPC_CHANNELS.receiptsPreview, 999)).toEqual({
      success: false,
      state: 'missing'
    })
    await expect(call(IPC_CHANNELS.receiptsOpen, 'abc')).rejects.toThrow()
    await expect(call(IPC_CHANNELS.receiptsPreview, 0)).rejects.toThrow()
  })
})
