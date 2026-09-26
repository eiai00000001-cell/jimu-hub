import { test, expect } from '@playwright/test'
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/electron-app'

/**
 * F-04(取引先登録)〜F-05(取引先一覧)の画面をまたぐ操作フローを、実際のアプリを起動して確認する。
 * 参照元: 詳細設計書 4.4章・4.5章
 */
test.describe('取引先管理: 登録した内容が一覧へ反映される', () => {
  let launched: LaunchedApp

  test.beforeEach(async () => {
    launched = await launchApp()
  })

  test.afterEach(async () => {
    await closeApp(launched)
  })

  test('取引先を新規登録すると、一覧に反映され完了メッセージが表示される', async () => {
    const { window } = launched

    await window.getByRole('button', { name: '取引先管理' }).click()
    await expect(window.getByText('該当する取引先がありません')).toBeVisible()

    await window.getByRole('button', { name: '+ 新規登録' }).click()
    await window.getByLabel('取引先名称').fill('E2Eテスト商事株式会社')
    await window.getByRole('button', { name: '登録', exact: true }).click()

    await expect(window.getByText('取引先を登録しました')).toBeVisible()
    await expect(window.getByRole('cell', { name: 'E2Eテスト商事株式会社' })).toBeVisible()

    // 詳細画面まで一貫して反映されていることも確認する
    await window.getByText('E2Eテスト商事株式会社').click()
    await expect(window.getByText('取引先ID')).toBeVisible()
    await expect(window.getByRole('definition').first()).toBeVisible()
  })
})
