import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LegacyJsonRecordSource } from './legacy-record-source'
import { BackupStagingArea } from './staging-area'
import { BackupFileSchema } from '@shared/backup/backup-file'

describe('BackupStagingArea(F-32)', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'staging-test-'))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('権限700の一時フォルダを作成し、削除できる', () => {
    const area = new BackupStagingArea(join(root, 'tmp'))
    const dir = area.create('export')
    expect(dir).toContain('export-')
    expect(statSync(dir).mode & 0o777).toBe(0o700)
    writeFileSync(join(dir, 'x.txt'), 'x')
    area.remove(dir)
    expect(existsSync(dir)).toBe(false)
    // 存在しないフォルダの削除もエラーにならない
    expect(() => area.remove(dir)).not.toThrow()
  })

  it('同時刻でも別のフォルダを作成する', () => {
    const area = new BackupStagingArea(join(root, 'tmp'))
    const dirs = new Set([area.create('restore'), area.create('restore'), area.create('restore')])
    expect(dirs.size).toBe(3)
  })

  it('起動時に、異常終了で残ったexport-*・restore-*のみを削除する', () => {
    const tmp = join(root, 'tmp')
    const area = new BackupStagingArea(tmp)
    mkdirSync(join(tmp, 'export-a'), { recursive: true })
    mkdirSync(join(tmp, 'restore-b'), { recursive: true })
    mkdirSync(join(tmp, 'other'), { recursive: true })
    area.removeLeftovers()
    expect(existsSync(join(tmp, 'export-a'))).toBe(false)
    expect(existsSync(join(tmp, 'restore-b'))).toBe(false)
    expect(existsSync(join(tmp, 'other'))).toBe(true)
    // tmpフォルダが無くてもエラーにならない
    expect(() => new BackupStagingArea(join(root, 'none')).removeLeftovers()).not.toThrow()
  })
})

describe('LegacyJsonRecordSource(F-32)', () => {
  it('従来形式のレコードを、テーブル名で取り出せる', () => {
    const backup = BackupFileSchema.parse({
      schemaVersion: 4,
      appVersion: '0.3.0',
      exportedAt: '2026-01-01T00:00:00Z',
      data: {
        clients: [],
        companyProfile: { id: 1, name: '自社' },
        quotes: [{ id: 7 }]
      }
    })
    const source = new LegacyJsonRecordSource(backup)
    expect(source.records('companyProfile')).toEqual([{ id: 1, name: '自社' }])
    expect(source.records('quotes')).toEqual([{ id: 7 }])
    expect(source.records('clients')).toEqual([])
    expect(source.records('unknown')).toEqual([])
  })

  it('自社情報が無い場合は0件を返す', () => {
    const backup = BackupFileSchema.parse({
      schemaVersion: 1,
      appVersion: '0.1.0',
      exportedAt: 'x',
      data: { clients: [] }
    })
    expect(new LegacyJsonRecordSource(backup).records('companyProfile')).toEqual([])
  })
})
