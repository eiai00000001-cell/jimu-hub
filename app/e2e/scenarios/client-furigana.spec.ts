import { test, expect } from '@playwright/test'
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/electron-app'
import { noteEvidence, shot } from './evidence-dir'
import { createClientApi, dbQuery } from './helpers'

/**
 * 【tester作成】取引先のフリガナ(F-04登録・F-05一覧の五十音順・F-07更新。TC-67〜TC-69)。
 * 参照元: 詳細設計書 3.3章・3.5章・4.4章・4.5章・4.7章・6.1章、README 6.2節 差異No.5
 */
test.describe('取引先のフリガナ', () => {
  let launched: LaunchedApp
  test.beforeEach(async () => {
    launched = await launchApp()
  })
  test.afterEach(async () => {
    await closeApp(launched)
  })

  const FORMAT_ERROR = 'フリガナは全角カタカナで入力してください(ひらがなは自動的に変換されます)'

  test('TC-67: 登録時、ひらがなは全角カタカナへ自動変換されて保存され、カタカナ以外はエラーになる', async () => {
    const { window, dataDir } = launched
    await window.getByRole('button', { name: '取引先管理' }).click()
    await window.getByRole('button', { name: '+ 新規登録' }).click()
    await window.getByLabel('取引先名称').fill('フリガナ確認商事')

    // ひらがな入力→入力中に全角カタカナへ変換(長音符は許可)
    await window.getByLabel('フリガナ').fill('ふりがなかくにんしょうじー')
    await expect(window.getByLabel('フリガナ')).toHaveValue('フリガナカクニンショウジー')
    await shot(window, 'TC-67', 'ひらがな入力が入力中に全角カタカナへ自動変換される')

    // カタカナ以外はエラー(英数字・漢字・半角カナ・スペース・100文字超)
    const invalids: Array<[string, string]> = [
      ['英数字', 'abc123'],
      ['漢字', '山田'],
      ['半角カナ', 'ﾔﾏﾀﾞ'],
      ['スペース含む', 'ヤマダ タロウ'],
      ['101文字', 'ア'.repeat(101)]
    ]
    const log: string[] = []
    for (const [label, value] of invalids) {
      await window.getByLabel('フリガナ').fill(value)
      await window.getByRole('button', { name: '登録', exact: true }).click()
      const visible = await window
        .getByText(label === '101文字' ? 'フリガナは100文字以内で入力してください' : FORMAT_ERROR)
        .isVisible()
      log.push(`${label}(${value.slice(0, 12)}): エラー表示=${visible}`)
      expect(visible, label).toBe(true)
      if (label === '漢字')
        await shot(window, 'TC-67', '漢字のフリガナはエラー(全角カタカナ指定の案内)')
    }
    noteEvidence('TC-67', 'フリガナ入力検証の結果', log.join('\n'))
    expect(dbQuery(dataDir, 'SELECT COUNT(*) FROM clients')).toBe('0')

    // 100文字ちょうどは登録できる。保存値はカタカナ
    await window.getByLabel('フリガナ').fill('あ'.repeat(100))
    await window.getByRole('button', { name: '登録', exact: true }).click()
    await expect(window.getByText('取引先を登録しました')).toBeVisible()
    expect(dbQuery(dataDir, 'SELECT furigana FROM clients')).toBe('ア'.repeat(100))

    // 空欄でも登録でき、一覧には「(未入力)」と表示される
    await window.getByRole('button', { name: '+ 新規登録' }).click()
    await window.getByLabel('取引先名称').fill('フリガナなし商事')
    await window.getByRole('button', { name: '登録', exact: true }).click()
    await expect(window.getByText('取引先を登録しました')).toBeVisible()
    await expect(window.getByText('(未入力)')).toBeVisible()
    expect(
      dbQuery(dataDir, "SELECT COUNT(*) FROM clients WHERE furigana IS NULL OR furigana=''")
    ).toBe('1')
    await shot(window, 'TC-67', '一覧のフリガナ列(未入力は「(未入力)」)')

    // 詳細画面にフリガナが表示される
    await window.getByText('フリガナ確認商事').click()
    await expect(window.getByText('フリガナ', { exact: true })).toBeVisible()
    await shot(window, 'TC-67', '詳細画面のフリガナ表示')
  })

  test('TC-68: 一覧の既定並びはフリガナ昇順(未入力は末尾)。濁点・長音符も五十音順、他の並べ替えも機能する', async () => {
    const { window } = launched
    await createClientApi(window, '早川工房') // フリガナなし(末尾)
    await createClientApi(window, '株式会社ガ', { furigana: 'ガ' })
    await createClientApi(window, '株式会社カ', { furigana: 'カ' })
    await createClientApi(window, '株式会社キ', { furigana: 'キ' })
    await createClientApi(window, '株式会社ア', { furigana: 'アー' })
    await createClientApi(window, '株式会社ハ', { furigana: 'ハ' })
    await createClientApi(window, '株式会社バ', { furigana: 'バ' })
    await createClientApi(window, '株式会社パ', { furigana: 'パ' })
    await createClientApi(window, '星野商会') // フリガナなし(末尾)
    await window.reload()
    await window.getByRole('button', { name: '取引先管理' }).click()
    const names = async (): Promise<string[]> =>
      window.locator('tbody tr td:first-child').allInnerTexts()
    await expect(window.locator('tbody tr')).toHaveCount(9)
    await expect(window.getByLabel('並べ替え')).toHaveValue('furigana_asc')
    const order = await names()
    expect(order.slice(0, 7)).toEqual([
      '株式会社ア',
      '株式会社カ',
      '株式会社ガ',
      '株式会社キ',
      '株式会社ハ',
      '株式会社バ',
      '株式会社パ'
    ])
    expect(new Set(order.slice(7))).toEqual(new Set(['早川工房', '星野商会']))
    noteEvidence('TC-68', 'フリガナ昇順の表示順', order.join('\n'))
    await shot(window, 'TC-68', 'フリガナ昇順(既定): フリガナ未入力は末尾')

    await window.getByLabel('並べ替え').selectOption('name_desc')
    const desc = await names()
    expect(desc).toEqual([...desc].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)))
    await window.getByLabel('並べ替え').selectOption('created_at_asc')
    expect((await names())[0]).toBe('早川工房')
    await window.getByLabel('並べ替え').selectOption('created_at_desc')
    expect((await names())[0]).toBe('星野商会')
    await shot(window, 'TC-68', '登録日新しい順への切り替え')
    await expect(window.getByLabel('並べ替え').locator('option')).toHaveText([
      'フリガナ昇順',
      '名称昇順',
      '名称降順',
      '登録日新しい順',
      '登録日古い順'
    ])
  })

  test('TC-69: 編集でフリガナを更新・クリアできる(ひらがな自動変換・エラー検証は登録と共通)', async () => {
    const { window, dataDir } = launched
    await createClientApi(window, '編集確認商事', { furigana: 'ヘンシュウ' })
    await window.reload()
    await window.getByRole('button', { name: '取引先管理' }).click()
    await window.getByText('編集確認商事').click()
    await window.getByRole('button', { name: '編集' }).click()
    await expect(window.getByLabel('フリガナ')).toHaveValue('ヘンシュウ')

    await window.getByLabel('フリガナ').fill('へんしゅうごー')
    await expect(window.getByLabel('フリガナ')).toHaveValue('ヘンシュウゴー')
    await window.getByLabel('フリガナ').fill('漢字')
    await window.getByRole('button', { name: '保存', exact: true }).click()
    await expect(window.getByText(FORMAT_ERROR)).toBeVisible()
    await shot(window, 'TC-69', '編集画面でも同じフリガナ検証が働く')

    await window.getByLabel('フリガナ').fill('へんしゅうごー')
    await window.getByRole('button', { name: '保存', exact: true }).click()
    await expect(window.getByText('取引先を更新しました')).toBeVisible()
    expect(dbQuery(dataDir, 'SELECT furigana FROM clients')).toBe('ヘンシュウゴー')

    await window.getByRole('button', { name: '編集' }).click()
    await expect(window.getByLabel('フリガナ')).toHaveValue('ヘンシュウゴー') // 既存値の読み込み完了を待つ
    await window.getByLabel('フリガナ').fill('')
    await window.getByRole('button', { name: '保存', exact: true }).click()
    await expect(window.getByText('取引先を更新しました')).toBeVisible()
    await expect
      .poll(() => dbQuery(dataDir, "SELECT IFNULL(furigana,'NULL') FROM clients"))
      .toBe('NULL')
    await expect(window.getByRole('button', { name: '保存', exact: true })).toHaveCount(0)
    await shot(window, 'TC-69', 'フリガナをクリアして更新')
  })
})
