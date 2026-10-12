import { createWriteStream, rmSync, statSync, type WriteStream } from 'node:fs'
import { ZipArchive } from 'archiver'

/**
 * `archiver`のラッパー。ZIPを、作業用ファイル(`.partial`)へストリームで書き出す。
 * ファイルは1件ずつ、パスと名前だけを待ち行列に積み、中身は読み込みながら書き出す(F-32。詳細設計書4.2章手順6)。
 * 書き込み先が遅い間は`archiver`が読み込みを止める(バックプレッシャー)ため、メモリは増えない。
 */
export class BackupArchiveWriter {
  private readonly archive: ZipArchive
  private readonly output: WriteStream
  private readonly closed: Promise<void>
  private failure: Error | null = null

  constructor(
    private readonly partialPath: string,
    onEntry?: (entryName: string) => void
  ) {
    this.archive = new ZipArchive({ zlib: { level: 6 } })
    const output = createWriteStream(partialPath)
    this.output = output
    this.closed = new Promise<void>((resolve, reject) => {
      output.on('close', resolve)
      output.on('error', reject)
      this.archive.on('error', (error) => {
        this.failure = error
        reject(error)
      })
      // 実ファイルが読めない(ENOENT等)場合は、壊れたZIPを作らないよう失敗として扱う
      this.archive.on('warning', (error) => {
        this.failure = error
        reject(error)
      })
    })
    // 失敗が呼び出し側で拾われる前の未処理拒否を防ぐ(finalize()で必ず待つ)
    this.closed.catch(() => undefined)
    this.archive.on('entry', (entry) => onEntry?.(entry.name))
    this.archive.pipe(output)
  }

  addFile(absolutePath: string, entryName: string): void {
    this.archive.file(absolutePath, { name: entryName })
  }

  /** 全ファイルの追加後に呼び出し、書き込みの完了を待つ。作業用ファイルの実サイズ(バイト)を返す */
  async finalize(): Promise<number> {
    await this.archive.finalize()
    await this.closed
    if (this.failure) throw this.failure
    return statSync(this.partialPath).size
  }

  /** 書き込みを中断し、作業用ファイルを削除する(失敗時・利用者の中断時)。出力ストリームが閉じてから削除する */
  async abort(): Promise<void> {
    this.archive.abort()
    if (!this.output.closed) {
      await new Promise<void>((resolve) => {
        this.output.once('close', resolve)
        this.output.destroy()
      })
    }
    rmSync(this.partialPath, { force: true })
  }
}
