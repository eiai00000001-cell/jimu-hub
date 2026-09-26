import { defineConfig } from '@playwright/test'

/**
 * E2E設定(Electronアプリの実機起動テスト)。
 * 対象環境: ローカルの開発用ビルドのみ。本番環境・本番データへは一切接続しない。
 *
 * 実行方法:
 *   npm run test:e2e          … 通常実行(ウィンドウを表示しない・高速)
 *   npm run test:e2e:headed   … 見るだけ実行(ウィンドウを表示し、ゆっくり動かす)
 */
export default defineConfig({
  testDir: './e2e/tests',
  timeout: 60_000,
  retries: 0,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  outputDir: './e2e/.output'
})
