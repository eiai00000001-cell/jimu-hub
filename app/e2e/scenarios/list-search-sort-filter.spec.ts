import { test, expect } from '@playwright/test'
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/electron-app'
import { shot } from './evidence-dir'
import type { ClientInput } from '../../src/shared/schemas/client.schema'

/**
 * 【tester作成】F-05(取引先一覧表示)のシナリオ: 検索・並べ替え・状態フィルタ・0件表示・
 * 50件程度投入時の一覧表示性能を確認する。
 * 参照元: 詳細設計書 3.2章(入力項目定義表)・4.5章(処理フロー設計)
 * 観点: 機能テスト・境界値・性能
 */

function client(name: string, honorific: ClientInput['honorific'] = '(なし)'): ClientInput {
  return {
    name,
    honorific,
    contactPerson: '',
    postalCode: '',
    address: '',
    phone: '',
    email: '',
    invoiceRegistrationNumber: '',
    memo: ''
  }
}

test.describe('F-05: 取引先一覧の検索・並べ替え・状態フィルタ・性能(TC-18〜TC-22)', () => {
  let launched: LaunchedApp

  test.beforeEach(async () => {
    launched = await launchApp()
  })

  test.afterEach(async () => {
    await closeApp(launched)
  })

  test('検索(部分一致)・並べ替え・状態フィルタが仕様どおりに動作する(TC-18〜TC-21)', async () => {
    const { window } = launched

    // window.jimuhubApi.createClient を直接呼び出し、事前データを投入する(画面操作の再現性を上げるため)
    await window.evaluate(
      async (inputs) => {
        for (const input of inputs) {
          await window.jimuhubApi.createClient(input)
        }
      },
      [client('あおぞら商事'), client('あおい商店'), client('株式会社ライトハウス')]
    )

    await window.getByRole('button', { name: '取引先管理' }).click()

    // TC-18: 検索(部分一致、"あお"で2件ヒット)
    await window.getByLabel('取引先名で検索').fill('あお')
    await expect(window.locator('tbody tr')).toHaveCount(2)
    await expect(window.getByRole('cell', { name: 'あおぞら商事' })).toBeVisible()
    await expect(window.getByRole('cell', { name: 'あおい商店' })).toBeVisible()
    await expect(window.getByRole('cell', { name: '株式会社ライトハウス' })).not.toBeVisible()
    await shot(window, 'TC-18', 'search_partial_match')

    // TC-18: 検索(0件ヒット時の案内文言)
    await window.getByLabel('取引先名で検索').fill('存在しないキーワードXYZ')
    await expect(window.getByText('該当する取引先がありません')).toBeVisible()
    await shot(window, 'TC-21', 'search_no_match')
    await window.getByLabel('取引先名で検索').fill('')

    // TC-19: 並べ替え(名称降順)
    await window.getByLabel('並べ替え').selectOption('name_desc')
    // 1行目のセルが最も名称順で大きい(降順の先頭)ことを確認
    await expect(window.locator('tbody tr').first()).toContainText('株式会社ライトハウス')
    await shot(window, 'TC-19', 'sort_name_desc')

    // TC-19: 並べ替え(登録日新しい順。最後に登録した"株式会社ライトハウス"が先頭)
    await window.getByLabel('並べ替え').selectOption('created_at_desc')
    await expect(window.locator('tbody tr').first()).toContainText('株式会社ライトハウス')

    // TC-19: 並べ替え(登録日古い順。最初に登録した"あおぞら商事"が先頭)
    await window.getByLabel('並べ替え').selectOption('created_at_asc')
    await expect(window.locator('tbody tr').first()).toContainText('あおぞら商事')

    // TC-20: 状態フィルタ(1件を利用停止にしてから、既定フィルタで除外されることを確認)
    await window.getByText('あおぞら商事').click()
    await window.getByRole('button', { name: '利用停止にする' }).click()
    await window.getByRole('button', { name: 'はい' }).click()
    await window.getByRole('button', { name: '一覧へ戻る' }).click()

    await expect(window.getByRole('cell', { name: 'あおぞら商事' })).not.toBeVisible()
    await shot(window, 'TC-20', 'status_filter_default_hides_inactive')

    await window.getByRole('switch', { name: '利用停止も表示' }).click()
    await expect(window.getByRole('cell', { name: 'あおぞら商事' })).toBeVisible()
    await shot(window, 'TC-20', 'status_filter_show_all')
  })

  test('取引先50件投入時の一覧表示・検索が実用的な時間で完了する(TC-22)', async () => {
    const { window } = launched

    const total = 50
    const inputs = Array.from({ length: total }, (_, i) =>
      client(`性能確認商事第${String(i + 1).padStart(2, '0')}号店`)
    )

    const createStart = Date.now()
    await window.evaluate(async (list) => {
      for (const input of list) {
        await window.jimuhubApi.createClient(input)
      }
    }, inputs)
    const createDurationMs = Date.now() - createStart

    await window.getByRole('button', { name: '取引先管理' }).click()

    const renderStart = Date.now()
    await expect(window.locator('tbody tr')).toHaveCount(total)
    const renderDurationMs = Date.now() - renderStart

    const searchStart = Date.now()
    await window.getByLabel('取引先名で検索').fill('第05号店')
    await expect(window.locator('tbody tr')).toHaveCount(1)
    const searchDurationMs = Date.now() - searchStart

    console.log(
      `[性能計測] ${total}件登録: ${createDurationMs}ms, 一覧描画: ${renderDurationMs}ms, 検索: ${searchDurationMs}ms`
    )

    await shot(window, 'TC-22', 'list_50_records')

    // 体感の遅延がないことの目安として、一覧描画・検索とも3秒以内に完了することを確認する
    expect(renderDurationMs).toBeLessThan(3000)
    expect(searchDurationMs).toBeLessThan(3000)
  })
})
