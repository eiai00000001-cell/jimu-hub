import { test, expect } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/electron-app'

/**
 * F-02(データエクスポート)〜F-03(データ復元)の画面をまたぐ操作フローを、実際のアプリを起動して確認する。
 * 参照元: 詳細設計書 4.2章・4.3章
 *
 * OS標準の保存先選択・ファイル選択ダイアログはPlaywrightから直接操作できないため、
 * E2Eテスト専用の環境変数(JIMUHUB_E2E_EXPORT_PATH/JIMUHUB_E2E_IMPORT_PATH)でパスを指定し、
 * ダイアログ表示そのものを省略する(本番動作時はこれらの環境変数は設定されないため通常どおりダイアログが表示される)。
 */
test.describe('データ管理: エクスポートしてから復元する', () => {
  let launched: LaunchedApp
  let workDir: string
  let backupFilePath: string

  test.beforeEach(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'jimuhub-e2e-backup-'))
    backupFilePath = join(workDir, 'export.json')
    launched = await launchApp({
      JIMUHUB_E2E_EXPORT_PATH: backupFilePath,
      JIMUHUB_E2E_IMPORT_PATH: backupFilePath
    })
  })

  test.afterEach(async () => {
    await closeApp(launched)
    rmSync(workDir, { recursive: true, force: true })
  })

  test('エクスポートしたファイルを復元すると、登録済みの取引先が維持される', async () => {
    const { window } = launched

    await window.getByRole('button', { name: '取引先管理' }).click()
    await window.getByRole('button', { name: '+ 新規登録' }).click()
    await window.getByLabel('取引先名称').fill('バックアップ確認用商事株式会社')
    await window.getByRole('button', { name: '登録', exact: true }).click()
    await expect(window.getByText('取引先を登録しました')).toBeVisible()

    await window.getByRole('button', { name: 'ホーム' }).click()
    await expect(window.getByText('1件')).toBeVisible()

    await window.getByRole('button', { name: 'データをエクスポート' }).click()
    await window.getByRole('button', { name: 'エクスポート実行' }).click()
    await expect(window.getByText(/保存しました/)).toBeVisible()
    await window.getByLabel('閉じる').click()

    await window.getByRole('button', { name: 'データを復元' }).click()
    await window.getByRole('button', { name: 'ファイルを選択して復元' }).click()
    await expect(window.getByText('復元が完了しました(1件)')).toBeVisible()

    await window.getByLabel('閉じる').click()
    await window.getByRole('button', { name: '取引先管理' }).click()
    await expect(window.getByRole('cell', { name: 'バックアップ確認用商事株式会社' })).toBeVisible()
  })
})
