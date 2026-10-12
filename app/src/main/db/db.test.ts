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
    expect(row).toEqual({ value: '5' })
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

  describe('スキーマv4(イテレーション2。詳細設計書6.10〜6.13章)', () => {
    it('新規作成時はschema_versionが4で、4テーブルと初期科目14件が作成される', () => {
      db = new Database(':memory:')
      db.initialize()
      const names = db.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => (row as { name: string }).name)
      for (const table of ['accounts', 'cash_records', 'receipts', 'cash_record_history']) {
        expect(names).toContain(table)
      }
      const version = db.sqlite
        .prepare("SELECT value FROM app_meta WHERE key = 'schema_version'")
        .get() as { value: string }
      expect(version.value).toBe('5')

      const rows = db.sqlite
        .prepare('SELECT name, kind, sort_order, is_default, default_key FROM accounts ORDER BY id')
        .all() as Array<{
        name: string
        kind: string
        sort_order: number
        is_default: number
        default_key: string | null
      }>
      expect(rows).toHaveLength(14)
      expect(rows.filter((r) => r.kind === 'expense').map((r) => r.name)).toEqual([
        '通信費',
        '旅費交通費',
        '消耗品費',
        '接待交際費',
        '外注費',
        '会議費',
        '地代家賃',
        '水道光熱費',
        '広告宣伝費',
        '租税公課',
        '支払手数料',
        '雑費'
      ])
      expect(rows.filter((r) => r.kind === 'expense').map((r) => r.sort_order)).toEqual(
        Array.from({ length: 12 }, (_, i) => (i + 1) * 10)
      )
      expect(rows.filter((r) => r.kind === 'income').map((r) => r.name)).toEqual([
        '売上高',
        '雑収入'
      ])
      expect(rows.every((r) => r.is_default === 1)).toBe(true)
      expect(rows.filter((r) => r.default_key !== null)).toEqual([
        expect.objectContaining({ name: '売上高', default_key: 'sales_revenue' })
      ])
    })

    it('既存DB(v3)でinitialize()を呼んでも初期科目は投入されず、再実行しても重複しない', () => {
      db = new Database(':memory:')
      db.initialize()
      db.sqlite.exec('DELETE FROM accounts')
      db.initialize()
      const count = db.sqlite.prepare('SELECT COUNT(*) AS c FROM accounts').get() as { c: number }
      expect(count.c).toBe(0)
    })

    it('履歴テーブルはUPDATE・DELETEをトリガーで拒否する', () => {
      db = new Database(':memory:')
      db.initialize()
      db.sqlite
        .prepare(
          "INSERT INTO cash_records (record_date, kind, amount, account_id, description) VALUES ('2026-10-01', 'expense', 100, 1, 'x')"
        )
        .run()
      db.sqlite
        .prepare(
          "INSERT INTO cash_record_history (record_id, operation, snapshot_after, record_hash_after) VALUES (1, 'create', '{}', 'h')"
        )
        .run()
      expect(() => db!.sqlite.prepare("UPDATE cash_record_history SET reason = 'x'").run()).toThrow(
        '履歴は変更できません'
      )
      expect(() => db!.sqlite.prepare('DELETE FROM cash_record_history').run()).toThrow(
        '履歴は削除できません'
      )
    })
  })
})
