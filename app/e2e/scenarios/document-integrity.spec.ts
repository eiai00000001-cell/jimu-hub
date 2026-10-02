import { test, expect } from '@playwright/test'
import { chmodSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/electron-app'
import { noteEvidence, shot } from './evidence-dir'
import {
  createClientApi,
  dbQuery,
  finalizeInvoiceApi,
  finalizeQuoteApi,
  setupCompany,
  type LineSpec
} from './helpers'

/**
 * 【tester作成】見積書・請求書のデータ整合性・異常系シナリオ(TC-49〜TC-52、TC-60、TC-61)。
 * 参照元: 詳細設計書 4.12〜4.16章・6章(DB詳細設計)・8章(エラーハンドリング設計)
 */
test.describe('見積書・請求書: データ整合性・異常系', () => {
  let launched: LaunchedApp

  test.beforeEach(async () => {
    launched = await launchApp()
  })
  test.afterEach(async () => {
    // 読み取り専用にしたフォルダは、削除できるよう権限を戻す
    try {
      chmodSync(join(launched.dataDir, 'documents'), 0o755)
    } catch {
      /* 作成していない場合は何もしない */
    }
    await closeApp(launched)
  })

  const one = (name: string, unitPrice: number, quantity = 1, taxRate: 10 | 8 = 10): LineSpec => ({
    name,
    quantity,
    unitPrice,
    taxRate
  })

  test('TC-49: 金額計算(行金額・税率区分ごとの消費税・合計)が画面・DB・再取得で一致し、浮動小数点誤差が出ない', async () => {
    const { window, dataDir } = launched
    await setupCompany(window)
    const clientId = await createClientApi(window, '計算確認商事')

    const cases: Array<{
      title: string
      lines: LineSpec[]
      sub10: number
      tax10: number
      sub8: number
      tax8: number
    }> = [
      // 小数数量(I1-01): 1.15×100=115, 4.35×100=435, 0.07×100=7(浮動小数点では1円ずれる値)
      {
        title: '小数数量',
        lines: [one('a', 100, 1.15), one('b', 100, 4.35), one('c', 100, 0.07)],
        sub10: 557,
        tax10: 55,
        sub8: 0,
        tax8: 0
      },
      // 税額は税率区分ごとに1回だけ切り捨て(行ごとの切り捨て合計とは異なる): 15円×3行=45円→4円(行ごとなら3円)
      {
        title: '区分ごと1回切り捨て',
        lines: [one('a', 15), one('b', 15), one('c', 15)],
        sub10: 45,
        tax10: 4,
        sub8: 0,
        tax8: 0
      },
      // 8%と10%の混在・円未満切り捨て
      {
        title: '10%/8%混在',
        lines: [one('a', 1005), one('b', 99, 1, 8), one('c', 125, 1, 8)],
        sub10: 1005,
        tax10: 100,
        sub8: 224,
        tax8: 17
      },
      // 数量×単価の円未満切り捨て: 2.5×333=832.5 → 832
      {
        title: '円未満切り捨て',
        lines: [one('a', 333, 2.5)],
        sub10: 832,
        tax10: 83,
        sub8: 0,
        tax8: 0
      },
      // 単価0・大きな金額
      {
        title: '単価0と高額',
        lines: [one('a', 0), one('b', 99999999)],
        sub10: 99999999,
        tax10: 9999999,
        sub8: 0,
        tax8: 0
      }
    ]
    const report: string[] = []
    for (const c of cases) {
      const saved = await window.evaluate(
        async ([cid, lines]) => {
          const r = await window.jimuhubApi.saveQuoteDraft({
            clientId: cid as number,
            issueDate: '2026-10-02',
            validUntil: '',
            remarks: '',
            lineItems: (lines as LineSpec[]).map((l) => ({ unit: '', ...l }))
          })
          return window.jimuhubApi.getQuote(r.id)
        },
        [clientId, c.lines] as const
      )
      const expectedTotal = c.sub10 + c.tax10 + c.sub8 + c.tax8
      expect(
        [saved.subtotal10, saved.taxAmount10, saved.subtotal8, saved.taxAmount8, saved.totalAmount],
        c.title
      ).toEqual([c.sub10, c.tax10, c.sub8, c.tax8, expectedTotal])
      // DBの値とAPI再取得の値が一致する
      expect(
        dbQuery(
          dataDir,
          `SELECT subtotal_10,tax_amount_10,subtotal_8,tax_amount_8,total_amount FROM quotes WHERE id=${saved.id}`
        ),
        c.title
      ).toBe([c.sub10, c.tax10, c.sub8, c.tax8, expectedTotal].join('|'))
      // 明細行の金額合計(税抜)=区分小計の合計
      expect(
        Number(
          dbQuery(dataDir, `SELECT SUM(amount) FROM quote_line_items WHERE quote_id=${saved.id}`)
        ),
        c.title
      ).toBe(c.sub10 + c.sub8)
      report.push(
        `${c.title}: 10%小計${c.sub10}/税${c.tax10}、8%小計${c.sub8}/税${c.tax8}、合計${expectedTotal} → 一致`
      )
    }
    noteEvidence('TC-49', '金額計算ケースの期待値とDB・API再取得値の照合結果', report.join('\n'))

    // 画面表示の再計算(入力途中の値)も同じ結果になる
    await window.reload()
    await window.getByRole('button', { name: '見積書・請求書' }).click()
    await window.getByRole('button', { name: /見積書を新規作成/ }).click()
    await window.getByLabel('品名1').fill('a')
    await window.getByLabel('数量1').fill('4.35')
    await window.getByLabel('単価1').fill('100')
    await expect(window.locator('.col-amount').first()).toHaveText('¥435')
    await window.getByRole('button', { name: '+ 行を追加' }).click()
    await window.getByLabel('数量2').fill('1.15')
    await window.getByLabel('単価2').fill('100')
    await expect(
      window.locator('.totals-row', { hasText: '10%対象 小計' }).locator('.val')
    ).toHaveText('¥550')
    await expect(
      window.locator('.totals-row', { hasText: '10%対象 消費税額' }).locator('.val')
    ).toHaveText('¥55')
    await shot(window, 'TC-49', '小数数量の画面再計算(4.35×100=435円・1.15×100=115円)')
  })

  test('TC-50: 採番(暦年ごと・種別ごとの連番、下書きは未採番、年またぎで001から)', async () => {
    const { window, dataDir } = launched
    await setupCompany(window)
    const clientId = await createClientApi(window, '採番確認商事')
    const L = [one('作業', 1000)]

    // 下書きは採番しない
    await window.evaluate(
      async (c) =>
        window.jimuhubApi.saveQuoteDraft({
          clientId: c,
          issueDate: '2026-01-05',
          validUntil: '',
          remarks: '',
          lineItems: [{ name: 'd', quantity: 1, unit: '', unitPrice: 1, taxRate: 10 }]
        }),
      clientId
    )
    expect(dbQuery(dataDir, 'SELECT COUNT(*) FROM document_number_sequences')).toBe('0')

    const q1 = await finalizeQuoteApi(window, clientId, '2026-01-05', L)
    const q2 = await finalizeQuoteApi(window, clientId, '2026-12-31', L)
    const q3 = await finalizeQuoteApi(window, clientId, '2027-01-01', L) // 年が変わると001から
    const q4 = await finalizeQuoteApi(window, clientId, '2026-03-01', L) // 発行日基準で2026の続き
    const i1 = await finalizeInvoiceApi(window, clientId, '2026-01-05', L) // 請求書は別系列
    const i2 = await finalizeInvoiceApi(window, clientId, '2027-02-01', L)
    expect([q1.quoteNumber, q2.quoteNumber, q3.quoteNumber, q4.quoteNumber]).toEqual([
      '2026-001',
      '2026-002',
      '2027-001',
      '2026-003'
    ])
    expect([i1.invoiceNumber, i2.invoiceNumber]).toEqual(['2026-001', '2027-001'])
    expect(
      dbQuery(
        dataDir,
        'SELECT doc_type,year,last_number FROM document_number_sequences ORDER BY doc_type,year'
      )
    ).toBe('invoice|2026|1\ninvoice|2027|1\nquote|2026|3\nquote|2027|1')
    // 書類番号はUNIQUE(重複なし)
    expect(
      dbQuery(
        dataDir,
        'SELECT COUNT(*), COUNT(DISTINCT quote_number) FROM quotes WHERE quote_number IS NOT NULL'
      )
    ).toBe('4|4')
    // PDFの保存先の年・ファイル名が書類番号と一致
    expect(q3.pdfPath).toContain(join('documents', 'quotes', '2027', '2027-001_採番確認商事.pdf'))
    expect(i1.pdfPath).toContain(join('documents', 'invoices', '2026', '2026-001_採番確認商事.pdf'))
    expect(existsSync(q3.pdfPath) && existsSync(i1.pdfPath)).toBe(true)
    noteEvidence(
      'TC-50',
      '採番結果',
      `見積書: ${[q1, q2, q3, q4].map((q) => q.quoteNumber).join(', ')}\n請求書: ${i1.invoiceNumber}, ${i2.invoiceNumber}\n${dbQuery(dataDir, 'SELECT doc_type,year,last_number FROM document_number_sequences ORDER BY doc_type,year')}`
    )
  })

  test('TC-51: PDF保存に失敗した場合は下書きへ戻り(補償処理)、書類番号は欠番となり、復旧後の再確定は次の番号になる', async () => {
    const { window, dataDir } = launched
    await setupCompany(window)
    const clientId = await createClientApi(window, '補償処理確認商事')
    await window.reload()

    // documentsフォルダを書き込み不可にして、PDF保存を失敗させる
    const docs = join(dataDir, 'documents')
    mkdirSync(docs, { recursive: true })
    chmodSync(docs, 0o500)

    await window.getByRole('button', { name: '見積書・請求書' }).click()
    await window.getByRole('button', { name: /見積書を新規作成/ }).click()
    await window.locator('#quote-client').selectOption({ label: '補償処理確認商事' })
    await window.getByLabel('品名1').fill('失敗する確定')
    await window.getByLabel('単価1').fill('1000')
    await window.getByRole('button', { name: 'PDFとして保存' }).click()
    await expect(window.getByText('PDFの保存に失敗しました')).toBeVisible()
    await shot(window, 'TC-51', 'PDF保存失敗時のエラー表示(書込不可のdocumentsフォルダ)')
    // 下書きへ戻っている: 番号NULL・状態draft・PDFなし。採番カウンタは進んだまま(欠番)
    expect(
      dbQuery(
        dataDir,
        'SELECT status,quote_number IS NULL,pdf_path IS NULL,invoice_format IS NULL FROM quotes'
      )
    ).toBe('draft|1|1|1')
    expect(dbQuery(dataDir, 'SELECT last_number FROM document_number_sequences')).toBe('1')
    // 画面は作成画面に留まり、入力は失われない
    await expect(window.getByLabel('品名1')).toHaveValue('失敗する確定')

    // 権限を戻して再確定すると、欠番(001)の次の002が採番される
    chmodSync(docs, 0o755)
    await window.getByRole('button', { name: 'PDFとして保存' }).click()
    await expect(window.getByText('PDFとして保存しました')).toBeVisible()
    const year = String(new Date().getFullYear())
    expect(
      dbQuery(dataDir, 'SELECT status,quote_number FROM quotes WHERE quote_number IS NOT NULL')
    ).toBe(`finalized|${year}-002`)
    // BUG-01: 新規作成画面でPDF保存に失敗すると、下書きとして保存済みのレコードのIDを画面が保持しないため、
    // 再度「PDFとして保存」すると別の見積書が作られ、未採番の下書きが重複して残る
    const countAfterRetry = dbQuery(dataDir, 'SELECT COUNT(*) FROM quotes')
    noteEvidence(
      'TC-51',
      '再確定後のquotes件数と内訳(BUG-01確認)',
      `quotes件数=${countAfterRetry}\n${dbQuery(dataDir, "SELECT id,status,IFNULL(quote_number,'(未採番)') FROM quotes")}`
    )
    await window.getByText('一覧へ戻る').click()
    await shot(window, 'TC-51', '再確定後の見積書一覧(未採番の下書きが重複して残る: BUG-01)')
    expect.soft(countAfterRetry, 'BUG-01: 失敗後の再確定で未採番の下書きが重複して残る').toBe('1')
    await shot(window, 'TC-51', '復旧後の再確定(書類番号は欠番の次の番号)')
    expect(clientId).toBeGreaterThan(0)
  })

  test('TC-52: 画面外(IPC)からの不正入力・不正な状態遷移はService層で拒否される(日付形式・存在しないID等)', async () => {
    const { window, dataDir } = launched
    await setupCompany(window)
    const clientId = await createClientApi(window, 'ガード確認商事')
    const err = (fn: string, arg: unknown): Promise<string> =>
      window.evaluate(
        async ([f, a]) => {
          try {
            await (
              window.jimuhubApi as unknown as Record<string, (x: unknown) => Promise<unknown>>
            )[f as string]!(a)
            return 'no-error'
          } catch (e) {
            return String(e)
          }
        },
        [fn, arg] as const
      )
    const base = {
      clientId,
      issueDate: '2026-10-02',
      validUntil: '',
      remarks: '',
      lineItems: [{ name: 'x', quantity: 1, unit: '', unitPrice: 1, taxRate: 10 }]
    }
    const log: string[] = []
    const check = async (
      label: string,
      fn: string,
      arg: unknown,
      expected: string
    ): Promise<void> => {
      const message = await err(fn, arg)
      log.push(`${label}: ${message.replace(/^Error invoking remote method '[^']+': /, '')}`)
      expect(message, label).toContain(expected)
    }
    const dateMsg = '日付は「YYYY-MM-DD」形式の正しい日付で入力してください'
    await check(
      '見積書 発行日が存在しない日付',
      'saveQuoteDraft',
      { ...base, issueDate: '2026-02-30' },
      dateMsg
    )
    await check(
      '見積書 発行日の形式違い',
      'saveQuoteDraft',
      { ...base, issueDate: '2026/10/02' },
      dateMsg
    )
    await check(
      '見積書 有効期限が不正',
      'finalizeQuote',
      { ...base, validUntil: '2026-13-01' },
      dateMsg
    )
    await check(
      '請求書 支払期限が不正',
      'saveInvoiceDraft',
      {
        ...base,
        dueDate: '20261001',
        lineItems: [{ ...base.lineItems[0], withholdingTarget: false }]
      },
      dateMsg
    )
    await check(
      '見積書 存在しないIDの更新',
      'saveQuoteDraft',
      { ...base, id: 9999 },
      '対象の見積書が見つかりません'
    )
    await check(
      '請求書 存在しないIDの更新',
      'saveInvoiceDraft',
      {
        ...base,
        id: 9999,
        dueDate: '',
        lineItems: [{ ...base.lineItems[0], withholdingTarget: false }]
      },
      '対象の請求書が見つかりません'
    )
    await check(
      '存在しない見積書の変換',
      'convertQuoteToInvoice',
      9999,
      '対象の見積書が見つかりません'
    )
    await check(
      '明細行なし',
      'saveQuoteDraft',
      { ...base, lineItems: [] },
      '明細行を1行以上入力してください'
    )
    await check(
      '取引先なし(0)',
      'saveQuoteDraft',
      { ...base, clientId: 0 },
      '取引先を選択してください'
    )
    expect(
      dbQuery(
        dataDir,
        'SELECT (SELECT COUNT(*) FROM quotes)||"|"||(SELECT COUNT(*) FROM invoices)||"|"||(SELECT COUNT(*) FROM document_number_sequences)'
      )
    ).toBe('0|0|0')
    noteEvidence('TC-52', 'IPC経由の不正入力が拒否された結果(DBは変化なし)', log.join('\n'))
  })

  test('TC-60: 源泉徴収税額の境界値(100万円の前後・端数・対象なし)がDB保存値まで正しい', async () => {
    const { window, dataDir } = launched
    await setupCompany(window)
    const clientId = await createClientApi(window, '源泉境界商事')
    const cases: Array<[number, number]> = [
      [0, 0],
      [1, 0],
      [9, 0],
      [10, 1],
      [1000000, 102100],
      [1000001, 102100],
      [1000005, 102101],
      [1600000, 224620],
      [2000000, 306300],
      [99999999, Math.floor(1000000 * 0.1021 + (99999999 - 1000000) * 0.2042)]
    ]
    const report: string[] = []
    for (const [amount, expected] of cases) {
      const r = await window.evaluate(
        async ([c, amt]) => {
          const saved = await window.jimuhubApi.saveInvoiceDraft({
            clientId: c as number,
            issueDate: '2026-10-02',
            dueDate: '',
            remarks: '',
            lineItems: [
              {
                name: '対象',
                quantity: 1,
                unit: '',
                unitPrice: amt as number,
                taxRate: 10,
                withholdingTarget: (amt as number) > 0
              },
              {
                name: '対象外',
                quantity: 1,
                unit: '',
                unitPrice: 777,
                taxRate: 10,
                withholdingTarget: false
              }
            ]
          })
          return window.jimuhubApi.getInvoice(saved.id)
        },
        [clientId, amount] as const
      )
      expect(r.withholdingTaxAmount, `対象額${amount}`).toBe(expected)
      const total = r.totalAmount
      expect(r.billingAmount, `対象額${amount}の請求金額`).toBe(total - expected)
      expect(
        dbQuery(
          dataDir,
          `SELECT withholding_tax_amount,billing_amount FROM invoices WHERE id=${r.id}`
        )
      ).toBe(`${expected}|${total - expected}`)
      report.push(
        `対象額(税抜)${amount} → 源泉徴収税額${expected}(DB一致)、請求金額${total - expected}`
      )
    }
    // 行単位の源泉徴収額列は未使用(常に0)
    expect(
      dbQuery(dataDir, 'SELECT COUNT(*) FROM invoice_line_items WHERE withholding_amount <> 0')
    ).toBe('0')
    noteEvidence(
      'TC-60',
      '源泉徴収税額の境界値(対象額→税額→請求金額)とDB保存値の照合結果',
      report.join('\n')
    )
  })

  test('TC-61: 見積書・請求書一覧の検索条件(取引先・発行日・金額・入金ステータス)と空表示', async () => {
    const { window } = launched
    await setupCompany(window)
    const a = await createClientApi(window, '一覧A商事')
    const b = await createClientApi(window, '一覧B商事')
    await finalizeQuoteApi(window, a, '2026-01-10', [one('x', 10000)]) // 11,000
    await finalizeQuoteApi(window, b, '2026-02-10', [one('x', 50000)]) // 55,000
    await finalizeQuoteApi(window, a, '2026-03-10', [one('x', 100000)]) // 110,000
    await finalizeInvoiceApi(window, a, '2026-01-15', [one('x', 20000)])
    await finalizeInvoiceApi(window, b, '2026-02-15', [one('x', 30000)])
    await window.reload()
    await window.getByRole('button', { name: '見積書・請求書' }).click()
    const rows = window.locator('tbody tr')
    await expect(rows).toHaveCount(3)
    await shot(window, 'TC-61', '見積書一覧(3件・既定)')

    await window.locator('#doc-list-client').selectOption({ label: '一覧A商事' })
    await expect(rows).toHaveCount(2)
    await window.locator('#doc-list-client').selectOption('')
    await window.getByLabel('発行日(開始)').fill('2026-02-01')
    await window.getByLabel('発行日(終了)').fill('2026-03-31')
    await expect(rows).toHaveCount(2)
    await window.getByLabel('金額(下限)').fill('100000')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('2026-003')
    await shot(window, 'TC-61', '発行日範囲+金額下限の絞り込み(1件)')
    await window.getByLabel('金額(上限)').fill('1000')
    await expect(window.getByText('該当する見積書がありません')).toBeVisible()
    await shot(window, 'TC-61', '該当なし時の案内文言')

    // 請求書タブ
    await window.getByLabel('発行日(開始)').fill('')
    await window.getByLabel('発行日(終了)').fill('')
    await window.getByLabel('金額(下限)').fill('')
    await window.getByLabel('金額(上限)').fill('')
    await window.getByRole('button', { name: '請求書', exact: true }).click()
    await expect(rows).toHaveCount(2)
    await window.locator('#doc-list-client').selectOption({ label: '一覧B商事' })
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('¥33,000')
    await shot(window, 'TC-61', '請求書タブ+取引先絞り込み')

    // 詳細設計書3.10章: 範囲の逆転(終了日<開始日、上限<下限)はエラー表示となる設計
    await window.locator('#doc-list-client').selectOption('')
    await window.getByLabel('発行日(開始)').fill('2026-03-01')
    await window.getByLabel('発行日(終了)').fill('2026-01-01')
    await window.getByLabel('金額(下限)').fill('50000')
    await window.getByLabel('金額(上限)').fill('1000')
    const inverted = await window.locator('.error-message, .message-error, [role="alert"]').count()
    await shot(window, 'TC-61', '範囲逆転(終了日<開始日・上限<下限)を入力した状態')
    noteEvidence(
      'TC-61',
      '範囲逆転入力時のエラー表示要素数(設計: 3.10章でエラー)',
      `エラー表示要素数=${inverted}\n画面本文:\n${await window.locator('.main, main, body').first().innerText()}`
    )
    expect
      .soft(inverted, 'BUG-02: 範囲逆転時にエラー表示が出る(詳細設計書3.10章)')
      .toBeGreaterThan(0)
  })
})
