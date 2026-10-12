import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BackupRow } from '@shared/backup/backup-file'
import type { BackupTableEntry } from '../backup-tables'
import { BackupParseError } from './errors'
import { JsonlTableReader } from './jsonl-table-reader'
import { JsonlTableWriter } from './jsonl-table-writer'

const ITEMS: BackupTableEntry = {
  name: 'items',
  def: {
    table: 'items',
    orderBy: 'id',
    columns: [
      ['id', 'id'],
      ['label', 'label'],
      ['flag', 'flag', true]
    ]
  }
}

describe('JsonlTableWriter / JsonlTableReader(F-32)', () => {
  let dir: string
  let sqlite: Database.Database

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jsonl-test-'))
    sqlite = new Database(':memory:')
    sqlite.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT, flag INTEGER)')
  })
  afterEach(() => {
    sqlite.close()
    rmSync(dir, { recursive: true, force: true })
  })

  function insert(count: number, label = (i: number): string => `項目${i}`): void {
    const stmt = sqlite.prepare('INSERT INTO items (id, label, flag) VALUES (?, ?, ?)')
    for (let i = 1; i <= count; i += 1) stmt.run(i, label(i), i % 2)
  }

  it('500件を超えるレコードを、主キー順に1行1レコードで書き出し、読み込むと同じ内容に戻る', () => {
    insert(1234)
    // ページサイズ(500)を跨いでも、欠落・重複が無い
    const count = new JsonlTableWriter(sqlite).writeTable(ITEMS, dir)
    expect(count).toBe(1234)

    const text = readFileSync(join(dir, 'data/items.jsonl'), 'utf-8')
    expect(text.endsWith('\n')).toBe(true)
    expect(text.split('\n')).toHaveLength(1235)

    const records: BackupRow[] = []
    expect(
      new JsonlTableReader().readSync(join(dir, 'data/items.jsonl'), (r) => records.push(r))
    ).toBe(1234)
    expect(records.map((r) => r.id)).toEqual(Array.from({ length: 1234 }, (_, i) => i + 1))
    expect(records[0]).toEqual({ id: 1, label: '項目1', flag: true })
  })

  it('レコードが0件でも空のファイルを作る', () => {
    expect(new JsonlTableWriter(sqlite).writeTable(ITEMS, dir)).toBe(0)
    expect(readFileSync(join(dir, 'data/items.jsonl'), 'utf-8')).toBe('')
  })

  it('改行を含む文字列は、エスケープされて1行に収まる', () => {
    sqlite.prepare('INSERT INTO items VALUES (1, ?, 0)').run('a\nb\r\nc')
    new JsonlTableWriter(sqlite).writeTable(ITEMS, dir)
    expect(readFileSync(join(dir, 'data/items.jsonl'), 'utf-8').split('\n')).toHaveLength(2)
    const records: BackupRow[] = []
    new JsonlTableReader().readSync(join(dir, 'data/items.jsonl'), (r) => records.push(r))
    expect(records[0]?.label).toBe('a\nb\r\nc')
  })

  it('mapRowで書き出し前にレコードを加工できる', () => {
    insert(2)
    new JsonlTableWriter(sqlite).writeTable(ITEMS, dir, (row) => ({ ...row, label: 'X' }))
    const records: BackupRow[] = []
    new JsonlTableReader().readSync(join(dir, 'data/items.jsonl'), (r) => records.push(r))
    expect(records.map((r) => r.label)).toEqual(['X', 'X'])
  })

  it('64KiBの区切りを跨ぐマルチバイト文字・長い行も正しく読み込む', () => {
    // 1行が64KiBを超え、区切りがマルチバイト文字の途中になる
    insert(5, (i) => 'あ'.repeat(30_000 + i))
    new JsonlTableWriter(sqlite).writeTable(ITEMS, dir)
    const labels: string[] = []
    new JsonlTableReader().readSync(join(dir, 'data/items.jsonl'), (r) =>
      labels.push(String(r.label))
    )
    expect(labels).toEqual([1, 2, 3, 4, 5].map((i) => 'あ'.repeat(30_000 + i)))
  })

  it('末尾に改行が無くても最後の行を読み込み、空行は読み飛ばす', () => {
    const path = join(dir, 'a.jsonl')
    writeFileSync(path, '{"id":1}\n\n{"id":2}')
    const ids: unknown[] = []
    new JsonlTableReader().readSync(path, (r) => ids.push(r.id))
    expect(ids).toEqual([1, 2])
  })

  it('1行の上限を超えた場合は解析エラーにする', () => {
    const path = join(dir, 'long.jsonl')
    writeFileSync(path, `{"label":"${'a'.repeat(200)}"}\n`)
    expect(() => new JsonlTableReader(100).readSync(path, () => undefined)).toThrow(
      BackupParseError
    )
    // 改行が来ないまま上限を超える場合も同様
    writeFileSync(path, `{"label":"${'a'.repeat(200)}"`)
    expect(() => new JsonlTableReader(100).readSync(path, () => undefined)).toThrow(
      BackupParseError
    )
  })

  it('JSONでない行・オブジェクトでない行は解析エラーにする', () => {
    const path = join(dir, 'bad.jsonl')
    writeFileSync(path, '{not json}\n')
    expect(() => new JsonlTableReader().readSync(path, () => undefined)).toThrow(BackupParseError)
    writeFileSync(path, '[1,2]\n')
    expect(() => new JsonlTableReader().readSync(path, () => undefined)).toThrow(BackupParseError)
    writeFileSync(path, '5\n')
    expect(() => new JsonlTableReader().readSync(path, () => undefined)).toThrow(BackupParseError)
  })
})
