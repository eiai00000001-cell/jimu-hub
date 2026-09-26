import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const MAIN_ENTRY = join(__dirname, '..', '..', 'out', 'main', 'index.js')

export interface LaunchedApp {
  app: ElectronApplication
  window: Page
  /** テスト専用の一時データ保存先。本番のデータには一切影響しない */
  dataDir: string
}

/**
 * E2Eテスト用にアプリを起動するヘルパー。
 *
 * - データ保存先は毎回新規のテスト専用一時ディレクトリ(`JIMUHUB_DATA_DIR`)に切り替えるため、
 *   本番環境のデータベースファイルには一切触れない。
 * - `npm run test:e2e:headed`(環境変数 `E2E_HEADED=1`)で実行した場合のみ、
 *   ウィンドウを表示し、操作をゆっくり(`slowMo`)再生する「見るだけ実行」になる。
 * - 事前に `npm run build`(electron-vite build)でアプリをビルドしておく必要がある
 *   (`npm run test:e2e` / `test:e2e:headed` はビルドを自動実行してから起動する)。
 */
export async function launchApp(extraEnv: Record<string, string> = {}): Promise<LaunchedApp> {
  const dataDir = mkdtempSync(join(tmpdir(), 'jimuhub-e2e-'))
  const headed = process.env.E2E_HEADED === '1'

  const app = await electron.launch({
    args: [MAIN_ENTRY],
    env: {
      ...process.env,
      JIMUHUB_DATA_DIR: dataDir,
      JIMUHUB_WINDOW_SHOW: headed ? '1' : '0',
      ...extraEnv
    },
    slowMo: headed ? 400 : 0
  })

  const window = await app.firstWindow()
  return { app, window, dataDir }
}

export async function closeApp(launched: LaunchedApp): Promise<void> {
  await launched.app.close()
  rmSync(launched.dataDir, { recursive: true, force: true })
}
