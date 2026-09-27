import { test, expect, _electron as electron } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evidenceDir } from './evidence-dir'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const MAIN_ENTRY = join(__dirname, '..', '..', 'out', 'main', 'index.js')

/**
 * 【tester作成】F-01(アプリ起動・基本画面)の異常系シナリオ:
 * データベースファイルが破損している場合に、起動エラー画面が表示されることを確認する。
 * 参照元: 詳細設計書 4.1章手順5、8章(エラーハンドリング設計)
 * 観点: 異常系
 *
 * 開発者のE2E(e2e/tests)・単体テストのいずれも起動時のDB破損ケースを実機のElectron起動で
 * 検証していないため(README5.1章では起動エラー画面のロジックはユニットテストの範囲外)、
 * データ保存先ディレクトリに不正な内容の`data.sqlite`を事前配置してからアプリを起動し、
 * 実際に起動エラー画面が表示されることを確認する。
 */

const EVIDENCE_DIR = evidenceDir('TC-02_startup-error')

test.describe('F-01: データベース破損時の起動エラー画面(TC-02)', () => {
  test('データベースファイルが破損している場合、起動エラー画面が表示される', async () => {
    mkdirSync(EVIDENCE_DIR, { recursive: true })
    const dataDir = mkdtempSync(join(tmpdir(), 'jimuhub-scenario-startup-'))

    // 有効なSQLiteファイルではない内容を、データベースファイルとして事前に配置しておく
    writeFileSync(join(dataDir, 'data.sqlite'), 'これは正しいSQLiteファイルではありません', 'utf-8')

    const app = await electron.launch({
      args: [MAIN_ENTRY],
      env: {
        ...process.env,
        JIMUHUB_DATA_DIR: dataDir,
        JIMUHUB_WINDOW_SHOW: '0'
      }
    })

    try {
      // 期待結果(詳細設計書4.1章手順5): データベースファイル破損時は起動エラー画面が表示される。
      // 実際の結果は下記のとおり不具合TC-02-aとして報告書に記録する(このassertは意図的に失敗させ、
      // 実施結果「不合格」の再現エビデンスとする)。
      const window = await app.firstWindow({ timeout: 10_000 })
      await expect(
        window.getByText(
          'データを読み込めませんでした。ファイルが破損している可能性があります。エクスポートファイルからの復元をお試しください'
        )
      ).toBeVisible()
      await window.screenshot({ path: `${EVIDENCE_DIR}/01_startup_error.png` })
    } finally {
      await app.close().catch(() => {})
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})
