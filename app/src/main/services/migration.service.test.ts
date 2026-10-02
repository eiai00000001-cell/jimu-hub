import { describe, expect, it, afterEach } from 'vitest'
import { MigrationService } from './migration.service'
import { CURRENT_SCHEMA_VERSION, type BackupFile } from '@shared/backup/backup-file'
import { Database, CURRENT_SCHEMA_VERSION as CURRENT_DB_SCHEMA_VERSION } from '../db/db'

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
    ],
    companyProfile: null,
    quotes: [],
    quoteLineItems: [],
    invoices: [],
    invoiceLineItems: []
  }
}

/** イテレーション0時点(schema_version=1)の物理スキーマを模したDDL(furigana列・新規テーブルを含まない) */
const CREATE_LEGACY_CLIENTS_TABLE = `
CREATE TABLE clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  honorific TEXT NOT NULL DEFAULT '(なし)' CHECK (honorific IN ('御中', '様', '(なし)')),
  contact_person TEXT,
  postal_code TEXT,
  address TEXT,
  phone TEXT,
  email TEXT,
  invoice_registration_number TEXT,
  memo TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
`
const CREATE_LEGACY_APP_META_TABLE = `
CREATE TABLE app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

describe('MigrationService', () => {
  it('現行バージョンと一致する場合はそのまま返す', () => {
    const service = new MigrationService()
    const result = service.migrateExportData(sampleData, CURRENT_SCHEMA_VERSION)
    expect(result).toEqual(sampleData)
  })

  it('旧バージョン(schemaVersion 2)のデータは現行バージョンへ変換し、pdfHashMismatchをfalseで補う', () => {
    const service = new MigrationService()
    const old: BackupFile = {
      ...sampleData,
      schemaVersion: 2,
      data: { ...sampleData.data, quotes: [{ id: 1, quoteNumber: '2026-001' }] }
    }
    const result = service.migrateExportData(old, 2)
    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(result.data.quotes[0]).toEqual({
      id: 1,
      quoteNumber: '2026-001',
      pdfHashMismatch: false
    })
  })

  it('schemaVersion 1(取引先のみ)のデータも現行構造へ変換できる', () => {
    const service = new MigrationService()
    const result = service.migrateExportData({ ...sampleData, schemaVersion: 1 }, 1)
    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(result.data.quotes).toEqual([])
    expect(result.data.companyProfile).toBeNull()
  })

  describe('applyMigrations(既存インストールのDBスキーマ移行)', () => {
    let db: Database

    afterEach(() => {
      db.close()
    })

    /** iteration0(schema_version=1)相当の状態を模したDBを用意する */
    function setupLegacyDatabase(): Database {
      const legacyDb = new Database(':memory:')
      legacyDb.sqlite.exec(CREATE_LEGACY_CLIENTS_TABLE)
      legacyDb.sqlite.exec(CREATE_LEGACY_APP_META_TABLE)
      legacyDb.sqlite
        .prepare("INSERT INTO app_meta (key, value) VALUES ('schema_version', '1')")
        .run()
      return legacyDb
    }

    it('fromVersion=1の場合、clientsにfurigana列を追加しschema_versionを最新へ更新する(詳細設計書4.1章)', () => {
      db = setupLegacyDatabase()
      // 新規テーブル(company_profile等)はDatabase.initialize()相当で先に作成されている前提のため、
      // ここでは通常の起動フロー(startup.ts)に合わせてinitialize()を先に実行する
      db.initialize()

      const service = new MigrationService()
      service.applyMigrations(db, 1)

      const columns = db.sqlite
        .prepare('PRAGMA table_info(clients)')
        .all()
        .map((row) => (row as { name: string }).name)
      expect(columns).toContain('furigana')

      const version = db.sqlite
        .prepare("SELECT value FROM app_meta WHERE key = 'schema_version'")
        .get() as { value: string }
      expect(version.value).toBe(String(CURRENT_DB_SCHEMA_VERSION))
    })

    it('複数回実行してもエラーにならない(冪等)', () => {
      db = setupLegacyDatabase()
      db.initialize()

      const service = new MigrationService()
      expect(() => {
        service.applyMigrations(db, 1)
        service.applyMigrations(db, 1)
      }).not.toThrow()
    })

    it('fromVersionが現行バージョンの場合はカラム追加を行わずschema_versionのみ確認する', () => {
      db = new Database(':memory:')
      db.initialize()

      const service = new MigrationService()
      expect(() => service.applyMigrations(db, CURRENT_DB_SCHEMA_VERSION)).not.toThrow()

      const version = db.sqlite
        .prepare("SELECT value FROM app_meta WHERE key = 'schema_version'")
        .get() as { value: string }
      expect(version.value).toBe(String(CURRENT_DB_SCHEMA_VERSION))
    })
  })
})
