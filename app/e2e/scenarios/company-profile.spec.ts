import { test, expect } from '@playwright/test'
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/electron-app'
import { shot } from './evidence-dir'
import { COMPANY, dbQuery } from './helpers'

/**
 * 【tester作成】F-10 自社情報・振込先の設定(TC-42〜TC-44)。
 * 参照元: 詳細設計書 3.9章・4.10章・8章、README 6.2節 差異No.6
 */
test.describe('F-10: 自社情報・振込先の設定', () => {
  let launched: LaunchedApp

  test.beforeEach(async () => {
    launched = await launchApp()
  })
  test.afterEach(async () => {
    await closeApp(launched)
  })

  test('TC-42: 入力・保存後は同じ画面に留まり完了メッセージを表示し、再表示で保持される', async () => {
    const { window, dataDir } = launched
    await window.getByRole('button', { name: '自社情報・振込先の設定' }).click()
    await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - 自社情報・振込先の設定')
    await shot(window, 'TC-42', '未設定の初期状態(全項目空欄)')

    await window.getByLabel('氏名・屋号').fill(COMPANY.name)
    await window.getByLabel('住所').fill(COMPANY.address)
    await window.getByLabel('インボイス登録番号').fill(COMPANY.invoiceRegistrationNumber)
    await window.getByLabel('振込先銀行名').fill(COMPANY.bankName)
    await window.getByLabel('振込先支店名').fill(COMPANY.bankBranch)
    await window.getByLabel('口座種別').selectOption('普通')
    await window.getByLabel('口座番号').fill(COMPANY.accountNumber)
    await window.getByLabel('口座名義').fill(COMPANY.accountHolder)
    await window.getByRole('button', { name: '保存', exact: true }).click()

    // 差異No.6: 一覧等へ遷移せず、同じ画面に完了メッセージを表示する
    await expect(window.getByText('自社情報を保存しました')).toBeVisible()
    await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - 自社情報・振込先の設定')
    await shot(window, 'TC-42', '保存後も同じ画面に留まり完了メッセージが表示される')

    // DB(company_profile)へid=1で登録されている
    expect(
      dbQuery(
        dataDir,
        'SELECT id,name,address,invoice_registration_number,bank_name,account_type,account_number FROM company_profile'
      )
    ).toBe(
      `1|${COMPANY.name}|${COMPANY.address}|${COMPANY.invoiceRegistrationNumber}|${COMPANY.bankName}|普通|${COMPANY.accountNumber}`
    )

    // 画面を開き直しても保持され、2回目の保存はupsert(レコードは1件のまま)
    await window.getByRole('button', { name: 'ホーム' }).click()
    await window.getByRole('button', { name: '自社情報・振込先の設定' }).click()
    await expect(window.getByLabel('氏名・屋号')).toHaveValue(COMPANY.name)
    await expect(window.getByLabel('口座種別')).toHaveValue('普通')
    await window.getByLabel('口座名義').fill('ヘンコウゴ')
    await window.getByRole('button', { name: '保存', exact: true }).click()
    await expect(window.getByText('自社情報を保存しました')).toBeVisible()
    expect(dbQuery(dataDir, 'SELECT COUNT(*), MAX(account_holder) FROM company_profile')).toBe(
      '1|ヘンコウゴ'
    )
    await shot(window, 'TC-42', '再表示後の更新(upsert)も完了メッセージが表示される')
  })

  test('TC-43: 必須未入力・文字数超過はエラー表示となり保存されない', async () => {
    const { window, dataDir } = launched
    await window.getByRole('button', { name: '自社情報・振込先の設定' }).click()
    await window.getByRole('button', { name: '保存', exact: true }).click()
    await expect(window.getByText('氏名・屋号を入力してください')).toBeVisible()
    await expect(window.getByText('住所を入力してください')).toBeVisible()
    await shot(window, 'TC-43', '氏名・屋号・住所の必須未入力エラー')

    await window.getByLabel('氏名・屋号').fill('あ'.repeat(101))
    await window.getByLabel('住所').fill('東京都(架空)')
    await window.getByLabel('口座番号').fill('1'.repeat(11))
    await window.getByRole('button', { name: '保存', exact: true }).click()
    await expect(window.getByText('氏名・屋号は100文字以内で入力してください')).toBeVisible()
    await expect(window.getByText('口座番号は10文字以内で入力してください')).toBeVisible()
    await expect(window.getByText('自社情報を保存しました')).not.toBeVisible()
    await shot(window, 'TC-43', '文字数上限超過エラー')
    expect(dbQuery(dataDir, 'SELECT COUNT(*) FROM company_profile')).toBe('0')
  })

  test('TC-44: 自社情報未設定で見積書をPDF保存するとエラーと導線が出て、設定後は遷移元(見積書作成)へ戻る', async () => {
    const { window } = launched
    await window.getByRole('button', { name: '見積書・請求書' }).click()
    await window.getByRole('button', { name: /見積書を新規作成/ }).click()
    await window.locator('#quote-client').waitFor()
    await window.locator('.hint .link', { hasText: '取引先を新規登録' }).click()
    await window.getByLabel('取引先名称').fill('導線確認商事')
    await window.getByRole('button', { name: '登録', exact: true }).click()
    await window.getByLabel('品名1').fill('作業費')
    await window.getByLabel('単価1').fill('10000')
    await window.getByRole('button', { name: 'PDFとして保存' }).click()
    await expect(
      window.getByText('自社情報が未設定です。先に自社情報を設定してください').first()
    ).toBeVisible()
    await shot(window, 'TC-44', '自社情報未設定時のエラーと設定画面への導線')

    await window.getByRole('button', { name: '自社情報・振込先の設定へ' }).click()
    await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - 自社情報・振込先の設定')
    await window.getByLabel('氏名・屋号').fill(COMPANY.name)
    await window.getByLabel('住所').fill(COMPANY.address)
    await window.getByRole('button', { name: '保存', exact: true }).click()

    // 遷移元(見積書作成画面)へ戻り、完了メッセージを表示する(詳細設計書3.9章「保存成功(遷移元あり)」)
    await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - 見積書を作成')
    await expect(window.getByText('自社情報を保存しました')).toBeVisible()
    await shot(window, 'TC-44', '設定後に遷移元の見積書作成画面へ戻り完了メッセージを表示')
  })
})
