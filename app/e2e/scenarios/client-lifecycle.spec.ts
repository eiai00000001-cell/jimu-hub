import { test, expect } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/electron-app'
import { evidenceDir } from './evidence-dir'

/**
 * 【tester作成】結合シナリオ: F-01(トップ画面)〜F-08(利用停止)を一連の画面遷移で確認する。
 * 参照元: 詳細設計書 3章(画面詳細設計)・4章(処理フロー設計)
 * 観点: 機能テスト・異常系・データ整合性・機能横断/結合確認・デザインガイド適合(簡易)
 *
 * 開発者のE2E(e2e/tests)は「登録→一覧反映」「エクスポート→復元」の単発フローのみを検証しているため、
 * 本シナリオはトップ画面の件数表示・一覧・詳細・編集・利用停止までを1回の起動で通しに操作し、
 * 画面をまたいだデータの受け渡し・表示の整合性(結合テスト観点)を確認する。
 */

const EVIDENCE_DIR = evidenceDir('TC-31_client-lifecycle')

test.describe('結合シナリオ: 取引先のライフサイクル一連確認(TC-31・TC-32・TC-33)', () => {
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

  test('登録→一覧反映→詳細→編集→利用停止→ホーム件数連動までが一貫して整合する', async () => {
    const { window } = launched

    // --- F-01: ホーム画面初期表示。件数はまだ0件 ---
    await expect(window.getByText('取引先登録件数(利用中)')).toBeVisible()
    await expect(window.getByText('0件')).toBeVisible()
    await window.screenshot({ path: `${EVIDENCE_DIR}/01_home_initial.png` })

    // タイトルバー表記の統一(デザインガイド5.2章「事務HUB - 〈画面名〉」)を確認
    await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - ホーム')

    // --- F-05: 一覧画面(0件時の案内文言) ---
    await window.getByRole('button', { name: '取引先管理' }).click()
    await expect(window.getByText('該当する取引先がありません')).toBeVisible()
    await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - 取引先一覧')

    // --- F-04: 新規登録(異常系: 必須未入力) ---
    await window.getByRole('button', { name: '+ 新規登録' }).click()
    await window.getByRole('button', { name: '登録', exact: true }).click()
    await expect(window.getByText('取引先名称を入力してください')).toBeVisible()
    await window.screenshot({ path: `${EVIDENCE_DIR}/02_form_validation_error.png` })

    // --- F-04: 新規登録(正常系。全項目入力) ---
    await window.getByLabel('取引先名称').fill('結合シナリオ商事株式会社')
    await window.getByLabel('敬称').selectOption('御中')
    await window.getByLabel('担当者名').fill('架空 太郎')
    await window.getByLabel('郵便番号').fill('100-0001')
    await window.getByLabel('住所').fill('東京都千代田区千代田1-1-1(架空)')
    await window.getByLabel('電話番号').fill('03-1234-5678')
    await window.getByLabel('メールアドレス').fill('sample@example.com')
    await window.getByRole('button', { name: '登録', exact: true }).click()

    await expect(window.getByText('取引先を登録しました')).toBeVisible()
    await expect(window.getByRole('cell', { name: '結合シナリオ商事株式会社' })).toBeVisible()
    await window.screenshot({ path: `${EVIDENCE_DIR}/03_list_after_create.png` })

    // --- F-01: ホーム件数がF-04の登録結果と連動していることを確認(結合確認) ---
    await window.getByRole('button', { name: 'ホーム' }).click()
    await expect(window.getByText('1件')).toBeVisible()
    await window.screenshot({ path: `${EVIDENCE_DIR}/04_home_count_after_create.png` })

    // --- F-06: 詳細画面(全項目表示) ---
    await window.getByRole('button', { name: '取引先管理' }).click()
    await window.getByText('結合シナリオ商事株式会社').click()
    await expect(window.getByText('取引先ID')).toBeVisible()
    await expect(window.getByText('架空 太郎')).toBeVisible()
    await expect(window.getByText('東京都千代田区千代田1-1-1(架空)')).toBeVisible()
    await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - 取引先詳細')
    await window.screenshot({ path: `${EVIDENCE_DIR}/05_detail_view.png` })

    // --- F-07: 編集(異常系: 文字数上限超過) ---
    await window.getByRole('button', { name: '編集' }).click()
    const longMemo = 'あ'.repeat(2001)
    await window.getByLabel('メモ').fill(longMemo)
    await window.getByRole('button', { name: '保存', exact: true }).click()
    await expect(window.getByText('メモは2000文字以内で入力してください')).toBeVisible()

    // --- F-07: 編集(正常系) ---
    await window.getByLabel('メモ').fill('')
    await window.getByLabel('担当者名').fill('架空 花子')
    await window.getByRole('button', { name: '保存', exact: true }).click()
    await expect(window.getByText('取引先を更新しました')).toBeVisible()
    await expect(window.getByText('架空 花子')).toBeVisible()
    await window.screenshot({ path: `${EVIDENCE_DIR}/06_detail_after_update.png` })

    // --- F-08: 利用停止(「いいえ」でキャンセルされることを確認) ---
    await window.getByRole('button', { name: '利用停止にする' }).click()
    await expect(window.getByText('本当に利用停止にしますか')).toBeVisible()
    await window.getByRole('button', { name: 'いいえ' }).click()
    await expect(window.getByText('本当に利用停止にしますか')).not.toBeVisible()

    // --- F-08: 利用停止(「はい」で実行) ---
    await window.getByRole('button', { name: '利用停止にする' }).click()
    await window.getByRole('button', { name: 'はい' }).click()
    await expect(window.getByText('取引先を利用停止にしました')).toBeVisible()
    await window.screenshot({ path: `${EVIDENCE_DIR}/07_detail_after_deactivate.png` })

    // --- バックエンドのデータ自体は正しく更新されていることを確認(IPC直接呼び出し) ---
    const clientIdOnScreen = Number(await window.locator('.info-grid dd').first().textContent())
    const backendStatus = await window.evaluate(
      async (id) => (await window.jimuhubApi.getClient(id)).status,
      clientIdOnScreen
    )
    expect(backendStatus).toBe('inactive')

    // BUG-02修正確認: 詳細設計書4.8章手順4「一覧・詳細画面の表示を最新化し、状態バッジを反映する」のとおり、
    // 同一詳細画面インスタンス内でも再取得され、バッジ・編集ボタンが即座に「利用停止」状態を反映することを確認する
    // (画面見出し脇のバッジ・状態欄のバッジの2箇所に表示されるため`.first()`で判定する)。
    await expect
      .soft(
        window.getByText('利用停止', { exact: true }).first(),
        'BUG-02: 利用停止後に詳細画面のバッジが更新されない'
      )
      .toBeVisible()
    await expect
      .soft(
        window.getByRole('button', { name: '編集' }),
        'BUG-02: 利用停止後に編集ボタンが非活性にならない'
      )
      .toBeDisabled()

    // --- F-05: 既定フィルタでは一覧から除外され、ホーム件数も0件に戻ることを確認(結合確認) ---
    await window.getByRole('button', { name: '一覧へ戻る' }).click()
    await expect(window.getByText('該当する取引先がありません')).toBeVisible()

    await window.getByRole('button', { name: 'ホーム' }).click()
    await expect(window.getByText('0件')).toBeVisible()
    await window.screenshot({ path: `${EVIDENCE_DIR}/08_home_count_after_deactivate.png` })

    // --- F-05: 「利用停止も表示」ONで、利用停止した取引先がグレー表示で再確認できる ---
    await window.getByRole('button', { name: '取引先管理' }).click()
    await window.getByRole('switch', { name: '利用停止も表示' }).click()
    await expect(window.getByRole('cell', { name: '結合シナリオ商事株式会社' })).toBeVisible()
    await window.screenshot({ path: `${EVIDENCE_DIR}/09_list_show_inactive.png` })

    // --- F-06/回帰(TC-27): 一覧からの「新規の」画面遷移(再マウント)で開いた詳細画面では、
    // 不具合TC-31-aとは異なり、バッジ・編集ボタンとも正しく「利用停止」状態を反映することを確認する。
    // これにより、不具合の原因が業務ロジック自体ではなく、同一画面インスタンス内の再取得漏れに
    // 限定されることを切り分ける。 ---
    await window.getByText('結合シナリオ商事株式会社').click()
    await expect(window.getByText('利用停止', { exact: true }).first()).toBeVisible()
    await expect(window.getByRole('button', { name: '編集' })).toBeDisabled()
    await expect(window.getByRole('button', { name: '利用停止にする' })).not.toBeVisible()
    await window.screenshot({ path: `${EVIDENCE_DIR}/10_detail_fresh_mount_after_deactivate.png` })
  })
})
