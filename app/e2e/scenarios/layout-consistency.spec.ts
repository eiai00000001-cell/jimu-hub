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

    // 結合確認: 見積書・請求書一覧でも「準備中」メニュー押下時は案内が表示され、画面遷移しない(BUG-03(i1)修正確認)
    await window.getByText('一覧へ戻る').click()
    await window.getByRole('button', { name: '案件管理' }).click()
    await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - 見積書・請求書')
    await expect(
      window.getByText('「案件管理」は以降のイテレーションで実装予定です。')
    ).toBeVisible()
    await shot(
      window,
      'TC-73',
      '見積書・請求書一覧で「案件管理」(準備中)を押した直後(案内が表示される。BUG-03修正後)'
    )
  })

  test('TC-73b: 作成・詳細画面でもサイドバーが使え、入力画面では離脱確認が出る(O2)', async () => {
    const { window } = launched
    await setupCompany(window)
    const c1 = await createClientApi(window, '離脱確認商事')
    const q = await finalizeQuoteApi(window, c1, '2026-10-02', [
      { name: 'a', quantity: 1, unitPrice: 1000, taxRate: 10 }
    ])
    const conv = await window.evaluate((id) => window.jimuhubApi.convertQuoteToInvoice(id), q.id)
    await window.reload()
    const dialogs: string[] = []
    let accept = false
    window.on('dialog', (d) => {
      dialogs.push(d.message())
      void (accept ? d.accept() : d.dismiss())
    })
    const CONFIRM = '入力中の内容は保存されません。この画面を離れてよろしいですか'

    // 詳細画面(見積書・請求書): 確認なしでサイドバー遷移できる
    await window.getByRole('button', { name: '見積書・請求書' }).click()
    await window.getByRole('cell', { name: '2026-001' }).click()
    await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - 見積書詳細')
    await window.getByRole('button', { name: '取引先管理' }).click()
    await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - 取引先一覧')
    expect(dialogs).toEqual([])
    await window.getByRole('button', { name: '見積書・請求書' }).click()
    await window.getByRole('button', { name: '請求書', exact: true }).click()
    await window.getByRole('cell', { name: '(未採番)' }).click()
    await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - 請求書詳細')
    await window.getByRole('button', { name: 'ホーム' }).click()
    await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - ホーム')
    expect(dialogs).toEqual([])
    await shot(window, 'TC-73', '詳細画面からサイドバーでホームへ遷移(確認なし)')

    // 入力画面(見積書作成): 変更の有無にかかわらず離脱確認が出る。「キャンセル」で留まり、「OK」で遷移
    await window.getByRole('button', { name: '見積書・請求書' }).click()
    await window.getByRole('button', { name: '+ 見積書を新規作成' }).click()
    await window.getByRole('button', { name: 'ホーム' }).click() // 未入力でも確認が出る(承認済みの仕様)
    await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - 見積書を作成')
    expect(dialogs).toEqual([CONFIRM])
    await window.getByLabel('品名1').fill('入力途中')
    await window.getByRole('button', { name: '取引先管理' }).click()
    await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - 見積書を作成')
    await expect(window.getByLabel('品名1')).toHaveValue('入力途中')
    expect(dialogs).toEqual([CONFIRM, CONFIRM])
    // 準備中メニューは遷移しないため、確認は不要で案内が出る
    await window.getByRole('button', { name: 'タスク・期限' }).click()
    await expect(
      window.getByText('「タスク・期限」は以降のイテレーションで実装予定です。')
    ).toBeVisible()
    accept = true
    await window.getByRole('button', { name: '取引先管理' }).click()
    await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - 取引先一覧')
    expect(dialogs.length).toBe(3)
    noteEvidence(
      'TC-73',
      '離脱確認ダイアログの文言と表示回数',
      dialogs.map((d, i) => `${i + 1}回目: ${d}`).join('\n')
    )

    // 請求書作成・取引先登録(イテレーション0の画面)も同じ挙動
    accept = false
    await window.getByRole('button', { name: '見積書・請求書' }).click()
    await window.getByRole('button', { name: '請求書', exact: true }).click()
    await window.getByRole('button', { name: '+ 請求書を新規作成' }).click()
    await window.getByRole('button', { name: 'ホーム' }).click()
    await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - 請求書を作成')
    accept = true
    await window.getByRole('button', { name: 'ホーム' }).click()
    await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - ホーム')
    await window.getByRole('button', { name: '取引先管理' }).click()
    await window.getByRole('button', { name: '+ 新規登録' }).click()
    accept = false
    await window.getByRole('button', { name: 'ホーム' }).click()
    await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - 取引先を登録')
    await shot(window, 'TC-73', '取引先登録画面でも離脱確認で留まる')
    expect(conv.invoiceId).toBeGreaterThan(0)
  })
})
