import { test, expect, type Page } from '@playwright/test'
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/electron-app'
import { noteEvidence, shot } from './evidence-dir'
import { createClientApi, finalizeInvoiceApi, finalizeQuoteApi, setupCompany } from './helpers'

/**
 * 【tester作成】機能横断・結合確認(観点5): トップ画面の件数連動(TC-39)、新規画面の
 * タイトルバー・サイドバー・デザインガイド適合(TC-73)。
 * 参照元: 詳細設計書 3.1章・3.9〜3.14章・4.1章、デザインガイド.md 5章
 */
function card(window: Page, label: string): ReturnType<Page['locator']> {
  return window
    .locator('.summary-card')
    .filter({ has: window.getByText(label, { exact: true }) })
    .locator('.summary-value')
}

test.describe('トップ画面・画面横断の整合性', () => {
  let launched: LaunchedApp
  test.beforeEach(async () => {
    launched = await launchApp()
  })
  test.afterEach(async () => {
    await closeApp(launched)
  })

  test('TC-39: トップ画面の4つの件数(取引先・見積書・請求書・未収)が各操作と連動する', async () => {
    const { window } = launched
    for (const l of ['取引先登録件数(利用中)', '見積書件数', '請求書件数', '未収の請求書件数']) {
      await expect(card(window, l)).toHaveText('0件')
    }
    await shot(window, 'TC-39', '初期状態の4カード(すべて0件)')

    await setupCompany(window)
    const c1 = await createClientApi(window, '件数確認A商事')
    const c2 = await createClientApi(window, '件数確認B商事')
    await finalizeQuoteApi(window, c1, '2026-10-02', [
      { name: 'a', quantity: 1, unitPrice: 1000, taxRate: 10 }
    ])
    await window.evaluate(
      (c) =>
        window.jimuhubApi.saveQuoteDraft({
          clientId: c,
          issueDate: '2026-10-02',
          validUntil: '',
          remarks: '',
          lineItems: [{ name: 'd', quantity: 1, unit: '', unitPrice: 1, taxRate: 10 }]
        }),
      c1
    )
    const inv = await finalizeInvoiceApi(window, c1, '2026-10-02', [
      { name: 'b', quantity: 1, unitPrice: 2000, taxRate: 10 }
    ])
    await finalizeInvoiceApi(window, c2, '2026-10-02', [
      { name: 'c', quantity: 1, unitPrice: 3000, taxRate: 10 }
    ])
    await window.evaluate(
      (c) =>
        window.jimuhubApi.saveInvoiceDraft({
          clientId: c,
          issueDate: '2026-10-02',
          dueDate: '',
          remarks: '',
          lineItems: [
            {
              name: 'd',
              quantity: 1,
              unit: '',
              unitPrice: 1,
              taxRate: 10,
              withholdingTarget: false
            }
          ]
        }),
      c2
    )
    await window.reload()
    await expect(card(window, '取引先登録件数(利用中)')).toHaveText('2件')
    await expect(card(window, '見積書件数')).toHaveText('2件') // 下書きも件数に含む
    await expect(card(window, '請求書件数')).toHaveText('3件')
    await expect(card(window, '未収の請求書件数')).toHaveText('2件') // 確定済みかつ未入金のみ(下書きは含めない)
    await shot(window, 'TC-39', '取引先2・見積書2(下書き含む)・請求書3・未収2(下書きを含めない)')

    await window.evaluate(
      (id) =>
        window.jimuhubApi.updateInvoicePaymentStatus(id, {
          paymentStatus: 'paid',
          paymentDate: '2026-10-20'
        }),
      inv.id
    )
    await window.evaluate((c) => window.jimuhubApi.deactivateClient(c), c2)
    await window.reload()
    await expect(card(window, '未収の請求書件数')).toHaveText('1件')
    await expect(card(window, '取引先登録件数(利用中)')).toHaveText('1件') // 利用停止は除く
    await expect(card(window, '請求書件数')).toHaveText('3件') // 利用停止の取引先の書類も保持
    await shot(window, 'TC-39', '入金済み・利用停止の反映後(未収1・取引先1)')
  })

  test('TC-73: 新規画面のタイトルバー・サイドバー表示・デザインガイド適合(色・角丸・危険色の範囲)', async () => {
    const { window } = launched
    await setupCompany(window)
    const c1 = await createClientApi(window, '画面確認商事')
    const q = await finalizeQuoteApi(window, c1, '2026-10-02', [
      { name: 'a', quantity: 1, unitPrice: 1000, taxRate: 10 }
    ])
    const conv = await window.evaluate((id) => window.jimuhubApi.convertQuoteToInvoice(id), q.id)
    await window.reload()

    const log: string[] = []
    const RED = 'rgb(179, 69, 58)'
    const redUsers = (): Promise<string[]> =>
      window.evaluate((red) => {
        const out: string[] = []
        for (const el of Array.from(document.querySelectorAll('body *'))) {
          const s = getComputedStyle(el)
          if ([s.color, s.backgroundColor, s.borderTopColor, s.borderLeftColor].includes(red)) {
            out.push(
              `${el.tagName.toLowerCase()}.${(el as HTMLElement).className}:${(el.textContent ?? '').slice(0, 20)}`
            )
          }
        }
        return out
      }, RED)
    const visit = async (title: string, active: string): Promise<void> => {
      await expect(window.locator('.titlebar-title')).toHaveText(`事務HUB - ${title}`)
      await expect(window.locator('.sidebar')).toBeVisible()
      await expect(window.locator('.sidebar-item.active')).toHaveText(active)
      const bg = await window
        .locator('.sidebar-item.active')
        .evaluate((el) => getComputedStyle(el).backgroundColor)
      expect(bg).toBe('rgb(58, 58, 60)')
      log.push(
        `${title}: タイトルバー・サイドバー(選択中=${active})OK / 赤の使用箇所=${JSON.stringify(await redUsers())}`
      )
      expect(await redUsers(), `${title}に危険色(赤)が使われていない`).toEqual([])
    }

    await window.getByRole('button', { name: '自社情報・振込先の設定' }).click()
    await visit('自社情報・振込先の設定', 'ホーム')
    await shot(window, 'TC-73', '自社情報・振込先の設定')
    await window.getByRole('button', { name: 'ホーム' }).click()
    await window.getByRole('button', { name: '見積書・請求書' }).click()
    await visit('見積書・請求書', '見積書・請求書')
    // タブ・主ボタンの描画
    const primary = window.getByRole('button', { name: '+ 見積書を新規作成' })
    expect(
      await primary.evaluate((el) => [
        getComputedStyle(el).backgroundColor,
        getComputedStyle(el).borderRadius
      ])
    ).toEqual(['rgb(58, 58, 60)', '6px'])
    const badge = window.locator('.badge').first()
    expect(await badge.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('999px')
    await shot(window, 'TC-73', '見積書一覧')
    await window.getByRole('button', { name: '請求書', exact: true }).click()
    await shot(window, 'TC-73', '請求書一覧(状態・入金ステータスのバッジ)')
    await window.getByRole('button', { name: '+ 請求書を新規作成' }).click()
    await visit('請求書を作成', '見積書・請求書')
    await shot(window, 'TC-73', '請求書作成')
    await window.getByRole('button', { name: 'キャンセル', exact: true }).click()
    await window.getByRole('button', { name: '見積書', exact: true }).click()
    await window.getByRole('button', { name: '+ 見積書を新規作成' }).click()
    await visit('見積書を作成', '見積書・請求書')
    // パネルは角丸なし(直角)
    expect(
      await window
        .locator('.panel')
        .first()
        .evaluate((el) => getComputedStyle(el).borderRadius)
    ).toBe('0px')
    await shot(window, 'TC-73', '見積書作成')
    await window.getByRole('button', { name: 'キャンセル', exact: true }).click()
    await window.getByRole('cell', { name: '2026-001' }).click()
    await visit('見積書詳細', '見積書・請求書')
    await shot(window, 'TC-73', '見積書詳細')
    await window.getByRole('button', { name: '請求書に変換' }).click()
    await visit('請求書詳細', '見積書・請求書')
    await shot(window, 'TC-73', '請求書詳細')
    expect(conv.invoiceId).toBeGreaterThan(0)
    noteEvidence(
      'TC-73',
      '新規画面ごとのタイトルバー・サイドバー・危険色の確認結果',
      log.join('\n')
    )

    // 結合確認: 「準備中」メニュー押下時の挙動が取引先一覧と同じ(案内表示・画面遷移なし)
    await window.getByText('一覧へ戻る').click()
    await window.getByRole('button', { name: '案件管理' }).click()
    await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - 見積書・請求書')
    await window.waitForTimeout(500)
    await shot(
      window,
      'TC-73',
      '見積書・請求書一覧で「案件管理」(準備中)を押した直後(案内なし: BUG-03)'
    )
    await expect
      .soft(
        window.getByText('「案件管理」は以降のイテレーションで実装予定です。'),
        'BUG-03: 見積書・請求書一覧で「準備中」メニューを押しても案内が表示されない(取引先一覧・トップ・自社情報画面では表示される)'
      )
      .toBeVisible({ timeout: 2000 })
  })
})
