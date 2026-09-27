import { defineConfig } from '@playwright/test'

/**
 * テストフェーズ(tester)専用の結合シナリオ設定。
 *
 * 位置づけ: developerが整備した e2e/tests(単体機能ごとのE2E、2件)とは別に、
 * tester が詳細設計書ベースの機能横断シナリオ(観点5: 機能横断・結合確認)を
 * 実機のElectronアプリで検証するために追加した補助スクリプト。
 * 既存の e2e/fixtures/electron-app.ts をそのまま再利用する。
 *
 * 実行方法(app/ フォルダ内で実行):
 *   npm run build                                        … 事前に一度だけビルド
 *   npx playwright test --config=e2e/scenarios/playwright.config.ts
 *   npx playwright test --config=e2e/scenarios/playwright.config.ts --headed   … 見るだけ実行
 *
 * 対象はローカルのテスト専用一時ディレクトリのみ。本番のデータベースファイルには一切影響しない
 * (e2e/fixtures/electron-app.ts と同様、JIMUHUB_DATA_DIR で隔離する)。
 */
export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  retries: 0,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  // 既存の e2e/.output(.gitignore対象)配下にまとめ、余分なディレクトリを増やさない
  outputDir: '../.output/scenarios'
})
