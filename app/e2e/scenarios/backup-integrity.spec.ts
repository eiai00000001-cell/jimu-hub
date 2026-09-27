import { test, expect } from '@playwright/test'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/electron-app'
import { evidenceDir } from './evidence-dir'

/**
 * 【tester作成】F-02(データエクスポート)・F-03(データ復元)のシナリオ:
 * 3世代退避の実機確認、異常系(保存失敗・パース失敗・バージョン不整合)、
 * および復元処理失敗時のロールバック・自動復旧を、実際のUI操作を通じて確認する。
 *
 * 参照元: 詳細設計書 3.6章・3.7章・4.2章・4.3章・8章(エラーハンドリング設計)
 * 観点: 機能テスト・異常系・データ整合性
 *
 * 補足: 3世代退避・ロールバックの単体レベルのロジックはVitest(backup.service.test.ts)で
 * vi.mock等を用いて検証済み(README5.1章参照)。本シナリオは、実際のElectronアプリ・実ファイルシステム・
 * IPC層を介して同じ結果が得られることを確認するもので、目的が異なる(結合テスト観点)。
 */

const EVIDENCE_DIR = evidenceDir('TC-09_backup-integrity')

function makeBackupFile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    appVersion: '0.1.0',
    exportedAt: new Date().toISOString(),
    data: {
      clients: [
        {
          id: 1,
          name: '復元確認用商事株式会社',
          honorific: '(なし)',
          contactPerson: null,
          postalCode: null,
          address: null,
          phone: null,
          email: null,
          invoiceRegistrationNumber: null,
          memo: null,
          status: 'active',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ]
    },
    ...overrides
  }
}

test.describe('F-02/F-03: エクスポート・復元の異常系とデータ整合性(TC-09〜TC-12)', () => {
  let launched: LaunchedApp
  let workDir: string

  test.beforeAll(() => {
    mkdirSync(EVIDENCE_DIR, { recursive: true })
  })

  test.beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'jimuhub-scenario-backup-'))
  })

  test.afterEach(async () => {
    if (launched) await closeApp(launched)
    rmSync(workDir, { recursive: true, force: true })
  })

  test('エクスポート内容が詳細設計書4.2章の構造と一致し、復元が全置換(既存データの上書きではなく完全な置き換え)になる(TC-05・TC-07)', async () => {
    const filePath = join(workDir, 'roundtrip.json')
    launched = await launchApp({
      JIMUHUB_E2E_EXPORT_PATH: filePath,
      JIMUHUB_E2E_IMPORT_PATH: filePath
    })
    const { window } = launched

    // Aを登録 → エクスポート(この時点ではAのみ含まれるファイルができる)
    await window.getByRole('button', { name: '取引先管理' }).click()
    await window.getByRole('button', { name: '+ 新規登録' }).click()
    await window.getByLabel('取引先名称').fill('全置換確認用_A')
    await window.getByRole('button', { name: '登録', exact: true }).click()
    await expect(window.getByText('取引先を登録しました')).toBeVisible()

    await window.getByRole('button', { name: 'ホーム' }).click()
    await window.getByRole('button', { name: 'データをエクスポート' }).click()
    await window.getByRole('button', { name: 'エクスポート実行' }).click()
    await expect(window.getByText(/保存しました/)).toBeVisible()
    await window.getByLabel('閉じる').click()

    // TC-05: エクスポートされたファイルの構造を直接確認する(詳細設計書4.2章)
    const exported = JSON.parse(readFileSync(filePath, 'utf-8'))
    expect(exported.schemaVersion).toBe(1)
    expect(typeof exported.appVersion).toBe('string')
    expect(typeof exported.exportedAt).toBe('string')
    expect(Array.isArray(exported.data.clients)).toBe(true)
    expect(exported.data.clients).toHaveLength(1)
    expect(exported.data.clients[0]).toMatchObject({ name: '全置換確認用_A', status: 'active' })

    // Bを追加登録(この時点でDBにはA・Bの2件が存在する。エクスポートファイルにはAのみ)
    await window.getByRole('button', { name: '取引先管理' }).click()
    await window.getByRole('button', { name: '+ 新規登録' }).click()
    await window.getByLabel('取引先名称').fill('全置換確認用_B')
    await window.getByRole('button', { name: '登録', exact: true }).click()
    await expect(window.getByText('取引先を登録しました')).toBeVisible()
    await expect(window.locator('tbody tr')).toHaveCount(2)

    // TC-07: Aのみを含むファイルで復元すると、Bを含む現在のデータが「全置換」され、Aのみが残ることを確認する
    await window.getByRole('button', { name: 'ホーム' }).click()
    await window.getByRole('button', { name: 'データを復元' }).click()
    await window.getByRole('button', { name: 'ファイルを選択して復元' }).click()
    await window.getByRole('button', { name: '続行' }).click()
    await expect(window.getByText('復元が完了しました(1件)')).toBeVisible()
    await window.getByLabel('閉じる').click()

    await window.getByRole('button', { name: '取引先管理' }).click()
    await window.getByRole('switch', { name: '利用停止も表示' }).click()
    await expect(window.locator('tbody tr')).toHaveCount(1)
    await expect(window.getByRole('cell', { name: '全置換確認用_A' })).toBeVisible()
    await expect(window.getByRole('cell', { name: '全置換確認用_B' })).not.toBeVisible()
    await window.screenshot({ path: `${EVIDENCE_DIR}/07_full_replace_confirmed.png` })
  })

  test('エクスポート失敗(異常系): 保存先が存在しない場合にエラーメッセージが表示される(TC-06)', async () => {
    launched = await launchApp({
      JIMUHUB_E2E_EXPORT_PATH: join(workDir, 'no-such-directory', 'export.json')
    })
    const { window } = launched

    await window.getByRole('button', { name: 'データをエクスポート' }).click()
    await window.getByRole('button', { name: 'エクスポート実行' }).click()
    await expect(
      window.getByText('保存に失敗しました。保存先の空き容量・書き込み権限をご確認ください')
    ).toBeVisible()
    await window.screenshot({ path: `${EVIDENCE_DIR}/01_export_failure.png` })
  })

  test('復元失敗(異常系): 壊れたJSONファイルを選択するとエラーメッセージが表示される(TC-09)', async () => {
    const brokenFilePath = join(workDir, 'broken.json')
    writeFileSync(brokenFilePath, '{ this is not valid json', 'utf-8')

    launched = await launchApp({ JIMUHUB_E2E_IMPORT_PATH: brokenFilePath })
    const { window } = launched

    await window.getByRole('button', { name: 'データを復元' }).click()
    await window.getByRole('button', { name: 'ファイルを選択して復元' }).click()
    await window.getByRole('button', { name: '続行' }).click()
    await expect(
      window.getByText(
        '選択されたファイルを読み込めませんでした。正しいエクスポートファイルかご確認ください'
      )
    ).toBeVisible()
    await window.screenshot({ path: `${EVIDENCE_DIR}/02_import_parse_failure.png` })
  })

  test('復元失敗(異常系): schemaVersionが新しすぎる場合にエラーメッセージが表示される(TC-10)', async () => {
    const futureFilePath = join(workDir, 'future-version.json')
    writeFileSync(futureFilePath, JSON.stringify(makeBackupFile({ schemaVersion: 999 })), 'utf-8')

    launched = await launchApp({ JIMUHUB_E2E_IMPORT_PATH: futureFilePath })
    const { window } = launched

    await window.getByRole('button', { name: 'データを復元' }).click()
    await window.getByRole('button', { name: 'ファイルを選択して復元' }).click()
    await window.getByRole('button', { name: '続行' }).click()
    await expect(
      window.getByText(
        'このファイルは新しいバージョンの事務HUBで作成されたため復元できません。アプリを更新してください'
      )
    ).toBeVisible()
    await window.screenshot({ path: `${EVIDENCE_DIR}/03_import_version_too_new.png` })
  })

  test('復元失敗(データ整合性): DB制約違反でトランザクションが失敗した場合、元データへロールバックされる(TC-12)', async () => {
    // clientsテーブルのCHECK制約(status IN ('active','inactive'))に違反する値を持つ復元ファイルを用意し、
    // 実際のSQLiteトランザクション失敗 → ロールバック → 退避コピーからの自動復旧、をUI操作のみで再現する。
    const invalidFilePath = join(workDir, 'invalid-status.json')
    writeFileSync(
      invalidFilePath,
      JSON.stringify(
        makeBackupFile({
          data: {
            clients: [
              {
                id: 1,
                name: 'CHECK制約違反確認用',
                honorific: '(なし)',
                contactPerson: null,
                postalCode: null,
                address: null,
                phone: null,
                email: null,
                invoiceRegistrationNumber: null,
                memo: null,
                status: 'invalid-status-value',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
              }
            ]
          }
        })
      ),
      'utf-8'
    )

    launched = await launchApp({ JIMUHUB_E2E_IMPORT_PATH: invalidFilePath })
    const { window } = launched

    // 事前に正常な取引先を1件登録しておき、ロールバック後もこのデータが残ることを確認する
    await window.getByRole('button', { name: '取引先管理' }).click()
    await window.getByRole('button', { name: '+ 新規登録' }).click()
    await window.getByLabel('取引先名称').fill('ロールバック確認用取引先')
    await window.getByRole('button', { name: '登録', exact: true }).click()
    await expect(window.getByText('取引先を登録しました')).toBeVisible()

    // 復元を実行し、CHECK制約違反によりトランザクションが失敗することを狙う
    await window.getByRole('button', { name: 'ホーム' }).click()
    await window.getByRole('button', { name: 'データを復元' }).click()
    await window.getByRole('button', { name: 'ファイルを選択して復元' }).click()
    await window.getByRole('button', { name: '続行' }).click()

    await expect(
      window.getByText('復元に失敗しました。データは復元前の状態に戻しました')
    ).toBeVisible()
    await window.screenshot({ path: `${EVIDENCE_DIR}/04_import_rollback.png` })

    // ロールバック後も、事前に登録した取引先データが失われていないことを確認する(データ整合性)
    await window.getByLabel('閉じる').click()
    await window.getByRole('button', { name: '取引先管理' }).click()
    await expect(window.getByRole('cell', { name: 'ロールバック確認用取引先' })).toBeVisible()

    // ロールバック・退避復旧後もアプリが継続して読み書きできることを確認する(reopen後の継続動作)
    await window.getByRole('button', { name: '+ 新規登録' }).click()
    await window.getByLabel('取引先名称').fill('復旧後の継続動作確認用')
    await window.getByRole('button', { name: '登録', exact: true }).click()
    await expect(window.getByText('取引先を登録しました')).toBeVisible()
    await window.screenshot({ path: `${EVIDENCE_DIR}/05_after_rollback_continue_working.png` })
  })

  test('復元前の自動退避は直近3世代のみ保持する(TC-11)', async () => {
    const importFilePath = join(workDir, 'repeat-import.json')
    writeFileSync(importFilePath, JSON.stringify(makeBackupFile()), 'utf-8')

    launched = await launchApp({ JIMUHUB_E2E_IMPORT_PATH: importFilePath })
    const { window } = launched

    for (let i = 0; i < 4; i++) {
      await window.getByRole('button', { name: 'データを復元' }).click()
      await window.getByRole('button', { name: 'ファイルを選択して復元' }).click()
      await window.getByRole('button', { name: '続行' }).click()
      await expect(window.getByText('復元が完了しました(1件)')).toBeVisible()
      await window.getByLabel('閉じる').click()
    }

    await window.screenshot({ path: `${EVIDENCE_DIR}/06_after_4_imports.png` })

    const backupsDir = join(launched.dataDir, 'backups')
    const backupFiles = readdirSync(backupsDir).filter(
      (name) => name.startsWith('data_') && name.endsWith('.sqlite')
    )
    // 4回インポートを実行しても、直近3世代のみが保持されていること(詳細設計書4.3章手順5)
    expect(backupFiles.length).toBe(3)
  })
})
