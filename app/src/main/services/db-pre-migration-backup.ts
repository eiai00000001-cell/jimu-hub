import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Database } from '../db/db'

const PREFIX = 'pre-migration_v'
const SUFFIX = '.sqlite'
/** 保持する世代数(復元前の退避とは別。詳細設計書4.1章手順0-3) */
const MAX_GENERATIONS = 3

/**
 * データベースの移行(スキーマバージョンの引き上げ)の前に、現在のデータベースを退避する。
 * `VACUUM INTO`により、開いたまま整合の取れたコピーを作る。
 * 参照元: 詳細設計書4.1章手順0-3、6.17章、5章(`DbPreMigrationBackup`)
 */
export class DbPreMigrationBackup {
  constructor(
    private readonly backupsDir: string,
    private readonly now: () => Date = () => new Date()
  ) {}

  /**
   * @param fromVersion 移行前の`schema_version`
   * @returns 退避ファイルのパス
   * @throws 退避に失敗した場合(空き容量不足・権限不足等)
   */
  create(database: Database, fromVersion: number): string {
    mkdirSync(this.backupsDir, { recursive: true })
    const stamp = this.now().toISOString().replace(/[:.]/g, '-')
    let path = join(this.backupsDir, `${PREFIX}${fromVersion}_${stamp}${SUFFIX}`)
    for (let n = 1; existsSync(path); n += 1) {
      path = join(this.backupsDir, `${PREFIX}${fromVersion}_${stamp}-${n}${SUFFIX}`)
    }
    try {
      database.sqlite.prepare('VACUUM INTO ?').run(path)
    } catch (error) {
      // 途中まで書かれたファイルを残さない
      rmSync(path, { force: true })
      throw error
    }
    this.prune()
    return path
  }

  /** 新しい順に3世代のみ残す(日時順。ファイル名の日時部分で比較する) */
  private prune(): void {
    const stampOf = (name: string): string => name.slice(name.indexOf('_', PREFIX.length) + 1)
    const files = readdirSync(this.backupsDir)
      .filter((name) => name.startsWith(PREFIX) && name.endsWith(SUFFIX))
      .sort((a, b) => stampOf(a).localeCompare(stampOf(b)))
    for (const name of files.slice(0, Math.max(0, files.length - MAX_GENERATIONS))) {
      rmSync(join(this.backupsDir, name), { force: true })
    }
  }
}
