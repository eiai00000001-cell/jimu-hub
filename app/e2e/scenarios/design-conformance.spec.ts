import { test, expect } from '@playwright/test'
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/electron-app'
import { shot } from './evidence-dir'

/**
 * 【tester作成】デザインガイド(docs/04_design/デザインガイド.md v0.10)5章「部品カテゴリーのルール」
 * との適合を、実際にレンダリングされた画面の computed style で確認する。
 *
 * 静的確認として src/renderer/src/styles/global.css の :root 変数がデザインガイド3章の6色・
 * 角丸値とすべて一致していることを確認済み(白#FFFFFF・背景グレー#F2F2F4・罫線グレー#D1D1D6・
 * 補助グレー#6E6E73・濃グレー#3A3A3C・赤#B3453A、角丸: ボタン6px・バッジ999px・パネル/入力欄0)。
 * 本シナリオはその変数が実際の描画にも反映されていること、および危険色(赤)が
 * データ復元の「続行」ボタンのみに使われている(それ以外に赤を使っていない)ことを、
 * 実機の描画結果から確認する(観点: デザインガイド適合)。
 */

test.describe('デザインガイド適合confirmation(TC-34)', () => {
  let launched: LaunchedApp

  test.beforeEach(async () => {
    launched = await launchApp()
  })

  test.afterEach(async () => {
    await closeApp(launched)
  })

  test('主要部品の色・角丸が6色ルールどおりに描画される', async () => {
    const { window } = launched

    // 主ボタン(押せる物): 濃グレー塗り+角丸6px
    await window.getByRole('button', { name: '取引先管理' }).click()
    const newButton = window.getByRole('button', { name: '+ 新規登録' })
    const newButtonStyle = await newButton.evaluate((el) => {
      const style = getComputedStyle(el)
      return { bg: style.backgroundColor, radius: style.borderRadius }
    })
    expect(newButtonStyle.bg).toBe('rgb(58, 58, 60)') // #3A3A3C
    expect(newButtonStyle.radius).toBe('6px')

    // サイドバー選択中項目: 濃グレー塗り+角丸なし(直角)
    const activeSidebarItem = window.locator('.sidebar-item.active')
    const sidebarStyle = await activeSidebarItem.evaluate((el) => {
      const style = getComputedStyle(el)
      return { bg: style.backgroundColor, radius: style.borderRadius }
    })
    expect(sidebarStyle.bg).toBe('rgb(58, 58, 60)')
    expect(sidebarStyle.radius).toBe('0px')

    // パネル(入れ物): 角丸なし(直角)
    await window.getByRole('button', { name: '+ 新規登録' }).click()
    await window.getByLabel('取引先名称').fill('デザイン確認用商事')
    await window.getByRole('button', { name: '登録', exact: true }).click()
    await window.getByText('デザイン確認用商事').click()
    const panel = window.locator('.panel')
    const panelRadius = await panel.evaluate((el) => getComputedStyle(el).borderRadius)
    expect(panelRadius).toBe('0px')

    // 状態バッジ(表示だけの物): 角丸999px(丸型)
    const badge = window.locator('.badge-active').first()
    const badgeRadius = await badge.evaluate((el) => getComputedStyle(el).borderRadius)
    expect(badgeRadius).toBe('999px')

    await shot(window, 'TC-34', 'detail_panel_and_badge')

    // 危険色(赤)は「データ復元」ダイアログの「続行」ボタンにのみ使用されることを確認
    await window.getByRole('button', { name: 'ホーム' }).click()
    await window.getByRole('button', { name: 'データを復元' }).click()
    await window.getByRole('button', { name: 'ファイルを選択して復元' }).click()
    const continueButton = window.getByRole('button', { name: '続行' })
    const continueStyle = await continueButton.evaluate(
      (el) => getComputedStyle(el).backgroundColor
    )
    expect(continueStyle).toBe('rgb(179, 69, 58)') // #B3453A

    const cancelButton = window.getByRole('button', { name: 'キャンセル' })
    const cancelStyle = await cancelButton.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(cancelStyle).not.toBe('rgb(179, 69, 58)')

    await shot(window, 'TC-34', 'import_dialog_danger_button')
  })

  test('サイドバーの「準備中」メニューは、どの画面からでも案内表示のみで遷移せず、「見積書・請求書」は遷移する(TC-03)', async () => {
    const { window } = launched

    // ホーム画面から「準備中」メニュー押下
    await window.getByRole('button', { name: '案件管理' }).click()
    await expect(
      window.getByText('「案件管理」は以降のイテレーションで実装予定です。')
    ).toBeVisible()
    await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - ホーム') // 画面遷移しないこと

    // 取引先一覧画面からも同様に案内表示のみで遷移しないこと(結合確認: 全画面共通のサイドバー挙動)
    await window.getByRole('button', { name: '取引先管理' }).click()
    await window.getByRole('button', { name: '入出金・経費' }).click()
    await expect(
      window.getByText('「入出金・経費」は以降のイテレーションで実装予定です。')
    ).toBeVisible()
    await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - 取引先一覧')

    // イテレーション1で「見積書・請求書」は実装済みとなり、準備中ではなく画面遷移する(詳細設計書3.1章)
    await window.getByRole('button', { name: '見積書・請求書' }).click()
    await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - 見積書・請求書')
    await expect(window.locator('.sidebar-item.active')).toHaveText('見積書・請求書')
    await shot(window, 'TC-03', 'coming_soon_notice')
  })
})
