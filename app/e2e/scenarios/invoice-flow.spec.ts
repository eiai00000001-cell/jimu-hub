import { test, expect } from '@playwright/test'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/electron-app'
import { evidenceFilePath, noteEvidence, shot } from './evidence-dir'
import {
  COMPANY,
  createClientApi,
  dbQuery,
  finalizeQuoteApi,
  pdfText,
  pdfToPng,
  setupCompany,
  sha256File,
  todayIso
} from './helpers'

/**
 * 【tester作成】F-13(見積書→請求書変換)・F-14(請求書作成・PDF保存)・F-15(入金管理)・F-16(源泉徴収)
 * の画面シナリオ(TC-53〜TC-59)。
 * 参照元: 詳細設計書 3.12〜3.14章・4.13〜4.16章・8章
 */
test.describe('F-13〜F-16: 請求書', () => {
  let launched: LaunchedApp

  test.beforeEach(async () => {
    launched = await launchApp()
  })
  test.afterEach(async () => {
    await closeApp(launched)
  })

  const LINES = [
    { name: '設計業務', quantity: 2, unit: '式', unitPrice: 400000, taxRate: 10 as const },
    { name: '資料(軽減)', quantity: 1, unit: '部', unitPrice: 5000, taxRate: 8 as const }
  ]

  async function seedQuote(window: LaunchedApp['window']): Promise<number> {
    await setupCompany(window)
    const clientId = await createClientApi(window, '変換元商事株式会社', {
      furigana: 'ヘンカンモトショウジ'
    })
    await finalizeQuoteApi(window, clientId, '2026-10-02', LINES, '変換元の備考')
    return clientId
  }

  async function openList(window: LaunchedApp['window']): Promise<void> {
    await window.getByRole('button', { name: '見積書・請求書' }).click()
  }

  async function openQuoteDetail(window: LaunchedApp['window'], number: string): Promise<void> {
    await window.reload()
    await openList(window)
    await window.getByRole('cell', { name: number }).click()
    await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - 見積書詳細')
  }

  test('TC-53: 確定済み見積書を請求書(下書き)へ変換し、明細・取引先・備考を引き継ぐ。複数回変換も可能', async () => {
    const { window, dataDir } = launched
    const clientId = await seedQuote(window)
    await openQuoteDetail(window, '2026-001')
    await window.getByRole('button', { name: '請求書に変換' }).click()

    await expect(window.getByText('見積書から請求書(下書き)を作成しました')).toBeVisible()
    await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - 請求書詳細')
    await expect(window.getByText('元の見積書')).toBeVisible()
    await expect(window.getByText('変換元商事株式会社').first()).toBeVisible()
    await expect(window.getByText('設計業務')).toBeVisible()
    await expect(window.getByText('変換元の備考')).toBeVisible()
    await expect(window.getByText('(未採番)').first()).toBeVisible()
    await expect(window.getByRole('button', { name: '編集' })).toBeVisible()
    await shot(window, 'TC-53', '変換直後の請求書詳細(下書き・未採番・元の見積書リンク)')

    expect(
      dbQuery(
        dataDir,
        "SELECT client_id,source_quote_id,issue_date,IFNULL(due_date,''),remarks,status,payment_status,total_amount,withholding_tax_amount FROM invoices"
      )
    ).toBe(`${clientId}|1|${todayIso()}||変換元の備考|draft|unpaid|885400|0`)
    expect(
      dbQuery(
        dataDir,
        'SELECT name,quantity,unit,unit_price,tax_rate,amount,withholding_target FROM invoice_line_items ORDER BY line_no'
      )
    ).toBe('設計業務|2.0|式|400000|10|800000|0\n資料(軽減)|1.0|部|5000|8|5000|0')
    expect(dbQuery(dataDir, 'SELECT status,quote_number,total_amount FROM quotes')).toBe(
      'finalized|2026-001|885400'
    )

    // 「元の見積書」リンクで見積書詳細へ戻れる
    await window.getByRole('button', { name: '2026-001 を見る' }).click()
    await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - 見積書詳細')
    await expect(window.getByText('2026-001').first()).toBeVisible()

    // 同じ見積書から再度変換すると、別の請求書が作られる(重複作成を許容)
    await window.getByRole('button', { name: '請求書に変換' }).click()
    await expect(window.getByText('見積書から請求書(下書き)を作成しました')).toBeVisible()
    expect(dbQuery(dataDir, 'SELECT COUNT(*), COUNT(DISTINCT id) FROM invoices')).toBe('2|2')
    expect(dbQuery(dataDir, 'SELECT COUNT(*) FROM invoice_line_items')).toBe('4')

    // 変換した下書き請求書の編集画面にも元の見積書リンクが出る
    await window.getByRole('button', { name: '編集' }).click()
    await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - 請求書を作成')
    await expect(window.getByText('見積書 2026-001 から変換して作成しています。')).toBeVisible()
    await expect(window.getByLabel('品名1')).toHaveValue('設計業務')
    await expect(window.getByLabel('源泉徴収対象1')).not.toBeChecked()
    await shot(window, 'TC-53', '変換元がある請求書の編集画面(元の見積書を見るリンク)')
  })

  test('TC-54: 下書きの見積書は変換不可。利用停止の取引先でも既存見積書の変換は可能で、新規作成の選択肢には出ない', async () => {
    const { window, dataDir } = launched
    const clientId = await seedQuote(window)

    // 下書き見積書には「請求書に変換」ボタンがない + IPCでも拒否される
    const draftId = await window.evaluate(async (c) => {
      const r = await window.jimuhubApi.saveQuoteDraft({
        clientId: c,
        issueDate: '2026-10-03',
        validUntil: '',
        remarks: '',
        lineItems: [{ name: '下書き', quantity: 1, unit: '', unitPrice: 1000, taxRate: 10 }]
      })
      return r.id
    }, clientId)
    const err = await window.evaluate(async (id) => {
      try {
        await window.jimuhubApi.convertQuoteToInvoice(id)
        return 'no-error'
      } catch (e) {
        return String(e)
      }
    }, draftId)
    expect(err).toContain('PDF保存済みの見積書のみ請求書に変換できます')
    noteEvidence('TC-54', '下書き見積書の変換をIPCで試みた結果', err)
    expect(dbQuery(dataDir, 'SELECT COUNT(*) FROM invoices')).toBe('0')

    // 取引先を利用停止にしても、既存の見積書は変換できる(F-13 手順3)
    await window.evaluate((c) => window.jimuhubApi.deactivateClient(c), clientId)
    await openQuoteDetail(window, '2026-001')
    await window.getByRole('button', { name: '請求書に変換' }).click()
    await expect(window.getByText('見積書から請求書(下書き)を作成しました')).toBeVisible()
    expect(dbQuery(dataDir, 'SELECT COUNT(*) FROM invoices')).toBe('1')
    await shot(window, 'TC-54', '利用停止の取引先の見積書でも請求書へ変換できる')

    // 新規作成画面の取引先選択肢には利用停止の取引先が出ない(F-08 手順6)
    await window.getByText('一覧へ戻る').click()
    await window.getByRole('button', { name: /請求書を新規作成|見積書を新規作成/ }).click()
    await expect(window.locator('#quote-client option')).toHaveCount(1)
    await shot(window, 'TC-54', '新規作成の取引先選択肢に利用停止の取引先が表示されない')
  })

  test('TC-55/TC-56: 請求書を新規作成し、下書き保存→編集→PDF保存(採番・PDF内容・編集不可)。登録番号なしは区分記載形式', async () => {
    const { window, dataDir } = launched
    await setupCompany(window)
    await createClientApi(window, '請求先商事株式会社')
    await window.reload()
    await openList(window)
    await window.getByRole('button', { name: '請求書', exact: true }).click()
    await window.getByRole('button', { name: '+ 請求書を新規作成' }).click()
    await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - 請求書を作成')
    await window
      .locator('#invoice-client, [aria-label="取引先"]')
      .first()
      .selectOption({ label: '請求先商事株式会社' })
    await window.getByLabel('発行日').fill('2026-10-02')
    await window.getByLabel('支払期限').fill('2026-11-30')
    await window.getByLabel('品名1').fill('保守作業')
    await window.getByLabel('数量1').fill('1')
    await window.getByLabel('単価1').fill('100000')
    await window.getByLabel('備考').fill('お振込手数料はご負担ください')

    // 下書き保存→詳細(未採番)→編集→更新
    await window.getByRole('button', { name: '下書き保存' }).click()
    await expect(window.getByText('請求書を下書き保存しました')).toBeVisible()
    await expect(window.getByText('(未採番)').first()).toBeVisible()
    await expect(window.getByRole('button', { name: '入金済みにする' })).toHaveCount(0)
    await shot(window, 'TC-56', '請求書の下書き保存後(未採番・入金操作なし)')
    expect(
      dbQuery(dataDir, 'SELECT status,invoice_number IS NULL,total_amount,due_date FROM invoices')
    ).toBe('draft|1|110000|2026-11-30')
    await window.getByRole('button', { name: '編集' }).click()
    await window.getByLabel('単価1').fill('200000')
    await window.getByRole('button', { name: '下書き保存' }).click()
    await expect(window.getByText('請求書を下書き保存しました')).toBeVisible()
    expect(dbQuery(dataDir, 'SELECT COUNT(*), MAX(total_amount) FROM invoices')).toBe('1|220000')

    // PDF保存(登録番号なしの自社: 区分記載形式)
    await window.evaluate(() =>
      window.jimuhubApi.saveCompanyProfile({
        name: '登録番号なし事務所',
        address: '東京都(架空)',
        invoiceRegistrationNumber: '',
        bankName: '架空銀行',
        bankBranch: '試験支店',
        accountType: '普通',
        accountNumber: '7654321',
        accountHolder: 'シケン'
      })
    )
    await window.getByRole('button', { name: '編集' }).click()
    await window.getByRole('button', { name: 'PDFとして保存' }).click()
    await expect(window.getByText('PDFとして保存しました')).toBeVisible()
    await expect(window.getByText('2026-001').first()).toBeVisible()
    await expect(window.getByRole('button', { name: '編集' })).toHaveCount(0)
    await expect(window.getByRole('button', { name: '入金済みにする' })).toBeVisible()
    await shot(window, 'TC-55', 'PDF保存後の請求書詳細(請求書番号2026-001・未収・入金済みにする)')

    const row = dbQuery(
      dataDir,
      'SELECT invoice_number,invoice_format,status,payment_status,pdf_path,pdf_hash,pdf_hash_mismatch FROM invoices'
    ).split('|')
    expect(row.slice(0, 4).join('|')).toBe('2026-001|classified|finalized|unpaid')
    const pdfPath = row[4] as string
    expect(pdfPath).toContain(join(dataDir, 'documents', 'invoices', '2026'))
    expect(existsSync(pdfPath)).toBe(true)
    expect(sha256File(pdfPath)).toBe(row[5])
    const { pages, text } = pdfText(pdfPath)
    noteEvidence('TC-55', '請求書PDFから抽出したテキスト(PDFKit)', `pages=${pages}\n${text}`)
    for (const s of [
      '2026-001',
      '登録番号なし事務所',
      '請求先商事株式会社',
      '保守作業',
      '220,000',
      'お振込先',
      '架空銀行',
      '7654321',
      '2026年11月30日',
      'お振込手数料はご負担ください'
    ]) {
      expect(text, `請求書PDFに「${s}」が含まれる`).toContain(s)
    }
    expect(text).not.toContain('登録番号:')
    pdfToPng(pdfPath, evidenceFilePath('TC-55', 'PDF1ページ目の画像(sipsで変換)', 'png'))

    // 請求書の系列は見積書と別(請求書2026-001は見積書の有無に影響しない)
    expect(
      dbQuery(dataDir, 'SELECT doc_type,year,last_number FROM document_number_sequences')
    ).toBe('invoice|2026|1')

    // 確定後はIPCでも編集不可
    const id = Number(dbQuery(dataDir, 'SELECT id FROM invoices'))
    const err = await window.evaluate(async (i) => {
      try {
        await window.jimuhubApi.saveInvoiceDraft({
          id: i,
          clientId: 1,
          issueDate: '2026-10-02',
          dueDate: '',
          remarks: '',
          lineItems: [
            {
              name: 'x',
              quantity: 1,
              unit: '',
              unitPrice: 1,
              taxRate: 10,
              withholdingTarget: false
            }
          ]
        })
        return 'no-error'
      } catch (e) {
        return String(e)
      }
    }, id)
    expect(err).toContain('PDF保存済みの請求書は編集できません')
  })

  test('TC-57/TC-58: 入金管理(入金日必須・入金済み/未収へ戻す・一覧フィルタ・トップ件数・下書きは操作不可)', async () => {
    const { window, dataDir } = launched
    await setupCompany(window)
    const clientId = await createClientApi(window, '入金確認商事')
    const mk = (n: number): Promise<{ id: number }> =>
      window.evaluate(
        async ([c, num]) =>
          window.jimuhubApi.finalizeInvoice({
            clientId: c,
            issueDate: '2026-10-0' + num,
            dueDate: '',
            remarks: '',
            lineItems: [
              {
                name: '作業' + num,
                quantity: 1,
                unit: '',
                unitPrice: 10000 * num,
                taxRate: 10,
                withholdingTarget: false
              }
            ]
          }),
        [clientId, n] as const
      )
    const a = await mk(1)
    await mk(2)
    const draft = await window.evaluate(
      async (c) =>
        window.jimuhubApi.saveInvoiceDraft({
          clientId: c,
          issueDate: '2026-10-05',
          dueDate: '',
          remarks: '',
          lineItems: [
            {
              name: '下書き',
              quantity: 1,
              unit: '',
              unitPrice: 500,
              taxRate: 10,
              withholdingTarget: false
            }
          ]
        }),
      clientId
    )

    // トップの件数: 請求書3件、未収=確定済み未入金の2件(下書きは含めない)
    await window.reload()
    await expect(
      window
        .locator('.summary-card')
        .filter({ has: window.getByText('請求書件数', { exact: true }) })
        .locator('.summary-value')
    ).toHaveText('3件')
    await expect(
      window
        .locator('.summary-card')
        .filter({ has: window.getByText('未収の請求書件数', { exact: true }) })
        .locator('.summary-value')
    ).toHaveText('2件')
    await shot(window, 'TC-57', 'トップ画面: 請求書3件・未収2件(下書きは含めない)')

    await openList(window)
    await window.getByRole('button', { name: '請求書', exact: true }).click()
    await window.getByRole('cell', { name: '2026-001' }).click()
    await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - 請求書詳細')

    // 入金日を空にして確定 → エラー
    await window.getByRole('button', { name: '入金済みにする' }).click()
    await expect(window.getByLabel('入金日')).toHaveValue(todayIso())
    await window.getByLabel('入金日').fill('')
    await window.getByRole('button', { name: '確定' }).click()
    await expect(window.getByText('入金日を入力してください')).toBeVisible()
    await shot(window, 'TC-58', '入金日未入力で確定するとエラー')
    expect(dbQuery(dataDir, 'SELECT payment_status FROM invoices WHERE id=' + a.id)).toBe('unpaid')

    // キャンセルでは何も変わらない
    await window.getByRole('button', { name: 'キャンセル' }).click()
    await expect(window.getByRole('button', { name: '入金済みにする' })).toBeVisible()

    // 入金日を入れて確定
    await window.getByRole('button', { name: '入金済みにする' }).click()
    await window.getByLabel('入金日').fill('2026-10-20')
    await window.getByRole('button', { name: '確定' }).click()
    await expect(window.getByText('入金済みにしました')).toBeVisible()
    await expect(window.getByText('入金日: 2026-10-20')).toBeVisible()
    await shot(window, 'TC-57', '入金済みにした直後(入金日表示・未収に戻す)')
    expect(
      dbQuery(dataDir, 'SELECT payment_status,payment_date FROM invoices WHERE id=' + a.id)
    ).toBe('paid|2026-10-20')

    // 一覧の入金ステータスフィルタ
    await window.getByText('一覧へ戻る').click()
    await window.getByRole('button', { name: '請求書', exact: true }).click()
    await window.locator('#doc-list-payment-status').selectOption('paid')
    await expect(window.locator('tbody tr')).toHaveCount(1)
    await window.locator('#doc-list-payment-status').selectOption('unpaid')
    await expect(window.locator('tbody tr')).toHaveCount(2) // 確定済み未収1件+下書き1件(下書きも未収として保持)
    await shot(window, 'TC-57', '一覧の入金ステータスフィルタ(未収)')

    // トップの未収件数へ反映(2→1)
    await window.getByRole('button', { name: 'ホーム' }).click()
    await expect(
      window
        .locator('.summary-card')
        .filter({ has: window.getByText('未収の請求書件数', { exact: true }) })
        .locator('.summary-value')
    ).toHaveText('1件')

    // 未収に戻す: 「いいえ」で何も変わらず、「はい」で未収へ(入金日クリア)
    await openList(window)
    await window.getByRole('button', { name: '請求書', exact: true }).click()
    await window.getByRole('cell', { name: '2026-001' }).click()
    await window.getByRole('button', { name: '未収に戻す' }).click()
    await expect(window.getByText('未収に戻しますか')).toBeVisible()
    await window.getByRole('button', { name: 'いいえ' }).click()
    expect(dbQuery(dataDir, 'SELECT payment_status FROM invoices WHERE id=' + a.id)).toBe('paid')
    await window.getByRole('button', { name: '未収に戻す' }).click()
    await window.getByRole('button', { name: 'はい' }).click()
    await expect(window.getByText('未収に戻しました')).toBeVisible()
    expect(
      dbQuery(
        dataDir,
        "SELECT payment_status,IFNULL(payment_date,'NULL') FROM invoices WHERE id=" + a.id
      )
    ).toBe('unpaid|NULL')
    await shot(window, 'TC-57', '未収に戻した直後')

    // TC-58: 画面外(IPC)の不正操作は拒否される(下書き請求書への入金、不正な日付、入金日なし)
    const call = (id: number, input: Record<string, unknown>): Promise<string> =>
      window.evaluate(
        async ([i, inp]) => {
          try {
            await window.jimuhubApi.updateInvoicePaymentStatus(i as number, inp as never)
            return 'no-error'
          } catch (e) {
            return String(e)
          }
        },
        [id, input] as const
      )
    expect(await call(draft.id, { paymentStatus: 'paid', paymentDate: '2026-10-20' })).toContain(
      'PDF保存済みの請求書のみ入金ステータスを変更できます'
    )
    expect(await call(a.id, { paymentStatus: 'paid', paymentDate: '2026-02-30' })).toContain(
      '日付は「YYYY-MM-DD」形式の正しい日付で入力してください'
    )
    expect(await call(a.id, { paymentStatus: 'paid', paymentDate: '' })).toContain(
      '入金日を入力してください'
    )
    expect(await call(999, { paymentStatus: 'paid', paymentDate: '2026-10-20' })).toContain(
      '対象の請求書が見つかりません'
    )
    expect(dbQuery(dataDir, 'SELECT payment_status FROM invoices WHERE id=' + draft.id)).toBe(
      'unpaid'
    )
    noteEvidence(
      'TC-58',
      'IPC経由の不正な入金ステータス更新がすべて拒否されたこと',
      '下書き請求書への入金/不正な日付/入金日なし/存在しないID: いずれも文言どおりのエラーとなり、DBは変化なし'
    )
  })

  test('TC-59: 源泉徴収税額の計算と請求金額(UI・PDF・DB)。対象行の合計に対して段階計算を1回適用する', async () => {
    const { window, dataDir } = launched
    await setupCompany(window)
    await createClientApi(window, '源泉確認商事')
    await window.reload()
    await openList(window)
    await window.getByRole('button', { name: '請求書', exact: true }).click()
    await window.getByRole('button', { name: '+ 請求書を新規作成' }).click()
    await window.locator('[aria-label="取引先"]').first().selectOption({ label: '源泉確認商事' })
    await window.getByLabel('品名1').fill('デザイン費A')
    await window.getByLabel('単価1').fill('800000')
    await window.getByRole('button', { name: '+ 行を追加' }).click()
    await window.getByLabel('品名2').fill('デザイン費B')
    await window.getByLabel('単価2').fill('800000')
    await window.getByRole('button', { name: '+ 行を追加' }).click()
    await window.getByLabel('品名3').fill('実費(対象外)')
    await window.getByLabel('単価3').fill('10000')

    // 対象なし: 源泉徴収0円
    await expect(
      window.locator('.totals-row', { hasText: '源泉徴収税額' }).locator('.val')
    ).toHaveText('-¥0')
    await window.getByLabel('源泉徴収対象1').check()
    // 80万円のみ: floor(800000*0.1021)=81680
    await expect(
      window.locator('.totals-row', { hasText: '源泉徴収税額' }).locator('.val')
    ).toHaveText('-¥81,680')
    await window.getByLabel('源泉徴収対象2').check()
    // 80万+80万=160万 → 102,100 + 600,000*0.2042=122,520 → 224,620(行ごとの合算161,360ではない)
    await expect(
      window.locator('.totals-row', { hasText: '源泉徴収税額' }).locator('.val')
    ).toHaveText('-¥224,620')
    // 合計金額=(1,610,000)*1.1=1,771,000、請求金額=1,771,000-224,620=1,546,380
    await expect(window.locator('.totals-row', { hasText: '合計金額' }).locator('.val')).toHaveText(
      '¥1,771,000'
    )
    await expect(window.locator('.totals-row.grand .val')).toHaveText('¥1,546,380')
    await shot(
      window,
      'TC-59',
      '源泉徴収対象2行(合計160万円)の再計算表示: 224,620円・請求金額1,546,380円'
    )

    await window.getByRole('button', { name: 'PDFとして保存' }).click()
    await expect(window.getByText('PDFとして保存しました')).toBeVisible()
    await expect(window.getByText('-¥224,620')).toBeVisible()
    await shot(window, 'TC-59', '詳細画面の源泉徴収税額・請求金額')

    expect(
      dbQuery(dataDir, 'SELECT total_amount,withholding_tax_amount,billing_amount FROM invoices')
    ).toBe('1771000|224620|1546380')
    // 行単位の列は常に0(差異No.10)、対象フラグは保持される
    expect(
      dbQuery(
        dataDir,
        'SELECT group_concat(withholding_target||":"||withholding_amount) FROM invoice_line_items'
      )
    ).toBe('1:0,1:0,0:0')

    const pdfPath = dbQuery(dataDir, 'SELECT pdf_path FROM invoices')
    const { text } = pdfText(pdfPath)
    noteEvidence('TC-59', '源泉徴収ありの請求書PDFテキスト', text)
    expect(text).toContain('源泉徴収税額')
    expect(text).toContain('224,620')
    expect(text).toContain('1,546,380')
    pdfToPng(pdfPath, evidenceFilePath('TC-59', 'PDF1ページ目の画像(sipsで変換)', 'png'))
    rmSync(join(dataDir, 'noop'), { force: true })
    expect(COMPANY.name).toBeTruthy()
  })
})
