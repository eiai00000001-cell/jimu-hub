import { test, expect } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/electron-app'

/**
 * イテレーション3の通し確認(スモーク): 案件の登録 → 経費の登録(案件つき) → 案件詳細で紐づけを確認
 * → 案件を変更(解除)して履歴を確認 → エクスポート → 復元で案件・履歴が維持される。
 * シナリオの設計・合否判定はtesterの担当で、本ファイルは基盤の動作確認用。
 * 参照元: 詳細設計書 3.22〜3.26章・4.27〜4.30章
 *
 * OS標準ダイアログはPlaywrightから操作できないため、E2Eテスト専用の環境変数
 * (JIMUHUB_E2E_EXPORT_PATH/JIMUHUB_E2E_IMPORT_PATH)でパスを指定し、ダイアログ表示を省略する。
 */
test.describe('案件管理: 通し確認', () => {
  let launched: LaunchedApp
  let workDir: string

  test.beforeEach(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'jimuhub-e2e-projects-'))
    launched = await launchApp({
      JIMUHUB_E2E_EXPORT_PATH: join(workDir, 'backup.zip'),
      JIMUHUB_E2E_IMPORT_PATH: join(workDir, 'backup.zip')
    })
  })

  test.afterEach(async () => {
    await closeApp(launched)
    rmSync(workDir, { recursive: true, force: true })
  })

  test('案件の登録→経費の紐づけ→付け替え履歴→エクスポート・復元', async () => {
    const { window } = launched

    // 案件の登録
    await window.getByRole('button', { name: '案件管理' }).click()
    await expect(window.getByText('該当する案件がありません')).toBeVisible()
    await window.getByRole('button', { name: '+ 案件を登録' }).click()
    await window.getByLabel('案件名').fill('Webサイト制作')
    await window.getByRole('button', { name: '登録', exact: true }).click()
    await expect(window.getByText('案件を保存しました')).toBeVisible()
    await expect(window.getByText('Webサイト制作', { exact: true }).first()).toBeVisible()

    // 経費の登録(案件つき)
    await window.getByRole('button', { name: '入出金・経費' }).click()
    await window.getByRole('button', { name: '+ 経費を登録' }).click()
    await window.getByLabel(/金額/).fill('5,500')
    await window.getByLabel(/勘定科目/).selectOption({ label: '通信費' })
    await window.getByLabel(/摘要・メモ/).fill('案件の通信費')
    await window.getByLabel('税区分').selectOption('standard_10')
    await window.getByLabel('案件').selectOption({ label: 'Webサイト制作' })
    await window.getByRole('button', { name: '登録', exact: true }).click()
    await expect(window.getByText('記録を登録しました')).toBeVisible()

    // 記録の詳細から案件詳細へ。紐づく入出金・経費に表示される
    await window.getByRole('button', { name: 'Webサイト制作' }).click()
    await expect(window.getByText('紐づく入出金・経費')).toBeVisible()
    await expect(window.getByRole('cell', { name: '案件の通信費', exact: true })).toBeVisible()
    await expect(window.getByRole('button', { name: '削除' })).toHaveCount(0)
    // 案件別収支: 経費5,500円、売上0円、差引−5,500円(売上は発行済みの請求書のみ)
    await expect(window.getByText('案件別収支')).toBeVisible()
    await expect(window.locator('.summary-card .value').nth(1)).toHaveText('¥5,500')
    await expect(window.locator('.summary-card .value').nth(2)).toHaveText('−¥5,500')
    await expect(
      window.getByText('売上は、発行済みの請求書の金額(源泉徴収前)です。入金額は含みません。')
    ).toBeVisible()

    // 案件を変更(解除)すると、紐づく行が消え、付け替え履歴に残る
    await window.getByRole('button', { name: '案件を変更' }).click()
    await window.getByLabel('変更先の案件').selectOption({ label: '案件なし' })
    await window.getByRole('button', { name: '変更する' }).click()
    await expect(window.getByText('紐づく入出金・経費はありません')).toBeVisible()
    await expect(window.locator('.summary-card .value').nth(1)).toHaveText('¥0')
    await expect(window.getByRole('cell', { name: /^入出金 .* 案件の通信費$/ })).toHaveCount(2)
    await expect(window.getByText('解除')).toBeVisible()
    // 紐づけが0件になったため、削除できる
    await expect(window.getByRole('button', { name: '削除' })).toBeVisible()

    // エクスポート → 復元で、案件と履歴が維持される
    await window.getByRole('button', { name: 'ホーム' }).click()
    await window.getByRole('button', { name: 'データをエクスポート' }).click()
    await window.getByRole('button', { name: 'エクスポート実行' }).click()
    await expect(window.getByText(/保存しました/)).toBeVisible()
    await window.getByLabel('閉じる').click()

    await window.getByRole('button', { name: 'データを復元' }).click()
    await window.getByRole('button', { name: 'ファイルを選択して復元' }).click()
    await window.getByRole('button', { name: '続行' }).click()
    await expect(window.getByText(/復元が完了しました/)).toBeVisible()
    await window.getByLabel('閉じる').click()

    await window.getByRole('button', { name: '案件管理' }).click()
    await expect(window.getByRole('cell', { name: 'Webサイト制作' })).toBeVisible()
    await window.getByRole('cell', { name: 'Webサイト制作' }).click()
    await expect(window.getByText('解除')).toBeVisible()
  })
})
