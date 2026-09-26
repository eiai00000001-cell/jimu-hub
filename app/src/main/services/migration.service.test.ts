import { describe, expect, it } from 'vitest'
import { MigrationService } from './migration.service'
import { CURRENT_SCHEMA_VERSION, type BackupFile } from '@shared/backup/backup-file'

const sampleData: BackupFile = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  appVersion: '0.1.0',
  exportedAt: '2026-09-26T12:00:00.000Z',
  data: {
    clients: [
      {
        id: 1,
        name: '株式会社サンプル',
        honorific: '御中',
        contactPerson: null,
        postalCode: null,
        address: null,
        phone: null,
        email: null,
        invoiceRegistrationNumber: null,
        memo: null,
        status: 'active',
        createdAt: '2026-09-26T12:00:00.000Z',
        updatedAt: '2026-09-26T12:00:00.000Z'
      }
    ]
  }
}

describe('MigrationService', () => {
  it('現行バージョンと一致する場合はそのまま返す', () => {
    const service = new MigrationService()
    const result = service.migrate(sampleData, CURRENT_SCHEMA_VERSION)
    expect(result).toEqual(sampleData)
  })
})
