import { test, expect } from '@playwright/test'
import { rmSync } from 'node:fs'
import { createWorkDir } from '../../test-support/work-dir.mjs'
import { join } from 'node:path'
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/electron-app'

/**
 * イテレーション4の通し確認(スモーク): 案件の登録 → タスクの登録(案件つき・期限超過) → 一覧で期限超過の表示
 * → 完了にする → 案件詳細に紐づくタスク → エクスポート・復元でタスクが維持される
 * → 案件の削除で、タスクが削除されず「案件なし」に戻る。
 * シナリオの設計・合否判定はtesterの担当で、本ファイルは基盤の動作確認用。
 * 参照元: 詳細設計書 3.27〜3.29章・4.27章・4.34〜4.39章
 */
test.describe('タスク・期限管理: 通し確認', () => {
  let launched: LaunchedApp
  let workDir: string

  test.beforeEach(async () => {
    workDir = createWorkDir('e2e', 'jimuhub-e2e-tasks')
    launched = await launchApp({
      JIMUHUB_E2E_EXPORT_PATH: join(workDir, 'backup.zip'),
      JIMUHUB_E2E_IMPORT_PATH: join(workDir, 'backup.zip')
    })
  })

  test.afterEach(async () => {
    await closeApp(launched)
    rmSync(workDir, { recursive: true, force: true })
  })

  test('登録→期限超過の表示→完了→案件詳細→エクスポート・復元→案件の削除で案件なしに戻る', async () => {
    const { window } = launched
    window.on('dialog', (dialog) => void dialog.accept())

    // 案件の登録
    await window.getByRole('button', { name: '案件管理' }).click()
    await window.getByRole('button', { name: '+ 案件を登録' }).click()
    await window.getByLabel('案件名').fill('Webサイト制作')
    await window.getByRole('button', { name: '登録', exact: true }).click()
    await expect(window.getByText('案件を保存しました')).toBeVisible()

    // タスクの登録(期限超過のもの・案件つき、期限なし・案件なし)
    await window.getByRole('button', { name: 'タスク・期限' }).click()
    await expect(window.getByText('該当するタスクはありません')).toBeVisible()
    await window.getByRole('button', { name: '+ タスクを登録' }).click()
    await window.getByLabel('タスク名').fill('請求書の送付準備')
    await window.getByLabel('期限日').fill('2020-01-31')
    await window.getByLabel('案件').selectOption({ label: 'Webサイト制作' })
    await window.getByRole('button', { name: '登録', exact: true }).click()
    await expect(window.getByRole('heading', { name: 'タスク詳細' })).toBeVisible()
    await expect(window.getByText('期限超過')).toBeVisible()

    await window.getByRole('button', { name: /一覧へ戻る/ }).click()
    await window.getByRole('button', { name: '+ タスクを登録' }).click()
    await window.getByLabel('タスク名').fill('備品の発注')
    await window.getByRole('button', { name: '登録', exact: true }).click()
    await expect(window.getByRole('heading', { name: 'タスク詳細' })).toBeVisible()
    await window.getByRole('button', { name: /一覧へ戻る/ }).click()

    // 一覧: 期限超過の強調と件数(未完了2件・期限超過1件)
    await expect(window.getByText('該当 2件')).toBeVisible()
    const overdueRow = window.getByRole('row', { name: /請求書の送付準備/ })
    await expect(overdueRow).toHaveClass(/overdue/)
    await expect(overdueRow.getByText('期限超過')).toBeVisible()
    await expect(window.locator('.task-count').nth(0)).toContainText('2')
    await expect(window.locator('.task-count').nth(1)).toContainText('1')
    await expect(window.locator('.task-count').nth(1)).toHaveClass(/alert/)

    // 完了にする(確認なし)。未完了は1件になり、期限超過は0件で強調されない
    await overdueRow.getByRole('button', { name: '完了にする' }).click()
    await expect(window.getByText('該当 1件')).toBeVisible()
    await expect(window.locator('.task-count').nth(1)).not.toHaveClass(/alert/)
    await window.getByLabel('状態', { exact: true }).selectOption('all')
    await expect(window.getByText('該当 2件')).toBeVisible()
    await expect(
      window
        .getByRole('row', { name: /請求書の送付準備/ })
        .getByRole('button', { name: '未完了に戻す' })
    ).toBeVisible()

    // 案件詳細: 紐づくタスク(完了のタスクも表示)。削除ボタンは、紐づく書類・記録が無いため表示される
    await window.getByRole('button', { name: '案件管理' }).click()
    await window.getByRole('cell', { name: 'Webサイト制作' }).click()
    await expect(window.getByText('紐づくタスク', { exact: true })).toBeVisible()
    await expect(window.getByRole('button', { name: '請求書の送付準備' })).toBeVisible()
    await expect(window.getByRole('button', { name: '削除' })).toBeVisible()

    // エクスポート → 復元で、タスクが維持される
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
    await window.getByRole('button', { name: 'タスク・期限' }).click()
    await window.getByLabel('状態', { exact: true }).selectOption('all')
    await expect(window.getByText('該当 2件')).toBeVisible()

    // 案件の削除(確認のうえ)。タスクは削除されず「案件なし」に戻る
    await window.getByRole('button', { name: '案件管理' }).click()
    await window.getByRole('cell', { name: 'Webサイト制作' }).click()
    await window.getByRole('button', { name: '削除' }).click()
    await expect(window.getByText('案件を削除しました')).toBeVisible()
    await window.getByRole('button', { name: 'タスク・期限' }).click()
    await window.getByLabel('状態', { exact: true }).selectOption('all')
    await expect(window.getByText('該当 2件')).toBeVisible()
    const row = window.getByRole('row', { name: /請求書の送付準備/ })
    await expect(row.getByText('案件なし')).toBeVisible()
  })
})
