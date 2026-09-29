import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Database } from './db'

describe('Database', () => {
  let db: Database | undefined

  afterEach(() => {
    db?.close()
    db = undefined
  })

  it('初期化するとclients・app_meta・イテレーション1で追加したテーブルが作成される', () => {
    db = new Database(':memory:')
    db.initialize()

    const tableNames = db.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name)

    expect(tableNames).toContain('clients')
    expect(tableNames).toContain('app_meta')
    expect(tableNames).toContain('company_profile')
    expect(tableNames).toContain('document_number_sequences')
    expect(tableNames).toContain('quotes')
    expect(tableNames).toContain('quote_line_items')
    expect(tableNames).toContain('invoices')
    expect(tableNames).toContain('invoice_line_items')
  })

  it('clientsテーブルにfurigana列が含まれる(詳細設計書6.1章)', () => {
    db = new Database(':memory:')
    db.initialize()

    const columns = db.sqlite
      .prepare('PRAGMA table_info(clients)')
      .all()
      .map((row) => (row as { name: string }).name)

    expect(columns).toContain('furigana')
  })

  it('初期化を複数回実行してもエラーにならない(冪等)', () => {
    db = new Database(':memory:')
    expect(() => {
      db!.initialize()
      db!.initialize()
    }).not.toThrow()
  })

  it('schema_versionが未設定の場合は現在の最新バージョンを書き込む', () => {
    db = new Database(':memory:')
    db.initialize()

    const row = db.sqlite.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get()
    expect(row).toEqual({ value: '3' })
  })

  it('transactionは正常終了時にコミットする', () => {
    db = new Database(':memory:')
    db.initialize()

    db.transaction(() => {
      db!.sqlite.prepare("INSERT INTO clients (name) VALUES ('株式会社テスト')").run()
    })

    const count = db.sqlite.prepare('SELECT COUNT(*) as count FROM clients').get() as {
      count: number
    }
    expect(count.count).toBe(1)
  })

  it('reopenで接続を張り直しても、ファイル上のデータは維持される(復元処理での再接続を想定)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jimuhub-db-test-'))
    const filePath = join(dir, 'data.sqlite')
    try {
      db = new Database(filePath)
      db.initialize()
      db.sqlite.prepare("INSERT INTO clients (name) VALUES ('再接続前の取引先')").run()

      db.reopen()

      const row = db.sqlite.prepare('SELECT name FROM clients').get() as { name: string }
      expect(row.name).toBe('再接続前の取引先')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('transaction内で例外が発生した場合はロールバックする', () => {
    db = new Database(':memory:')
    db.initialize()

    expect(() => {
      db!.transaction(() => {
        db!.sqlite.prepare("INSERT INTO clients (name) VALUES ('ロールバック対象')").run()
        throw new Error('意図的な例外')
      })
    }).toThrow('意図的な例外')

    const count = db.sqlite.prepare('SELECT COUNT(*) as count FROM clients').get() as {
      count: number
    }
    expect(count.count).toBe(0)
  })
})
