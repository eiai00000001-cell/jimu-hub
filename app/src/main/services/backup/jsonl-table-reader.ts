import { closeSync, openSync, readSync } from 'node:fs'
import type { BackupRow } from '@shared/backup/backup-file'
import { BackupParseError } from './errors'

const READ_CHUNK_BYTES = 64 * 1024
/** 1行の上限(超えた場合は解析エラー。詳細設計書4.3章手順6) */
export const DEFAULT_MAX_LINE_BYTES = 16 * 1024 * 1024

const LF = 0x0a

/**
 * JSON Linesを、64KiBずつ同期で読み込み、1行ずつ`JSON.parse`して渡す。
 * DBのトランザクション内(awaitを挟まない処理)から呼ぶため同期処理とし、全行を配列に保持しない。
 */
export class JsonlTableReader {
  constructor(private readonly maxLineBytes: number = DEFAULT_MAX_LINE_BYTES) {}

  /** @returns 読み込んだレコード数 */
  readSync(path: string, onRecord: (record: BackupRow) => void): number {
    const fd = openSync(path, 'r')
    const chunk = Buffer.allocUnsafe(READ_CHUNK_BYTES)
    // 改行まで読み切れていない行の断片(マルチバイト文字が分割されても壊れないようバイト列で保持する)
    let pending: Buffer[] = []
    let pendingBytes = 0
    let count = 0

    const emit = (line: Buffer): void => {
      if (line.length === 0) return
      let value: unknown
      try {
        value = JSON.parse(line.toString('utf-8'))
      } catch {
        throw new BackupParseError('invalid jsonl line')
      }
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new BackupParseError('jsonl line is not an object')
      }
      onRecord(value as BackupRow)
      count += 1
    }
    const guard = (bytes: number): void => {
      if (bytes > this.maxLineBytes) throw new BackupParseError('jsonl line too long')
    }

    try {
      for (;;) {
        const read = readSync(fd, chunk, 0, READ_CHUNK_BYTES, null)
        if (read === 0) break
        let start = 0
        for (;;) {
          const lf = chunk.indexOf(LF, start)
          if (lf === -1 || lf >= read) break
          const part = chunk.subarray(start, lf)
          guard(pendingBytes + part.length)
          emit(pending.length > 0 ? Buffer.concat([...pending, part]) : Buffer.from(part))
          pending = []
          pendingBytes = 0
          start = lf + 1
        }
        if (start < read) {
          const rest = Buffer.from(chunk.subarray(start, read))
          pendingBytes += rest.length
          guard(pendingBytes)
          pending.push(rest)
        }
      }
      if (pendingBytes > 0) emit(Buffer.concat(pending))
    } finally {
      closeSync(fd)
    }
    return count
  }
}
