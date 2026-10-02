import { test, expect, _electron as electron } from '@playwright/test'
import AdmZip from 'adm-zip'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchApp, closeApp } from '../fixtures/electron-app'
import { noteEvidence, shot } from './evidence-dir'
import { createClientApi, dbQuery, finalizeQuoteApi, setupCompany, sha256File } from './helpers'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const MAIN_ENTRY = join(__dirname, '..', '..', 'out', 'main', 'index.js')

/**
 * 【tester作成】F-09 起動エラー画面からのデータ復元(TC-40・TC-41)。
 * 参照元: 詳細設計書 3.8章・4.9章・8章、README 6.2節 差異No.15
 */
test.describe.serial('F-09: 起動エラー画面からの復元', () => {
  let workDir: string
  let zipPath: string
  const CORRUPT = 'これは正しいSQLiteファイルではありません(破損の再現用)'

  test.beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'jimuhub-scenario-recovery-'))
    zipPath = join(workDir, 'good.zip')
    const src = await launchApp({ JIMUHUB_E2E_EXPORT_PATH: zipPath })
    await setupCompany(src.window)
    const c = await createClientApi(src.window, '復旧確認商事株式会社', {
      furigana: 'フッキュウカクニンショウジ'
    })
    await finalizeQuoteApi(src.window, c, '2026-10-02', [
      { name: '復旧する見積', quantity: 1, unitPrice: 12345, taxRate: 10 }
    ])
    await src.window.getByRole('button', { name: 'データをエクスポート' }).click()
    await src.window.getByRole('button', { name: 'エクスポート実行' }).click()
    await expect(src.window.getByText(/保存しました/)).toBeVisible()
    await closeApp(src)
  })
  test.afterAll(() => rmSync(workDir, { recursive: true, force: true }))

  function launchBroken(
    dataDir: string,
    extraEnv: Record<string, string>
  ): ReturnType<typeof electron.launch> {
    return electron.launch({
      args: [MAIN_ENTRY],
      env: { ...process.env, JIMUHUB_DATA_DIR: dataDir, JIMUHUB_WINDOW_SHOW: '0', ...extraEnv }
    })
  }

  test('TC-40: 破損DBの起動エラー画面から復元でき、破損DBは退避され、再起動後は復元データで正常に起動する', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'jimuhub-scenario-broken-'))
    writeFileSync(join(dataDir, 'data.sqlite'), CORRUPT)
    const app = await launchBroken(dataDir, {
      JIMUHUB_E2E_IMPORT_PATH: zipPath,
      JIMUHUB_E2E_EXPORT_PATH: join(workDir, 'never-written.zip')
    })
    try {
      const window = await app.firstWindow({ timeout: 15_000 })
      await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - 起動エラー')
      await expect(window.getByText('アプリを起動できませんでした')).toBeVisible()
      await expect(
        window.getByText(
          'データを読み込めませんでした。ファイルが破損している可能性があります。エクスポートファイルからの復元をお試しください'
        )
      ).toBeVisible()
      await shot(window, 'TC-40', '起動エラー画面(復元導線あり)')

      // 警告確認 → キャンセルで初期状態へ戻る
      await window.getByRole('button', { name: 'エクスポートファイルから復元する' }).click()
      await expect(
        window.getByText('現在のデータがエクスポートファイルの内容で置き換わります。よろしいですか')
      ).toBeVisible()
      await shot(window, 'TC-40', '復元前の警告確認(続行は危険ボタン)')
      await window.getByRole('button', { name: 'キャンセル' }).click()
      await expect(
        window.getByRole('button', { name: 'エクスポートファイルから復元する' })
      ).toBeVisible()

      // 起動エラー画面ではエクスポートはできない(常に失敗結果)
      const exportResult = await window.evaluate(() => window.jimuhubApi.exportData())
      expect(exportResult.success).toBe(false)
      expect(existsSync(join(workDir, 'never-written.zip'))).toBe(false)

      // 復元
      await window.getByRole('button', { name: 'エクスポートファイルから復元する' }).click()
      await window.getByRole('button', { name: '続行' }).click()
      await expect(
        window.getByText('復元が完了しました。アプリを再起動してください。')
      ).toBeVisible()
      await expect(window.getByRole('button', { name: 'アプリを再起動' })).toBeVisible()
      await shot(window, 'TC-40', '復元完了と「アプリを再起動」ボタン')
    } finally {
      await app.close().catch(() => undefined)
    }

    // 破損DBは削除されず backups/corrupt_data_* へ退避されている(内容も同一)
    const backups = readdirSync(join(dataDir, 'backups'))
    const corrupt = backups.filter((n) => n.startsWith('corrupt_data_'))
    expect(corrupt.length, `corrupt_data_*が1件: ${backups.join(', ')}`).toBe(1)
    expect(readFileSync(join(dataDir, 'backups', corrupt[0]!), 'utf-8')).toBe(CORRUPT)
    noteEvidence('TC-40', '復元後のbackups/の内容(破損DBの退避)', backups.join('\n'))

    // 再起動相当(同じ保存先で再度起動)すると、通常の画面で復元データが使える
    const again = await launchApp({ JIMUHUB_DATA_DIR: dataDir })
    try {
      await expect(again.window.locator('.titlebar-title')).toHaveText('事務HUB - ホーム')
      await expect(
        again.window
          .locator('.summary-card')
          .filter({ has: again.window.getByText('取引先登録件数(利用中)', { exact: true }) })
          .locator('.summary-value')
      ).toHaveText('1件')
      await expect(
        again.window
          .locator('.summary-card')
          .filter({ has: again.window.getByText('見積書件数', { exact: true }) })
          .locator('.summary-value')
      ).toHaveText('1件')
      await shot(again.window, 'TC-40', '復元後に通常起動したホーム(取引先1件・見積書1件)')
      expect(dbQuery(dataDir, 'SELECT quote_number,pdf_hash_mismatch FROM quotes')).toBe(
        '2026-001|0'
      )
      const pdf = dbQuery(dataDir, 'SELECT pdf_path,pdf_hash FROM quotes').split('|')
      expect(existsSync(pdf[0]!)).toBe(true)
      expect(sha256File(pdf[0]!)).toBe(pdf[1])
    } finally {
      await again.app.close().catch(() => undefined)
      rmSync(again.dataDir, { recursive: true, force: true })
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  test('TC-41: 起動エラー画面での復元失敗(不正ファイル)はエラー表示となり、破損DBは元の位置に戻り、再度選び直せる', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'jimuhub-scenario-broken-'))
    writeFileSync(join(dataDir, 'data.sqlite'), CORRUPT)
    // data.jsonを持たないZIP
    const badZip = join(workDir, 'bad.zip')
    const z = new AdmZip()
    z.addFile('readme.txt', Buffer.from('x'))
    z.writeZip(badZip)
    const app = await launchBroken(dataDir, { JIMUHUB_E2E_IMPORT_PATH: badZip })
    try {
      const window = await app.firstWindow({ timeout: 15_000 })
      await window.getByRole('button', { name: 'エクスポートファイルから復元する' }).click()
      await window.getByRole('button', { name: '続行' }).click()
      await expect(
        window.getByText(
          '選択されたファイルを読み込めませんでした。正しいエクスポートファイルかご確認ください'
        )
      ).toBeVisible()
      await expect(
        window.getByRole('button', { name: 'エクスポートファイルから復元する' })
      ).toBeVisible() // 再度選び直せる
      await shot(window, 'TC-41', '不正ファイルの復元失敗: エラー表示と再選択可能な状態')
      // 破損DBは元の位置に残り、中身も変わらない
      expect(readFileSync(join(dataDir, 'data.sqlite'), 'utf-8')).toBe(CORRUPT)
      noteEvidence(
        'TC-41',
        '失敗後のデータ保存先の状態',
        `data.sqliteは破損DBのまま(内容一致)\nbackups: ${existsSync(join(dataDir, 'backups')) ? readdirSync(join(dataDir, 'backups')).join(', ') || '(空)' : '(なし)'}`
      )
      // 続けて有効なファイルで復元できる(同一ウィンドウ内で再試行)
    } finally {
      await app.close().catch(() => undefined)
    }

    // 有効なZIPで再試行すると成功する
    const app2 = await launchBroken(dataDir, { JIMUHUB_E2E_IMPORT_PATH: zipPath })
    try {
      const window = await app2.firstWindow({ timeout: 15_000 })
      await window.getByRole('button', { name: 'エクスポートファイルから復元する' }).click()
      await window.getByRole('button', { name: '続行' }).click()
      await expect(
        window.getByText('復元が完了しました。アプリを再起動してください。')
      ).toBeVisible()
    } finally {
      await app2.close().catch(() => undefined)
      rmSync(dataDir, { recursive: true, force: true })
      mkdirSync(workDir, { recursive: true })
    }
  })
})
