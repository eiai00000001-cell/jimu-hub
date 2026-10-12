import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/**
 * エクスポート・復元で使う一時フォルダ(`<userData>/tmp/<prefix>-<日時>/`。権限700)の作成と削除。
 * 参照元: 詳細設計書4.2章手順4・7、4.3章手順3(2)・8、4.32章
 */
export class BackupStagingArea {
  constructor(private readonly tmpRoot: string) {}

  /** 一時フォルダを新規作成して絶対パスを返す(`prefix`は`export`または`restore`) */
  create(prefix: 'export' | 'restore'): string {
    mkdirSync(this.tmpRoot, { recursive: true, mode: 0o700 })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    let dir = join(this.tmpRoot, `${prefix}-${stamp}`)
    for (let n = 1; existsSync(dir); n += 1) {
      dir = join(this.tmpRoot, `${prefix}-${stamp}-${n}`)
    }
    mkdirSync(dir, { mode: 0o700 })
    // umaskの影響を受けないよう、権限を明示する
    chmodSync(dir, 0o700)
    return dir
  }

  /** 一時フォルダを削除する(存在しなくてもエラーにしない) */
  remove(dir: string): void {
    rmSync(dir, { recursive: true, force: true })
  }

  /** 異常終了で残った一時フォルダ(`export-*`・`restore-*`)を全て削除する(起動時。詳細設計書4.1章手順0-2) */
  removeLeftovers(): void {
    if (!existsSync(this.tmpRoot)) return
    for (const name of readdirSync(this.tmpRoot)) {
      if (name.startsWith('export-') || name.startsWith('restore-')) {
        rmSync(join(this.tmpRoot, name), { recursive: true, force: true })
      }
    }
  }
}
