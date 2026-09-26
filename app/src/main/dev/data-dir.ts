import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * データ保存先ディレクトリを解決する。
 * 通常はmacOSの標準的なアプリケーションサポートディレクトリ(基本設計書3章)を用いる。
 * `JIMUHUB_DATA_DIR`環境変数が設定されている場合はそれを優先する
 * (開発時のサンプルデータ投入・E2Eテストでの隔離に使用。本番環境には一切影響しない)。
 */
export function resolveUserDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.JIMUHUB_DATA_DIR ?? join(homedir(), 'Library', 'Application Support', '事務HUB')
}
