import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Database } from '../db/db'
import { ClientRepository } from '../repositories/client.repository'
import { MigrationService } from './migration.service'
import { BackupService } from './backup.service'
import { CURRENT_SCHEMA_VERSION } from '@shared/backup/backup-file'
import type { ClientInput } from '@shared/schemas/client.schema'

const baseInput: ClientInput = {
  name: '株式会社サンプル',
  honorific: '御中',
  contactPerson: '山田太郎',
  postalCode: '123-4567',
  address: '東京都千代田区1-1-1',
  phone: '03-1234-5678',
  email: 'sample@example.com',
  invoiceRegistrationNumber: 'T1234567890123',
  memo: '備考'
}

describe('BackupService', () => {
  let dir: string
  let dbFilePath: string
  let backupsDir: string
  let exportPath: string
  let db: Database
  let repository: ClientRepository
  let service: BackupService

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jimuhub-backup-test-'))
    dbFilePath = join(dir, 'data.sqlite')
    backupsDir = join(dir, 'backups')
    exportPath = join(dir, 'export.json')

    db = new Database(dbFilePath)
    db.initialize()
    repository = new ClientRepository(db)
    service = new BackupService({
      database: db,
      clientRepository: repository,
      migrationService: new MigrationService(),
      dbFilePath,
      backupsDir,
      appVersion: '0.1.0'
    })
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('exportDataで全データを含むJSONファイルを書き出す', () => {
    repository.insert(baseInput)
    repository.insert({ ...baseInput, name: '2件目' })

    const result = service.exportData(exportPath)

    expect(result.success).toBe(true)
    const written = JSON.parse(readFileSync(exportPath, 'utf-8'))
    expect(written.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(written.appVersion).toBe('0.1.0')
    expect(written.data.clients).toHaveLength(2)
  })

  it('exportDataは書き込み失敗時にsuccess:falseを返す', () => {
    const invalidPath = join(dir, 'no-such-directory', 'export.json')
    const result = service.exportData(invalidPath)
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('exportしたファイルをimportすると同じ件数が復元される(往復確認)', () => {
    repository.insert(baseInput)
    repository.insert({ ...baseInput, name: '2件目' })
    service.exportData(exportPath)

    repository.deleteAll()
    const result = service.importData(exportPath)

    expect(result.success).toBe(true)
    expect(result.importedCount).toBe(2)
    expect(repository.findAllForBackup()).toHaveLength(2)
  })

  it('importDataは復元前にidを保持したまま置き換える(全置換)', () => {
    const { id } = repository.insert(baseInput)
    service.exportData(exportPath)

    repository.insert({ ...baseInput, name: '復元前に追加された取引先' })
    const result = service.importData(exportPath)

    expect(result.success).toBe(true)
    const all = repository.findAllForBackup()
    expect(all.map((c) => c.id)).toEqual([id])
  })

  it('importDataはJSONとして解析できないファイルの場合エラーを返す', () => {
    writeFileSync(exportPath, '{ 壊れたJSON', 'utf-8')
    const result = service.importData(exportPath)

    expect(result.success).toBe(false)
    expect(result.error).toContain('読み込めませんでした')
  })

  it('importDataはschemaVersionが現行より新しい場合エラーを返す', () => {
    writeFileSync(
      exportPath,
      JSON.stringify({
        schemaVersion: CURRENT_SCHEMA_VERSION + 1,
        appVersion: '9.9.9',
        exportedAt: '2026-09-26T12:00:00.000Z',
        data: { clients: [] }
      }),
      'utf-8'
    )

    const result = service.importData(exportPath)
    expect(result.success).toBe(false)
    expect(result.error).toContain('新しいバージョン')
  })

  it('importData実行前に現行DBファイルを退避コピーする', () => {
    repository.insert(baseInput)
    service.exportData(exportPath)

    service.importData(exportPath)

    expect(existsSync(backupsDir)).toBe(true)
    const files = readdirSync(backupsDir)
    expect(files.length).toBeGreaterThan(0)
  })

  it('退避コピーは直近3世代のみ保持する', () => {
    repository.insert(baseInput)
    service.exportData(exportPath)

    for (let i = 0; i < 5; i += 1) {
      service.importData(exportPath)
    }

    const files = readdirSync(backupsDir)
    expect(files.length).toBe(3)
  })
})
