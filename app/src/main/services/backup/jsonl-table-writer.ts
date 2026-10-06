import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import type SqliteDatabase from 'better-sqlite3'
import type { BackupRow } from '@shared/backup/backup-file'
import { readRowsPage, type BackupTableEntry } from '../backup-tables'

/** 1回に読み出すレコード数(詳細設計書4.2章手順4) */
export const JSONL_PAGE_SIZE = 500

/** `data/<名前>.jsonl`を書き出すファイルの相対パス */
export function jsonlEntryName(tableName: string): string {
  return `data/${tableName}.jsonl`
}

/**
 * DBのテーブルを、1行1レコードのJSON(JSON Lines。UTF-8・LF)として一時フォルダへ書き出す。
 * 主キーの昇順に500件ずつ読み出し、全件を配列に保持しない(F-32。詳細設計書4.2章手順4)。
 */
export class JsonlTableWriter {
  constructor(
    private readonly sqlite: SqliteDatabase.Database,
    private readonly pageSize: number = JSONL_PAGE_SIZE
  ) {}

  /**
   * @param mapRow 書き出す前にレコードを加工する(PDFパスを相対パスへ変換する等)
   * @returns 書き出したレコード数
   */
  writeTable(
    entry: BackupTableEntry,
    dir: string,
    mapRow: (row: BackupRow) => BackupRow = (row) => row
  ): number {
    mkdirSync(join(dir, 'data'), { recursive: true })
    const fd = openSync(join(dir, jsonlEntryName(entry.name)), 'w', 0o600)
    let count = 0
    try {
      let afterId = 0
      for (;;) {
        const rows = readRowsPage(this.sqlite, entry.def, afterId, this.pageSize)
        if (rows.length === 0) break
        // JSON.stringifyは改行をエスケープするため、1レコードは必ず1行になる
        const text = rows.map((row) => `${JSON.stringify(mapRow(row))}\n`).join('')
        writeSync(fd, text)
        count += rows.length
        afterId = Number(rows[rows.length - 1]?.id)
      }
    } finally {
      closeSync(fd)
    }
    return count
  }
}
