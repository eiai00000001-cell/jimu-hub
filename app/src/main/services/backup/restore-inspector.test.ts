import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Database } from '../../db/db'
import { BackupParseError, BackupSizeLimitError, BackupVersionTooNewError } from './errors'
import { RestoreInspector } from './restore-inspector'
import { RestoreSessionStore } from './restore-session-store'
import { buildZip } from './test-helpers'

const LIMITS = {
  maxFileBytes: 1024 * 1024,
  maxEntries: 100,
  maxTotalUncompressedBytes: 1024 * 1024
}

function manifest(schemaVersion: number, receipts: number, projects?: number): string {
  const tables: Record<string, unknown> = {
    receipts: { file: 'data/receipts.jsonl', count: receipts }
  }
  if (projects !== undefined) tables.projects = { file: 'data/projects.jsonl', count: projects }
  return JSON.stringify({
    format: 'jimuhub-backup',
    schemaVersion,
    appVersion: '0.4.0',
    exportedAt: 'x',
    tables
  })
}

function legacy(schemaVersion: number, receipts: unknown[] = []): string {
  return JSON.stringify({
    schemaVersion,
    appVersion: '0.3.0',
    exportedAt: 'x',
    data: { clients: [], receipts }
  })
}

describe('RestoreInspector(F-33。詳細設計書4.33章)', () => {
  let dir: string
  let db: Database
  let store: RestoreSessionStore

  const inspector = (database: Database | null = db, limits = LIMITS): RestoreInspector =>
    new RestoreInspector({ database, store, ...limits })

  /** 現在のデータとして、領収書(記録から外していないもの)を指定件数用意する */
  function seedReceipts(active: number, removed = 0): void {
    db.sqlite.exec(
      `INSERT INTO accounts (name, kind, status, is_default, sort_order) VALUES ('科目', 'expense', 'active', 0, 1)`
    )
    db.sqlite.exec(
      `INSERT INTO cash_records (record_date, kind, amount, account_id, description, record_hash)
       VALUES ('2026-01-01', 'expense', 100, 1, 'x', 'h')`
    )
    const insert = db.sqlite.prepare(
      `INSERT INTO receipts (record_id, file_path, original_name, mime_type, file_size, sha256, removed_at)
       VALUES (1, ?, 'a.pdf', 'application/pdf', 1, 's', ?)`
    )
    for (let i = 0; i < active; i += 1) insert.run(`receipts/2026/${i}.pdf`, null)
    for (let i = 0; i < removed; i += 1) insert.run(`receipts/2026/r${i}.pdf`, '2026-01-02')
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'inspector-test-'))
    db = new Database(join(dir, 'data.sqlite'))
    db.initialize()
    store = new RestoreSessionStore()
  })
  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('領収書を含むバックアップは、現在の領収書があっても確認不要。識別子とファイル名を返す', async () => {
    seedReceipts(2)
    const path = join(dir, 'ok.zip')
    buildZip(path, { 'manifest.json': manifest(5, 3) })

    const result = await inspector().inspect(path)

    expect(result).toMatchObject({
      fileName: 'ok.zip',
      schemaVersion: 5,
      hasReceipts: true,
      hasProjects: false,
      currentReceiptCount: 2,
      currentProjectCount: 0,
      needsConfirmation: false
    })
    expect(store.resolve(result.token)).toBe(path)
  })

  it('領収書を含まないバックアップで、現在の領収書が1件以上ある場合は確認が必要(外した領収書は数えない)', async () => {
    seedReceipts(1, 3)
    const path = join(dir, 'no-receipts.zip')
    buildZip(path, { 'manifest.json': manifest(5, 0) })

    const result = await inspector().inspect(path)

    expect(result).toMatchObject({
      hasReceipts: false,
      currentReceiptCount: 1,
      needsConfirmation: true
    })
  })

  it('現在の領収書が0件なら、領収書を含まないバックアップでも確認は不要', async () => {
    const path = join(dir, 'a.zip')
    buildZip(path, { 'manifest.json': manifest(5, 0) })
    expect((await inspector().inspect(path)).needsConfirmation).toBe(false)
  })

  it('案件の有無は、manifestのprojectsの件数で判定する', async () => {
    const path = join(dir, 'p.zip')
    buildZip(path, { 'manifest.json': manifest(5, 1, 2) })
    expect(await inspector().inspect(path)).toMatchObject({ hasProjects: true })
  })

  it('現在の案件が1件以上あり、バックアップに案件が無い場合は確認が必要', async () => {
    db.sqlite.exec(`CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY, name TEXT)`)
    db.sqlite.exec(`INSERT INTO projects (id, name) VALUES (1, '案件')`)
    const path = join(dir, 'np.zip')
    buildZip(path, { 'manifest.json': manifest(5, 1) })

    const result = await inspector().inspect(path)

    expect(result).toMatchObject({
      hasProjects: false,
      currentProjectCount: 1,
      needsConfirmation: true
    })
  })

  it('従来形式(スキーマ4のdata.json)は、領収書の配列の件数で判定し、案件は常に無い', async () => {
    const path = join(dir, 'v4.zip')
    buildZip(path, { 'data.json': legacy(4, [{ id: 1 }]) })
    expect(await inspector().inspect(path)).toMatchObject({
      schemaVersion: 4,
      hasReceipts: true,
      hasProjects: false
    })
  })

  it('従来形式(スキーマ1〜3のdata.json)・JSON単体は、領収書も案件も無いものとして扱う', async () => {
    seedReceipts(2)
    const zip = join(dir, 'v3.zip')
    buildZip(zip, { 'data.json': legacy(3, [{ id: 1 }]) })
    expect(await inspector().inspect(zip)).toMatchObject({
      hasReceipts: false,
      needsConfirmation: true
    })
    const json = join(dir, 'v1.json')
    writeFileSync(json, legacy(1))
    expect(await inspector().inspect(json)).toMatchObject({
      schemaVersion: 1,
      hasReceipts: false,
      needsConfirmation: true
    })
  })

  it('データベースを読めない場合(起動エラー画面など)は、現在の件数を0として扱う', async () => {
    const path = join(dir, 'a.zip')
    buildZip(path, { 'manifest.json': manifest(5, 0) })
    expect(await inspector(null).inspect(path)).toMatchObject({
      currentReceiptCount: 0,
      currentProjectCount: 0,
      needsConfirmation: false
    })
  })

  it('現行より新しい版は、専用のエラー', async () => {
    const path = join(dir, 'new.zip')
    buildZip(path, { 'manifest.json': manifest(99, 0) })
    await expect(inspector().inspect(path)).rejects.toBeInstanceOf(BackupVersionTooNewError)
    const json = join(dir, 'new.json')
    writeFileSync(json, legacy(99))
    await expect(inspector().inspect(json)).rejects.toBeInstanceOf(BackupVersionTooNewError)
  })

  it('ファイルサイズが上限を超える場合は、容量超過のエラー', async () => {
    const path = join(dir, 'big.zip')
    buildZip(path, { 'manifest.json': manifest(5, 0) })
    await expect(
      inspector(db, { ...LIMITS, maxFileBytes: 10 }).inspect(path)
    ).rejects.toBeInstanceOf(BackupSizeLimitError)
  })

  it('形式不正(manifestの不正・JSONでない・data.jsonが無い・ZIPが壊れている)は解析エラー', async () => {
    const bad = join(dir, 'bad.zip')
    buildZip(bad, { 'manifest.json': '{"format":"other"}' })
    await expect(inspector().inspect(bad)).rejects.toBeInstanceOf(BackupParseError)

    const notJson = join(dir, 'nj.json')
    writeFileSync(notJson, '{ 壊れた')
    await expect(inspector().inspect(notJson)).rejects.toBeInstanceOf(BackupParseError)

    const invalid = join(dir, 'inv.json')
    writeFileSync(invalid, '{"a":1}')
    await expect(inspector().inspect(invalid)).rejects.toBeInstanceOf(BackupParseError)

    const broken = join(dir, 'broken.zip')
    writeFileSync(broken, 'PK壊れたZIP')
    await expect(inspector().inspect(broken)).rejects.toBeInstanceOf(BackupParseError)
  })

  it('エントリ数が上限を超えるZIPは解析エラー', async () => {
    const path = join(dir, 'many.zip')
    buildZip(path, { 'manifest.json': manifest(5, 0), 'documents/a.pdf': 'x' })
    await expect(inspector(db, { ...LIMITS, maxEntries: 1 }).inspect(path)).rejects.toBeInstanceOf(
      BackupParseError
    )
  })
})
