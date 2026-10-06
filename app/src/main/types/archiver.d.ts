/**
 * `archiver` 8.0.0は型定義を同梱しないため、`BackupArchiveWriter`が使う範囲のみを宣言する。
 * (`@types/archiver`は旧版向けのため使用しない)
 */
declare module 'archiver' {
  import type { Transform } from 'node:stream'

  export interface ArchiverOptions {
    zlib?: { level?: number }
  }

  export interface EntryData {
    name: string
  }

  export interface ArchiverError extends Error {
    code?: string
  }

  export class ZipArchive extends Transform {
    constructor(options?: ArchiverOptions)
    /** ファイルをストリームとして追加する(中身は読み込みながら書き出す) */
    file(filePath: string, data: EntryData): this
    finalize(): Promise<void>
    abort(): this
    pointer(): number
    on(event: 'entry', listener: (entry: EntryData) => void): this
    on(event: 'warning' | 'error', listener: (error: ArchiverError) => void): this
    on(event: string, listener: (...args: never[]) => void): this
  }
}
