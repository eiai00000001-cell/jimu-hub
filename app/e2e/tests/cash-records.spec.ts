import { test, expect } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/electron-app'
import { createClientApi, finalizeInvoiceApi, setupCompany } from '../scenarios/helpers'

/**
 * イテレーション2の通し確認(スモーク): 勘定科目の追加 → 経費登録(領収書つき) → 請求書の入金済みで入金記録を自動作成
 * → 集計 → CSV出力 → エクスポート → 削除 → 復元。シナリオの設計・合否判定はtesterの担当で、本ファイルは基盤の動作確認用。
 * 参照元: 詳細設計書 3.15〜3.21章・4.17〜4.24章
 *
 * OS標準ダイアログはPlaywrightから操作できないため、E2Eテスト専用の環境変数
 * (JIMUHUB_E2E_RECEIPT_PATHS/JIMUHUB_E2E_CSV_PATH/JIMUHUB_E2E_EXPORT_PATH/JIMUHUB_E2E_IMPORT_PATH)で
 * パスを指定し、ダイアログ表示を省略する。領収書はダミーのファイルを一時ディレクトリに生成して使い、実ファイルは使わない。
 */
test.describe('入出金・経費: 通し確認', () => {
  let launched: LaunchedApp
  let workDir: string
  let csvPath: string

  test.beforeEach(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'jimuhub-e2e-cash-'))
    const receiptPath = join(workDir, 'dummy_receipt.pdf')
    writeFileSync(receiptPath, '%PDF-1.4\nダミーの領収書(テスト用)\n')
    csvPath = join(workDir, 'export.csv')
    launched = await launchApp({
      JIMUHUB_E2E_RECEIPT_PATHS: receiptPath,
      JIMUHUB_E2E_CSV_PATH: csvPath,
      JIMUHUB_E2E_EXPORT_PATH: join(workDir, 'backup.zip'),
      JIMUHUB_E2E_IMPORT_PATH: join(workDir, 'backup.zip')
    })
  })

  test.afterEach(async () => {
    await closeApp(launched)
    rmSync(workDir, { recursive: true, force: true })
  })

  test('勘定科目→経費登録(領収書)→入金済みの自動作成→集計→CSV→エクスポート→復元', async () => {
    const { window } = launched
    const year = new Date().getFullYear()

    // 勘定科目の追加
    await window.getByRole('button', { name: '入出金・経費' }).click()
    await window.getByRole('button', { name: '勘定科目の管理' }).click()
    await window.getByLabel(/名称/).first().fill('研修費')
    await window.getByRole('button', { name: '追加', exact: true }).click()
    await expect(window.getByRole('cell', { name: '研修費' })).toBeVisible()
    await window.getByText('← 一覧へ戻る').click()

    // 経費の登録(ダミーの領収書つき)
    await window.getByRole('button', { name: '+ 経費を登録' }).click()
    await window.getByLabel(/金額/).fill('6,600')
    await window.getByLabel(/勘定科目/).selectOption({ label: '研修費' })
    await window.getByLabel(/摘要・メモ/).fill('研修の受講料')
    await window.getByLabel('税区分').selectOption('standard_10')
    await window.getByRole('button', { name: 'ファイルを追加' }).click()
    await expect(window.getByText('dummy_receipt.pdf')).toBeVisible()
    await window.getByRole('button', { name: '登録', exact: true }).click()
    await expect(window.getByText('記録を登録しました')).toBeVisible()
    await expect(window.getByText('dummy_receipt.pdf')).toBeVisible()
    await expect(window.getByText('消費税額').locator('xpath=following-sibling::dd[1]')).toHaveText(
      '¥600'
    )

    // 請求書(源泉徴収なし)を作成して入金済みにすると、入金記録が自動作成される
    const clientId = await (async () => {
      await setupCompany(window)
      return createClientApi(window, '連携確認商事株式会社', {
        furigana: 'レンケイカクニンショウジ'
      })
    })()
    await finalizeInvoiceApi(window, clientId, `${year}-09-22`, [
      { name: '設計業務', quantity: 1, unit: '式', unitPrice: 100000, taxRate: 10 }
    ])
    await window.getByRole('button', { name: '見積書・請求書' }).click()
    await window.locator('.tab', { hasText: '請求書' }).click()
    await window.getByRole('cell', { name: `${year}-001` }).click()
    await window.getByRole('button', { name: '入金済みにする' }).click()
    await window.getByLabel('入金日').fill(`${year}-09-30`)
    await window.getByRole('button', { name: '確定' }).click()
    await expect(window.getByText('入金済みにしました')).toBeVisible()
    await expect(window.getByText('紐づく入金記録')).toBeVisible()

    // 入出金一覧・集計
    await window.getByRole('button', { name: '入出金・経費' }).click()
    await expect(window.getByText('+¥110,000')).toBeVisible()
    await expect(window.getByText('−¥6,600')).toBeVisible()
    await window.getByRole('button', { name: '集計', exact: true }).click()
    await expect(window.getByText(`${year}年 入金合計`)).toBeVisible()
    await expect(window.getByText(`${year}年 合計`)).toBeVisible()
    await window.getByRole('button', { name: '記録一覧' }).click()

    // CSV出力(保存先は一時ディレクトリ)
    await window.getByRole('button', { name: 'CSV出力' }).click()
    await window.getByRole('dialog').getByRole('button', { name: '出力' }).click()
    await expect(window.getByText(/CSVを出力しました/)).toBeVisible()
    const csv = readFileSync(csvPath, 'utf8')
    expect(csv.startsWith('﻿日付,種別,')).toBe(true)
    expect(csv).toContain('研修費')
    expect(csv).toContain('dummy_receipt.pdf')
    await window.getByRole('dialog').getByRole('button', { name: '閉じる' }).click()

    // エクスポート → 記録を削除 → 復元
    await window.getByRole('button', { name: 'ホーム' }).click()
    await window.getByRole('button', { name: 'データをエクスポート' }).click()
    await window.getByRole('button', { name: 'エクスポート実行' }).click()
    await expect(window.getByText(/保存しました/)).toBeVisible()
    expect(existsSync(join(workDir, 'backup.zip'))).toBe(true)
    await window.getByLabel('閉じる').click()

    await window.getByRole('button', { name: '入出金・経費' }).click()
    await window.getByText('研修の受講料').click()
    await window.getByRole('button', { name: '削除', exact: true }).click()
    await window.getByRole('button', { name: 'はい' }).click()
    await expect(window.getByText('記録を削除しました')).toBeVisible()
    await expect(window.getByText('研修の受講料')).toHaveCount(0)

    await window.getByRole('button', { name: 'ホーム' }).click()
    await window.getByRole('button', { name: 'データを復元' }).click()
    await window.getByRole('button', { name: 'ファイルを選択して復元' }).click()
    await window.getByRole('button', { name: '続行' }).click()
    const done = window.getByText(/復元が完了しました/)
    await expect(done).toBeVisible()
    await expect(done).not.toContainText('改変')
    await window.getByLabel('閉じる').click()

    // 復元後: 記録・領収書が戻り、改変の警告は出ない
    await window.getByRole('button', { name: '入出金・経費' }).click()
    await window.getByText('研修の受講料').click()
    await expect(window.getByText('dummy_receipt.pdf')).toBeVisible()
    await expect(window.getByText('この記録の改変が疑われます')).toHaveCount(0)
    await expect(window.getByText('ファイルの改変が疑われます')).toHaveCount(0)
    await expect(window.getByText('ファイルが見つかりません')).toHaveCount(0)
  })
})
