import { test, expect } from '@playwright/test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/electron-app'
import { evidenceFilePath, noteEvidence, shot } from './evidence-dir'
import { COMPANY, dbQuery, pdfText, pdfToPng, setupCompany, sha256File, todayIso } from './helpers'

/**
 * 【tester作成】F-11(取引先の簡易登録)・F-12(見積書の作成・PDF保存)の画面シナリオ(TC-45〜TC-48)。
 * 参照元: 詳細設計書 3.11章・3.12章・4.11章・4.12章・8章
 */
test.describe('F-11/F-12: 見積書の作成・PDF保存', () => {
  let launched: LaunchedApp

  test.beforeEach(async () => {
    launched = await launchApp()
  })
  test.afterEach(async () => {
    await closeApp(launched)
  })

  async function openNewQuote(window: LaunchedApp['window']): Promise<void> {
    await window.getByRole('button', { name: '見積書・請求書' }).click()
    await window.getByRole('button', { name: /見積書を新規作成/ }).click()
    await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - 見積書を作成')
  }

  test('TC-45: 取引先の簡易登録(モーダル)で登録した取引先が選択状態になり、取引先管理にも反映される', async () => {
    const { window } = launched
    await openNewQuote(window)
    await window.locator('.hint .link', { hasText: '取引先を新規登録' }).click()

    // 必須未入力はエラー(登録しない)
    await window.getByRole('button', { name: '登録', exact: true }).click()
    await expect(window.getByText('取引先名称を入力してください')).toBeVisible()
    await shot(window, 'TC-45', '簡易登録モーダルの必須未入力エラー')

    // キャンセルでモーダルを閉じ、取引先は未登録のまま
    await window.locator('.modal').getByRole('button', { name: 'キャンセル' }).click()
    await expect(window.getByLabel('取引先名称')).toHaveCount(0)
    await expect(window.locator('#quote-client option')).toHaveCount(1)

    // 登録成功: モーダルが閉じ、選択済みになる
    await window.locator('.hint .link', { hasText: '取引先を新規登録' }).click()
    await window.getByLabel('取引先名称').fill('簡易登録テスト株式会社')
    await window.getByRole('button', { name: '登録', exact: true }).click()
    await expect(window.getByLabel('取引先名称')).toHaveCount(0)
    await expect(window.locator('#quote-client option:checked')).toHaveText(
      '簡易登録テスト株式会社'
    )
    await shot(window, 'TC-45', '登録した取引先が選択済みで反映される')

    // 取引先管理で通常の取引先として表示され、編集もできる(区別表示なし)
    await window.getByRole('button', { name: 'キャンセル', exact: true }).click()
    await window.getByRole('button', { name: '取引先管理' }).click()
    await expect(window.getByRole('cell', { name: '簡易登録テスト株式会社' })).toBeVisible()
    await window.getByText('簡易登録テスト株式会社').click()
    await expect(window.getByRole('button', { name: '編集' })).toBeEnabled()
    await shot(window, 'TC-45', '取引先管理に通常の取引先として表示される')
  })

  test('TC-46: 下書き保存→詳細(未採番・下書き)→編集→再保存、キャンセルでの破棄', async () => {
    const { window, dataDir } = launched
    await setupCompany(window)
    await openNewQuote(window)
    await window.locator('.hint .link', { hasText: '取引先を新規登録' }).click()
    await window.getByLabel('取引先名称').fill('下書き確認商事')
    await window.getByRole('button', { name: '登録', exact: true }).click()

    await window.getByLabel('品名1').fill('Webサイト制作')
    await window.getByLabel('数量1').fill('2')
    await window.getByLabel('単位1').fill('式')
    await window.getByLabel('単価1').fill('50000')
    await window.getByLabel('備考').fill('下書きの備考')
    await shot(window, 'TC-46', '作成画面の入力(行金額・合計がリアルタイム再計算)')
    await expect(window.locator('.totals-row.grand .val')).toHaveText('¥110,000')

    await window.getByRole('button', { name: '下書き保存' }).click()
    await expect(window.getByText('見積書を下書き保存しました')).toBeVisible()
    await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - 見積書詳細')
    await expect(window.getByText('(未採番)').first()).toBeVisible()
    await expect(window.getByRole('button', { name: '編集' })).toBeVisible()
    await expect(window.getByRole('button', { name: 'PDFを開く' })).toHaveCount(0)
    await expect(window.getByRole('button', { name: '請求書に変換' })).toHaveCount(0)
    await shot(window, 'TC-46', '下書き保存後の詳細画面(未採番・編集可・PDF操作なし)')
    expect(
      dbQuery(
        dataDir,
        'SELECT status, quote_number IS NULL, pdf_path IS NULL, total_amount FROM quotes'
      )
    ).toBe('draft|1|1|110000')

    // 編集→再保存(同一IDのUPDATE。レコードは増えない)
    await window.getByRole('button', { name: '編集' }).click()
    await expect(window.getByLabel('品名1')).toHaveValue('Webサイト制作')
    await window.getByLabel('単価1').fill('60000')
    await window.getByRole('button', { name: '下書き保存' }).click()
    await expect(window.getByText('見積書を下書き保存しました')).toBeVisible()
    expect(dbQuery(dataDir, 'SELECT COUNT(*), MAX(total_amount) FROM quotes')).toBe('1|132000')
    expect(dbQuery(dataDir, 'SELECT COUNT(*) FROM quote_line_items')).toBe('1')

    // キャンセルは保存せずに一覧へ戻る
    await window.getByText('一覧へ戻る').click()
    await window.getByRole('button', { name: /見積書を新規作成/ }).click()
    await window.getByLabel('品名1').fill('破棄される明細')
    await window.getByRole('button', { name: 'キャンセル' }).click()
    await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - 見積書・請求書')
    expect(dbQuery(dataDir, 'SELECT COUNT(*) FROM quotes')).toBe('1')
  })

  test('TC-47: 見積書作成の入力値検証(取引先・品名・数量・単価・日付・明細行)', async () => {
    const { window, dataDir } = launched
    await setupCompany(window)
    await openNewQuote(window)

    // 必須未入力(取引先未選択・品名空)
    await window.getByRole('button', { name: '下書き保存' }).click()
    await expect(window.getByText('取引先を選択してください')).toBeVisible()
    await expect(window.getByText('品名を入力してください')).toBeVisible()
    await shot(window, 'TC-47', '取引先未選択・品名空のエラー(下書き保存)')

    // 同じ検証が「PDFとして保存」でも働く
    await window.getByRole('button', { name: 'PDFとして保存' }).click()
    await expect(window.getByText('取引先を選択してください')).toBeVisible()

    // 数量0・単価負数
    await window.locator('.hint .link', { hasText: '取引先を新規登録' }).click()
    await window.getByLabel('取引先名称').fill('検証用商事')
    await window.getByRole('button', { name: '登録', exact: true }).click()
    await window.getByLabel('品名1').fill('検証明細')
    await window.getByLabel('数量1').fill('0')
    await window.getByLabel('単価1').fill('-1')
    await window.getByRole('button', { name: '下書き保存' }).click()
    await expect(
      window.getByText('数量は0より大きい数値を、小数第2位までで入力してください')
    ).toBeVisible()
    await expect(window.getByText('単価は0以上の整数で入力してください')).toBeVisible()
    await shot(window, 'TC-47', '数量0・単価負数のエラー')

    // 小数第3位の数量
    await window.getByLabel('数量1').fill('1.234')
    await window.getByLabel('単価1').fill('100')
    await window.getByRole('button', { name: '下書き保存' }).click()
    await expect(
      window.getByText('数量は0より大きい数値を、小数第2位までで入力してください')
    ).toBeVisible()

    // 発行日の未入力
    await window.getByLabel('数量1').fill('1')
    await window.getByLabel('発行日').fill('')
    await window.getByRole('button', { name: '下書き保存' }).click()
    await expect(window.getByText('発行日を入力してください')).toBeVisible()
    await shot(window, 'TC-47', '発行日未入力のエラー')

    // 有効期限が発行日より前: 警告のみ(保存は可能)
    await window.getByLabel('発行日').fill('2026-10-10')
    await window.getByLabel('有効期限').fill('2026-10-01')
    await expect(
      window.getByText('発行日より前の日付が入力されています(保存は可能です)')
    ).toBeVisible()
    await shot(window, 'TC-47', '有効期限が発行日より前の警告表示')

    // 明細行: 1行のときは削除不可、追加すると2行、削除で1行へ
    await expect(window.getByRole('button', { name: '削除' })).toBeDisabled()
    await window.getByRole('button', { name: '+ 行を追加' }).click()
    await expect(window.getByLabel('品名2')).toBeVisible()
    await window.getByRole('button', { name: '削除' }).last().click()
    await expect(window.getByLabel('品名2')).toHaveCount(0)

    // 警告のみなので保存できる
    await window.getByRole('button', { name: '下書き保存' }).click()
    await expect(window.getByText('見積書を下書き保存しました')).toBeVisible()
    expect(dbQuery(dataDir, 'SELECT COUNT(*) FROM quotes')).toBe('1')
  })

  test('TC-48: PDFとして保存(確定): 採番・PDF生成・保存先・ハッシュ・PDF内容・編集不可', async () => {
    const { window, dataDir } = launched
    await setupCompany(window)
    await openNewQuote(window)
    await window.locator('.hint .link', { hasText: '取引先を新規登録' }).click()
    await window.getByLabel('取引先名称').fill('確定確認商事')
    await window.getByRole('button', { name: '登録', exact: true }).click()
    await window.getByLabel('発行日').fill('2026-10-02')
    await window.getByLabel('有効期限').fill('2026-10-31')
    await window.getByLabel('品名1').fill('設計業務')
    await window.getByLabel('数量1').fill('3')
    await window.getByLabel('単価1').fill('10000')
    await window.getByRole('button', { name: '+ 行を追加' }).click()
    await window.getByLabel('品名2').fill('軽減税率の資料')
    await window.getByLabel('単価2').fill('1000')
    await window.getByLabel('税率2').selectOption('8')
    await window.getByLabel('備考').fill('確定テストの備考')
    await expect(window.locator('.totals-row.grand .val')).toHaveText('¥34,080')
    await window.getByRole('button', { name: 'PDFとして保存' }).click()

    await expect(window.getByText('PDFとして保存しました')).toBeVisible()
    await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - 見積書詳細')
    await expect(window.getByText('2026-001').first()).toBeVisible()
    await expect(window.getByRole('button', { name: 'PDFを開く' })).toBeVisible()
    await expect(window.getByRole('button', { name: 'Finderで表示' })).toBeVisible()
    await expect(window.getByRole('button', { name: '請求書に変換' })).toBeVisible()
    await expect(window.getByRole('button', { name: '編集' })).toHaveCount(0)
    await shot(window, 'TC-48', 'PDF保存後の詳細画面(書類番号2026-001・PDF操作・請求書変換)')

    // DB: 採番・状態・記載形式(自社にインボイス番号あり=適格)・PDFパスとハッシュ
    const row = dbQuery(
      dataDir,
      'SELECT quote_number,status,invoice_format,pdf_path,pdf_hash,pdf_hash_mismatch,subtotal_10,tax_amount_10,subtotal_8,tax_amount_8,total_amount FROM quotes'
    ).split('|')
    expect(row[0]).toBe('2026-001')
    expect(row[1]).toBe('finalized')
    expect(row[2]).toBe('qualified')
    expect(row[5]).toBe('0')
    expect(row.slice(6).join('|')).toBe('30000|3000|1000|80|34080')
    const pdfPath = row[3] as string
    expect(pdfPath).toContain(join(dataDir, 'documents', 'quotes', '2026'))
    expect(pdfPath.endsWith('2026-001_確定確認商事.pdf')).toBe(true)
    expect(existsSync(pdfPath)).toBe(true)
    expect(sha256File(pdfPath)).toBe(row[4])

    // PDF内容(PDFKitで抽出): 書類番号・自社情報・取引先・明細・税率別集計・合計
    const { pages, text } = pdfText(pdfPath)
    noteEvidence(
      'TC-48',
      '見積書PDFから抽出したテキスト(PDFKit)と検証結果',
      `pages=${pages}\n${text}`.split(dataDir).join('<data-dir>')
    )
    expect(pages).toBe(1)
    for (const expected of [
      '2026-001',
      COMPANY.name,
      COMPANY.address,
      COMPANY.invoiceRegistrationNumber,
      '確定確認商事',
      '設計業務',
      '軽減税率の資料',
      '34,080',
      '確定テストの備考',
      '2026年10月31日'
    ]) {
      expect(text, `PDFに「${expected}」が含まれる`).toContain(expected)
    }
    pdfToPng(pdfPath, evidenceFilePath('TC-48', 'PDF1ページ目の画像(sipsで変換)', 'png'))

    // PDF保存済みは編集不可(画面外のIPC経路でも拒否される)
    const id = Number(dbQuery(dataDir, 'SELECT id FROM quotes'))
    const message = await window.evaluate(async (quoteId) => {
      try {
        await window.jimuhubApi.saveQuoteDraft({
          id: quoteId,
          clientId: 1,
          issueDate: '2026-10-02',
          validUntil: '',
          remarks: '',
          lineItems: [{ name: 'x', quantity: 1, unit: '', unitPrice: 1, taxRate: 10 }]
        })
        return 'no-error'
      } catch (e) {
        return String(e)
      }
    }, id)
    expect(message).toContain('PDF保存済みの見積書は編集できません')
    expect(dbQuery(dataDir, 'SELECT COUNT(*), MAX(total_amount) FROM quotes')).toBe('1|34080')
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
