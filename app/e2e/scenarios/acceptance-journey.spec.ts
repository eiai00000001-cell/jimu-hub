import { test, expect } from '@playwright/test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/electron-app'
import { noteEvidence, shot } from './evidence-dir'
import { COMPANY, dbQuery, pdfText, sha256File } from './helpers'

/**
 * 【tester作成】受入条件単位の通しシナリオ(TC-74): 初回設定→取引先→見積書→PDF→請求書変換→源泉徴収→入金→
 * エクスポート→(別データを追加)→復元、までをすべて画面操作で通す。機能横断のデータ受け渡しを確認する(観点5)。
 */
test('TC-74: 初回設定から見積書・請求書・入金・バックアップ復元までの通しシナリオ', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'jimuhub-scenario-journey-'))
  const zip = join(workDir, 'journey.zip')
  const launched: LaunchedApp = await launchApp({
    JIMUHUB_E2E_EXPORT_PATH: zip,
    JIMUHUB_E2E_IMPORT_PATH: zip
  })
  const { window, dataDir } = launched
  try {
    // 1. 自社情報を設定(F-10)
    await window.getByRole('button', { name: '自社情報・振込先の設定' }).click()
    await window.getByLabel('氏名・屋号').fill(COMPANY.name)
    await window.getByLabel('住所').fill(COMPANY.address)
    await window.getByLabel('インボイス登録番号').fill(COMPANY.invoiceRegistrationNumber)
    await window.getByLabel('振込先銀行名').fill(COMPANY.bankName)
    await window.getByLabel('振込先支店名').fill(COMPANY.bankBranch)
    await window.getByLabel('口座種別').selectOption('普通')
    await window.getByLabel('口座番号').fill(COMPANY.accountNumber)
    await window.getByLabel('口座名義').fill(COMPANY.accountHolder)
    await window.getByRole('button', { name: '保存', exact: true }).click()
    await expect(window.getByText('自社情報を保存しました')).toBeVisible()

    // 2. 取引先を登録(F-04。フリガナはひらがな入力)
    await window.getByRole('button', { name: 'ホーム' }).click()
    await window.getByRole('button', { name: '取引先管理' }).click()
    await window.getByRole('button', { name: '+ 新規登録' }).click()
    await window.getByLabel('取引先名称').fill('通しシナリオ株式会社')
    await window.getByLabel('フリガナ').fill('とおししなりお')
    await window.getByLabel('敬称').selectOption('御中')
    await window.getByRole('button', { name: '登録', exact: true }).click()
    await expect(window.getByText('取引先を登録しました')).toBeVisible()

    // 3. 見積書を作成してPDF保存(F-12)
    await window.getByRole('button', { name: '見積書・請求書' }).click()
    await window.getByRole('button', { name: '+ 見積書を新規作成' }).click()
    await window.locator('#quote-client').selectOption({ label: '通しシナリオ株式会社' })
    await window.getByLabel('発行日').fill('2026-10-02')
    await window.getByLabel('品名1').fill('システム設計')
    await window.getByLabel('数量1').fill('1')
    await window.getByLabel('単価1').fill('1200000')
    await window.getByRole('button', { name: '+ 行を追加' }).click()
    await window.getByLabel('品名2').fill('印刷物(軽減税率)')
    await window.getByLabel('単価2').fill('3000')
    await window.getByLabel('税率2').selectOption('8')
    await window.getByRole('button', { name: 'PDFとして保存' }).click()
    await expect(window.getByText('PDFとして保存しました')).toBeVisible()
    await shot(window, 'TC-74', '見積書をPDF保存(2026-001)')

    // 4. 請求書へ変換(F-13)→源泉徴収対象を指定(F-16)→PDF保存(F-14)
    await window.getByRole('button', { name: '請求書に変換' }).click()
    await expect(window.getByText('見積書から請求書(下書き)を作成しました')).toBeVisible()
    await window.getByRole('button', { name: '編集' }).click()
    await expect(window.getByLabel('品名1')).toHaveValue('システム設計')
    await window.getByLabel('源泉徴収対象1').check()
    // 120万円 → 102,100 + 200,000×0.2042 = 142,940
    await expect(
      window.locator('.totals-row', { hasText: '源泉徴収税額' }).locator('.val')
    ).toHaveText('-¥142,940')
    await window.getByLabel('支払期限').fill('2026-11-30')
    await window.getByRole('button', { name: 'PDFとして保存' }).click()
    await expect(window.getByText('PDFとして保存しました')).toBeVisible()
    await expect(window.getByText('-¥142,940')).toBeVisible()
    await shot(window, 'TC-74', '請求書をPDF保存(源泉徴収税額142,940円)')

    // 5. 入金済みにする(F-15)
    await window.getByRole('button', { name: '入金済みにする' }).click()
    await window.getByLabel('入金日').fill('2026-10-25')
    await window.getByRole('button', { name: '確定' }).click()
    await expect(window.getByText('入金済みにしました')).toBeVisible()

    // 6. トップ画面の件数、エクスポート(F-02)
    await window.getByRole('button', { name: 'ホーム' }).click()
    await expect(
      window
        .locator('.summary-card')
        .filter({ has: window.getByText('未収の請求書件数', { exact: true }) })
        .locator('.summary-value')
    ).toHaveText('0件')
    await window.getByRole('button', { name: 'データをエクスポート' }).click()
    await window.getByRole('button', { name: 'エクスポート実行' }).click()
    await expect(window.getByText(/保存しました/)).toBeVisible()
    await window.getByLabel('閉じる').click()
    expect(existsSync(zip)).toBe(true)
    const before = dbQuery(
      dataDir,
      "SELECT (SELECT quote_number FROM quotes)||','||(SELECT invoice_number||':'||payment_status||':'||payment_date||':'||withholding_tax_amount||':'||billing_amount FROM invoices)"
    )
    expect(before).toBe(
      '2026-001,2026-001:paid:2026-10-25:142940:1,540,000'.replace(
        '1,540,000',
        String(1200000 + 120000 + 3000 + 240 - 142940)
      )
    )

    // 7. 復元前にデータを変更(別の取引先追加・請求書を未収へ戻す・PDF削除)してから復元する
    await window.getByRole('button', { name: '取引先管理' }).click()
    await window.getByRole('button', { name: '+ 新規登録' }).click()
    await window.getByLabel('取引先名称').fill('復元で消える取引先')
    await window.getByRole('button', { name: '登録', exact: true }).click()
    await expect(window.getByText('取引先を登録しました')).toBeVisible()
    const pdfPath = dbQuery(dataDir, 'SELECT pdf_path FROM quotes')
    const hashBefore = sha256File(pdfPath)
    rmSync(pdfPath)
    await window.getByRole('button', { name: 'ホーム' }).click()
    await window.getByRole('button', { name: 'データを復元' }).click()
    await window.getByRole('button', { name: 'ファイルを選択して復元' }).click()
    await window.getByRole('button', { name: '続行' }).click()
    await expect(window.locator('.modal .message-success')).toContainText('復元が完了しました')
    await expect(window.locator('.modal')).not.toContainText('改変')
    await shot(window, 'TC-74', 'エクスポートZIPから復元(不一致なし)')
    await window.getByLabel('閉じる').click()

    // 8. 復元結果: 追加した取引先は消え、見積書・請求書・入金状態・PDF実体が元に戻る
    expect(dbQuery(dataDir, 'SELECT COUNT(*) FROM clients')).toBe('1')
    expect(existsSync(pdfPath)).toBe(true)
    expect(sha256File(pdfPath)).toBe(hashBefore)
    expect(
      dbQuery(
        dataDir,
        "SELECT (SELECT quote_number FROM quotes)||','||(SELECT invoice_number||':'||payment_status||':'||payment_date||':'||withholding_tax_amount||':'||billing_amount FROM invoices)"
      )
    ).toBe(before)
    const invPdf = dbQuery(dataDir, 'SELECT pdf_path FROM invoices')
    const { text } = pdfText(invPdf)
    expect(text).toContain('通しシナリオ株式会社')
    expect(text).toContain('142,940')
    noteEvidence(
      'TC-74',
      '通しシナリオの結果',
      `復元前後で見積書・請求書の番号/入金/源泉徴収/請求金額が一致: ${before}\n請求書PDFにも源泉徴収税額が記載されている`
    )
    await window.getByRole('button', { name: '見積書・請求書' }).click()
    await window.getByRole('cell', { name: '2026-001' }).click()
    await expect(window.getByText('PDFファイルの改変が疑われます')).toHaveCount(0)
    await shot(window, 'TC-74', '復元後の見積書詳細(PDFも元どおり)')
  } finally {
    await closeApp(launched)
    rmSync(workDir, { recursive: true, force: true })
  }
})
