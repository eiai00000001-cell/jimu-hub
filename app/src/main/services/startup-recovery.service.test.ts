import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { Database } from '../db/db'
import { ClientRepository } from '../repositories/client.repository'
import { initializeStartup } from '../startup'
import { BackupService } from './backup.service'
import { MigrationService } from './migration.service'
import { StartupRecoveryService } from './startup-recovery.service'

const CORRUPT = 'これは壊れたデータベースファイルです'
const client = {
  name: '復元される取引先',
  furigana: 'フクゲンサレルトリヒキサキ',
  honorific: '御中' as const,
  contactPerson: '',
  postalCode: '',
  address: '',
  phone: '',
  email: '',
  invoiceRegistrationNumber: '',
  memo: ''
}

describe('StartupRecoveryService(F-09)', () => {
  let dir: string
  let dbFilePath: string
  let backupsDir: string
  let documentsDir: string
  let exportPath: string
  let service: StartupRecoveryService

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jimuhub-recovery-test-'))
    dbFilePath = join(dir, 'data.sqlite')
    backupsDir = join(dir, 'backups')
    documentsDir = join(dir, 'documents')
    exportPath = join(dir, 'export.zip')

    // 別のDBでエクスポートファイル(ZIP)を用意する
    const srcPath = join(dir, 'source.sqlite')
    const src = new Database(srcPath)
    src.initialize()
    new ClientRepository(src).insert(client)
    new BackupService({
      database: src,
      clientRepository: new ClientRepository(src),
      migrationService: new MigrationService(),
      dbFilePath: srcPath,
      backupsDir: join(dir, 'src-backups'),
      documentsDir: join(dir, 'src-documents'),
      appVersion: '1.0.0'
    }).exportData(exportPath)
    src.close()

    writeFileSync(dbFilePath, CORRUPT)
    service = new StartupRecoveryService({
      dbFilePath,
      backupsDir,
      documentsDir,
      appVersion: '1.0.0'
    })
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('破損したDBでは起動に失敗する(前提確認)', () => {
    expect(initializeStartup(dbFilePath).status.ok).toBe(false)
  })

  it('復元に成功すると、破損DBをbackups/へ退避した新しいDBで通常起動できる', () => {
    const result = service.importData(exportPath)

    expect(result.success).toBe(true)
    expect(result.importedCount).toBe(1)
    const backups = readdirSync(backupsDir)
    const asideName = backups.find((n) => n.startsWith('corrupt_data_'))!
    expect(readFileSync(join(backupsDir, asideName), 'utf-8')).toBe(CORRUPT)

    const started = initializeStartup(dbFilePath)
    expect(started.status.ok).toBe(true)
    expect(new ClientRepository(started.database!).findAll().map((c) => c.name)).toEqual([
      '復元される取引先'
    ])
    started.database!.close()
  })

  it('旧JSON形式のエクスポートファイルでも復元できる', () => {
    const legacy = join(dir, 'legacy.json')
    const data = JSON.parse(new AdmZip(exportPath).getEntry('data.json')!.getData().toString())
    data.schemaVersion = 1
    writeFileSync(legacy, JSON.stringify({ ...data, data: { clients: data.data.clients } }))

    expect(service.importData(legacy).success).toBe(true)
    expect(initializeStartup(dbFilePath).status.ok).toBe(true)
  })

  it('復元に失敗した場合は、退避した元のDBファイルを元の場所へ戻し、再度選び直せる', () => {
    const broken = join(dir, 'broken.zip')
    writeFileSync(broken, 'PK壊れたZIP')

    const result = service.importData(broken)

    expect(result.success).toBe(false)
    expect(result.error).toContain('読み込めませんでした')
    expect(readFileSync(dbFilePath, 'utf-8')).toBe(CORRUPT)
    expect(existsSync(`${dbFilePath}-wal`)).toBe(false)

    // 同じ状態から正しいファイルで再試行できる
    expect(service.importData(exportPath).success).toBe(true)
  })

  it('エクスポートは起動エラー画面では行えない', () => {
    expect(service.exportData().success).toBe(false)
  })
})
