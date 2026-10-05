import { randomUUID } from 'node:crypto'

export const STAGING_TTL_MS = 30 * 60 * 1000

interface StagedFile {
  path: string
  fileName: string
  fileSize: number
  expiresAt: number
}

/**
 * 選択済みの領収書ファイルを、識別子(token)でメモリ上に保持する。Rendererにはパスを渡さない。
 * 保存の確定時または30分経過で破棄する(アプリ終了時はメモリごと消える)。
 * 参照元: 詳細設計書4.22章(`ReceiptStagingStore`)
 */
export class ReceiptStagingStore {
  private readonly files = new Map<string, StagedFile>()

  constructor(private readonly now: () => number = Date.now) {}

  register(file: { path: string; fileName: string; fileSize: number }): string {
    const token = randomUUID()
    this.files.set(token, { ...file, expiresAt: this.now() + STAGING_TTL_MS })
    return token
  }

  /** 有効な場合のみ返す。期限切れは破棄してnull */
  get(token: string): { path: string; fileName: string; fileSize: number } | null {
    const entry = this.files.get(token)
    if (!entry) return null
    if (entry.expiresAt <= this.now()) {
      this.files.delete(token)
      return null
    }
    return { path: entry.path, fileName: entry.fileName, fileSize: entry.fileSize }
  }

  discard(tokens: string[]): void {
    for (const token of tokens) this.files.delete(token)
  }
}
