import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import * as fsModule from 'node:fs'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Database } from '../db/db'
import { ClientRepository } from '../repositories/client.repository'
import { MigrationService } from './migration.service'
import { BackupService } from './backup.service'
import { CURRENT_SCHEMA_VERSION, type BackupFile } from '@shared/backup/backup-file'
import { BACKUP_MESSAGES } from '@shared/messages/messages'
import type { ClientInput } from '@shared/schemas/client.schema'

/**
 * copyFileSyncのみモック化し、既定では実際のファイルコピーを行う(通常のテストへの影響を避けるため)。
 * 個別のテストでのみ`mockImplementationOnce`で一時的に失敗させる(No.2対応の検証用)。
 */
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fsModule>()
  return { ...actual, copyFileSync: vi.fn(actual.copyFileSync) }
})

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

/**
 * status列のCHECK制約('active'/'inactive'以外は拒否)に違反する復元データ。
 * トランザクション内(insertWithId)で意図的に例外を発生させ、ロールバック・退避復旧を検証するために使用する。
 */
function buildBrokenPayload(): BackupFile {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    appVersion: '0.1.0',
    exportedAt: '2026-09-26T12:00:00.000Z',
    data: {
      clients: [
        {
          id: 999,
          name: '不正データ',
          honorific: '御中',
          contactPerson: null,
          postalCode: null,
          address: null,
          phone: null,
          email: null,
          invoiceRegistrationNumber: null,
          memo: null,
          status: 'invalid-status',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ]
    }
  }
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

  it('復元処理中に例外が発生した場合は、ロールバックし退避コピーから復旧する(詳細設計書4.3章手順8)', () => {
    repository.insert(baseInput)
    service.exportData(exportPath)

    // status列のCHECK制約に違反するデータで、トランザクション内(insertWithId)を意図的に失敗させる
    writeFileSync(exportPath, JSON.stringify(buildBrokenPayload()), 'utf-8')

    const result = service.importData(exportPath)

    // (1) importTransactionFailureが返ること
    expect(result.success).toBe(false)
    expect(result.error).toBe(BACKUP_MESSAGES.importTransactionFailure)

    // (2) データが退避コピー(直前のexportData時点)の内容に戻ること
    const restored = repository.findAllForBackup()
    expect(restored.map((c) => c.name)).toEqual(['株式会社サンプル'])

    // (3) reopenしたあとも正常に動くこと(読み書きが継続できる)
    const { id } = repository.insert({ ...baseInput, name: '再接続後に登録した取引先' })
    expect(repository.findById(id)?.name).toBe('再接続後に登録した取引先')
    expect(repository.findAllForBackup()).toHaveLength(2)
  })

  it('退避コピーからの復旧自体が失敗した場合も、例外を投げずにエラー結果を返す', async () => {
    repository.insert(baseInput)
    service.exportData(exportPath)
    writeFileSync(exportPath, JSON.stringify(buildBrokenPayload()), 'utf-8')

    const { copyFileSync: realCopyFileSync } = await vi.importActual<typeof fsModule>('node:fs')
    const mockedCopyFileSync = vi.mocked(fsModule.copyFileSync)
    // 1回目(復元前の退避コピー作成)は成功させ、2回目(失敗時の復旧コピー)だけ失敗させる
    mockedCopyFileSync.mockImplementationOnce((...args: Parameters<typeof fsModule.copyFileSync>) =>
      realCopyFileSync(...args)
    )
    mockedCopyFileSync.mockImplementationOnce(() => {
      throw new Error('シミュレートしたディスク障害')
    })

    const result = service.importData(exportPath)

    expect(result.success).toBe(false)
    expect(result.error).toBe(BACKUP_MESSAGES.importSafeguardRestoreFailure)
  })
})
