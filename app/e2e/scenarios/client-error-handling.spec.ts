import { test, expect } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/electron-app'
import { evidenceDir } from './evidence-dir'

/**
 * 【tester作成】F-04/F-06のバリデーション形式エラー・異常系を補足確認する。
 * 参照元: 詳細設計書 3.3章(入力項目定義表)・8章(エラーハンドリング設計)
 * 観点: 異常系・入力値検証
 */

const EVIDENCE_DIR = evidenceDir('TC-16_client-error-handling')

test.describe('F-04/F-06: 形式バリデーション・存在しないIDの異常系(TC-16・TC-24)', () => {
  let launched: LaunchedApp

  test.beforeAll(() => {
    mkdirSync(EVIDENCE_DIR, { recursive: true })
  })

  test.beforeEach(async () => {
    launched = await launchApp()
  })

  test.afterEach(async () => {
    await closeApp(launched)
  })

  test('郵便番号・電話番号・メールアドレスの形式不正でエラーが表示される(TC-16)', async () => {
    const { window } = launched

    await window.getByRole('button', { name: '取引先管理' }).click()
    await window.getByRole('button', { name: '+ 新規登録' }).click()
    await window.getByLabel('取引先名称').fill('形式チェック確認用商事')
    await window.getByLabel('郵便番号').fill('東京都')
    await window.getByLabel('電話番号').fill('０３－１２３４（本社）')
    await window.getByLabel('メールアドレス').fill('不正なメールアドレス')
    await window.getByRole('button', { name: '登録', exact: true }).click()

    await expect(
      window.getByText('郵便番号は半角数字とハイフンで入力してください(例: 123-4567)')
    ).toBeVisible()
    await expect(
      window.getByText('電話番号は半角数字・ハイフン・括弧で入力してください')
    ).toBeVisible()
    await expect(window.getByText('メールアドレスの形式が正しくありません')).toBeVisible()
    await window.screenshot({ path: `${EVIDENCE_DIR}/01_format_validation_errors.png` })
  })

  test('登録画面で「キャンセル」を押すと入力内容を破棄して一覧へ戻る(TC-17)', async () => {
    const { window } = launched

    await window.getByRole('button', { name: '取引先管理' }).click()
    await window.getByRole('button', { name: '+ 新規登録' }).click()
    await window.getByLabel('取引先名称').fill('キャンセル確認用商事(破棄されるはず)')
    await window.getByRole('button', { name: 'キャンセル' }).click()

    await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - 取引先一覧')
    await expect(window.getByText('該当する取引先がありません')).toBeVisible()
    await expect(
      window.getByRole('cell', { name: 'キャンセル確認用商事(破棄されるはず)' })
    ).not.toBeVisible()
  })

  test('存在しない取引先IDを取得しようとするとエラーになる(TC-24・IPC直接確認)', async () => {
    const { window } = launched

    // 通常のUI操作では一覧・詳細から必ず実在するIDのみが渡されるため、存在しないIDへは
    // 画面遷移だけでは到達できない。詳細設計書4.6章手順2・8章の異常系を実機で確認するため、
    // 実際にpreloadで公開されているAPI(window.jimuhubApi)を直接呼び出して検証する。
    const errorMessage = await window.evaluate(async () => {
      try {
        await window.jimuhubApi.getClient(999999)
        return null
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    })

    // 参考所見TC-24-a: window.jimuhubApi 経由(実際のElectron IPC)で受け取るエラーメッセージには、
    // Electronのipcランタイムが付与する接頭辞("Error invoking remote method 'clients:get': ...")が
    // 含まれ、`ClientService`が投げた素の「指定された取引先が見つかりません」とは完全一致しない。
    // ClientDetailPage.tsx/ClientFormPage.tsx はこの文字列をそのまま画面に表示するため、
    // 万一この経路(通常操作では到達しない)に到達した場合、利用者には技術的な接頭辞つきの
    // 文言が見えてしまう。レビュー結果報告書 v0.1 No.11(Zod検証エラーが技術的な文言になる懸念)と
    // 同根の論点であり、同様に「通常操作では到達しない防御的チェック」のため実害は小さいと判断し、
    // 参考所見として記録する(該当メッセージ自体は末尾に正しい文言を含んでいることを確認する)。
    expect(errorMessage).toContain('指定された取引先が見つかりません')
    expect(errorMessage).not.toBe('指定された取引先が見つかりません')
  })
})
