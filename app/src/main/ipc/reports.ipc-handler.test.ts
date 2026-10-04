import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IPC_CHANNELS } from '@shared/ipc/channels'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()
const { showSaveDialog } = vi.hoisted(() => ({ showSaveDialog: vi.fn() }))
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp' },
  BrowserWindow: { getFocusedWindow: () => null },
  dialog: { showSaveDialog },
  ipcMain: { handle: vi.fn((c: string, h: Handler) => handlers.set(c, h)) }
}))

import { ReportsIpcHandler } from './reports.ipc-handler'
import { Database } from '../db/db'
import { CashRecordRepository } from '../repositories/cash-record.repository'
import { SummaryRepository } from '../repositories/summary.repository'
import { CsvExportService } from '../services/csv-export.service'
import { SummaryService } from '../services/summary.service'

describe('ReportsIpcHandler(F-23・F-24)', () => {
  let work: string
  let db: Database
  beforeEach(() => {
    handlers.clear()
    vi.clearAllMocks()
    work = mkdtempSync(join(tmpdir(), 'jimuhub-rep-'))
    db = new Database(':memory:')
    db.initialize()
    new ReportsIpcHandler(
      new SummaryService(new SummaryRepository(db)),
      new CsvExportService(new CashRecordRepository(db))
    ).registerHandlers()
  })
  const call = (c: string, ...a: unknown[]): Promise<unknown> =>
    Promise.resolve(handlers.get(c)!({}, ...a))
  const addRecord = (): void => {
    db.sqlite
      .prepare(
        "INSERT INTO cash_records (record_date, kind, amount, account_id, description) VALUES ('2026-09-28', 'expense', 100, 1, 'x')"
      )
      .run()
  }

  it('summary:getは集計を返し、不正な入力は拒否する', async () => {
    const r = (await call(IPC_CHANNELS.summaryGet, { year: 2026, month: null })) as {
      monthly: unknown[]
    }
    expect(r.monthly).toHaveLength(12)
    await expect(call(IPC_CHANNELS.summaryGet, { year: 'x', month: null })).rejects.toThrow()
    await expect(call(IPC_CHANNELS.summaryGet, { year: 2026, month: 0 })).rejects.toThrow()
    await expect(call(IPC_CHANNELS.summaryGet, undefined)).rejects.toThrow()
  })

  it('csv:export: 0件は保存ダイアログを開かずemptyを返す', async () => {
    expect(
      await call(IPC_CHANNELS.csvExport, { fromMonth: '2026-01', toMonth: '2026-12' })
    ).toEqual({
      success: false,
      reason: 'empty',
      error: '対象期間に出力する記録がありません'
    })
    expect(showSaveDialog).not.toHaveBeenCalled()
  })

  it('csv:export: 保存ダイアログで選んだ場所へ書き出し、保存先と件数を返す。キャンセルはcanceled', async () => {
    addRecord()
    const out = join(work, 'out.csv')
    showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: out })
    expect(
      await call(IPC_CHANNELS.csvExport, { fromMonth: '2026-09', toMonth: '2026-09' })
    ).toEqual({
      success: true,
      filePath: out,
      count: 1
    })
    expect(readFileSync(out, 'utf8').startsWith('﻿日付,')).toBe(true)
    expect(showSaveDialog.mock.calls[0]![0]).toMatchObject({
      defaultPath: '/tmp/事務HUB_入出金経費_2026-09_2026-09.csv'
    })
    showSaveDialog.mockResolvedValueOnce({ canceled: true })
    expect(
      await call(IPC_CHANNELS.csvExport, { fromMonth: '2026-09', toMonth: '2026-09' })
    ).toEqual({
      success: false,
      reason: 'canceled'
    })
  })

  it('csv:export: 書き込み失敗はerrorとして文言を返す(例外にしない)。不正な期間は拒否する', async () => {
    addRecord()
    const bad = join(work, 'nodir', 'out.csv')
    showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: bad })
    expect(
      await call(IPC_CHANNELS.csvExport, { fromMonth: '2026-09', toMonth: '2026-09' })
    ).toEqual({
      success: false,
      reason: 'error',
      error: 'CSVファイルの保存に失敗しました。保存先の空き容量・書き込み権限をご確認ください'
    })
    expect(existsSync(bad)).toBe(false)
    await expect(
      call(IPC_CHANNELS.csvExport, { fromMonth: '2026-12', toMonth: '2026-01' })
    ).rejects.toThrow()
    await expect(
      call(IPC_CHANNELS.csvExport, { fromMonth: '', toMonth: '2026-01' })
    ).rejects.toThrow()
  })
})
