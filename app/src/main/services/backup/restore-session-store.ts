import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import { BackupFileChangedError } from './errors'

/** 事前確認の識別子の有効期間(30分。詳細設計書4.3章手順2) */
export const RESTORE_SESSION_TTL_MS = 30 * 60 * 1000

interface Session {
  filePath: string
  size: number
  mtimeMs: number
  expiresAt: number
}

/**
 * 事前確認(`inspect`)したファイルを、識別子(token)でMainのメモリ上に保持する。
 * Rendererからファイルのパスを渡さず、識別子のみを受け取る(`ReceiptStagingStore`と同じ考え方)。
 * 復元の実行前に、ファイルのサイズ・更新日時が確認時と同じであることを再確認する。
 */
export class RestoreSessionStore {
  private readonly sessions = new Map<string, Session>()

  constructor(private readonly now: () => number = Date.now) {}

  register(filePath: string): string {
    this.purgeExpired()
    const stat = statSync(filePath)
    const token = randomUUID()
    this.sessions.set(token, {
      filePath,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      expiresAt: this.now() + RESTORE_SESSION_TTL_MS
    })
    return token
  }

  /**
   * 識別子に対応するファイルのパスを返す。識別子が無効(未登録・期限切れ)、またはファイルが
   * 確認時から変更された場合は`BackupFileChangedError`を投げる。
   */
  resolve(token: string): string {
    const session = this.sessions.get(token)
    if (!session || session.expiresAt < this.now()) {
      this.sessions.delete(token)
      throw new BackupFileChangedError('invalid or expired token')
    }
    try {
      const stat = statSync(session.filePath)
      if (stat.size !== session.size || stat.mtimeMs !== session.mtimeMs) {
        throw new BackupFileChangedError('file changed')
      }
    } catch (error) {
      if (error instanceof BackupFileChangedError) throw error
      throw new BackupFileChangedError('file not readable')
    }
    return session.filePath
  }

  discard(token: string): void {
    this.sessions.delete(token)
  }

  private purgeExpired(): void {
    const now = this.now()
    for (const [token, session] of this.sessions) {
      if (session.expiresAt < now) this.sessions.delete(token)
    }
  }
}
