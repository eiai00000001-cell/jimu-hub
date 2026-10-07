import { test, expect } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/electron-app'

/**
 * F-33(旧形式バックアップの復元前の確認)の分岐を、実際のアプリを起動して確認する。
 * 現在のデータに領収書があり、領収書を含まない旧形式(スキーマバージョン3のJSON)を復元しようとすると、
 * 確認画面を表示する。「キャンセル」では何も変更せず、「復元する」では復元する。
 * 参照元: 詳細設計書 3.7章・4.33章。シナリオの設計・合否判定はtesterの担当で、本ファイルは基盤の動作確認用。
 */
test.describe('データ復元: 領収書が消える場合の確認(F-33)', () => {
  let launched: LaunchedApp
  let workDir: string

  test.beforeEach(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'jimuhub-e2e-restore-confirm-'))
    const receiptPath = join(workDir, 'dummy_receipt.pdf')
    writeFileSync(receiptPath, '%PDF-1.4\nダミーの領収書(テスト用)\n')
    const legacyPath = join(workDir, 'legacy.json')
    writeFileSync(
      legacyPath,
      JSON.stringify({
        schemaVersion: 3,
        appVersion: '0.2.0',
        exportedAt: '2026-09-28T00:00:00.000Z',
        data: { clients: [] }
      })
    )
    launched = await launchApp({
      JIMUHUB_E2E_RECEIPT_PATHS: receiptPath,
      JIMUHUB_E2E_IMPORT_PATH: legacyPath
    })
  })

  test.afterEach(async () => {
    await closeApp(launched)
    rmSync(workDir, { recursive: true, force: true })
  })

  test('領収書を含まない旧形式の復元は、確認画面で「キャンセル」すると中止でき、「復元する」で復元できる', async () => {
    const { window } = launched

    // 領収書つきの経費を登録しておく
    await window.getByRole('button', { name: '入出金・経費' }).click()
    await window.getByRole('button', { name: '+ 経費を登録' }).click()
    await window.getByLabel(/金額/).fill('1,100')
    await window.getByLabel(/勘定科目/).selectOption({ label: '通信費' })
    await window.getByLabel(/摘要・メモ/).fill('確認画面の検証')
    await window.getByLabel('税区分').selectOption('standard_10')
    await window.getByRole('button', { name: 'ファイルを追加' }).click()
    await expect(window.getByText('dummy_receipt.pdf')).toBeVisible()
    await window.getByRole('button', { name: '登録', exact: true }).click()
    await expect(window.getByText('記録を登録しました')).toBeVisible()

    // 復元: 確認画面が表示される
    await window.getByRole('button', { name: 'ホーム' }).click()
    await window.getByRole('button', { name: 'データを復元' }).click()
    await window.getByRole('button', { name: 'ファイルを選択して復元' }).click()
    await window.getByRole('button', { name: '続行' }).click()
    await expect(window.getByText('復元前の確認')).toBeVisible()
    await expect(window.getByText(/現在の領収書\(1件\)はすべて消えます/)).toBeVisible()

    // 「キャンセル」: 何も変更せず、最初の状態へ戻る
    await window.getByRole('button', { name: 'キャンセル' }).click()
    await expect(window.getByRole('button', { name: 'ファイルを選択して復元' })).toBeVisible()

    // もう一度選び直して「復元する」: 復元できる
    await window.getByRole('button', { name: 'ファイルを選択して復元' }).click()
    await window.getByRole('button', { name: '続行' }).click()
    await window.getByRole('button', { name: '復元する' }).click()
    await expect(window.getByText(/復元が完了しました/)).toBeVisible()
  })
})
