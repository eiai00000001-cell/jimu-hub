import { test, expect, _electron as electron } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evidenceFilePath, noteEvidence, shot } from './evidence-dir'
import { createClientApi, dbQuery, finalizeQuoteApi, pdfText, setupCompany } from './helpers'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

/**
 * 【tester作成】配布物(パッケージ済みの.app)の確認: 除外設定(SEC-07、TC-70)・アイコン(★D1、TC-71)・
 * 配布版での起動とDB・PDF生成(TC-72)。
 *
 * 実行前に、配布用の.appを一時ディレクトリへ作成し、環境変数 JIMUHUB_PACKAGED_APP にそのパスを指定する。
 *   npx electron-builder --mac --dir --arm64 --config.directories.output=<一時ディレクトリ>
 *   JIMUHUB_PACKAGED_APP=<一時ディレクトリ>/mac-arm64/事務HUB.app npx playwright test --config=e2e/scenarios/playwright.config.ts packaged-app
 * (未指定の場合は本シナリオをスキップする)
 *
 * 重要: 配布版は実データ(~/Library/Application Support/事務HUB)を使うため、必ず --user-data-dir に一時ディレクトリを
 * 指定して起動する。実データには一切触れない。
 */
const APP = process.env.JIMUHUB_PACKAGED_APP
const ASAR_BIN = join(__dirname, '..', '..', 'node_modules', '@electron', 'asar', 'bin', 'asar.js')

test.describe('配布物(パッケージ済み.app)', () => {
  test.skip(!APP, 'JIMUHUB_PACKAGED_APP(配布用.appのパス)が未指定のためスキップ')

  test('TC-70: 配布物から不要な同梱物が除外され、必要なファイルは含まれる(SEC-07)', () => {
    const resources = join(APP!, 'Contents', 'Resources')
    const list = execFileSync('node', [ASAR_BIN, 'list', join(resources, 'app.asar')], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024
    })
      .split('\n')
      .filter(Boolean)
    const unpacked = (function walk(dir: string): string[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]
      )
    })(join(resources, 'app.asar.unpacked'))
    const all = [...list, ...unpacked]
    const has = (re: RegExp): string[] => all.filter((p) => re.test(p))

    const forbidden: Array<[string, RegExp]> = [
      ['react/react-dom/scheduler(バンドル済み)', /node_modules\/(react|react-dom|scheduler)\//],
      ['node-addon-api', /node_modules\/node-addon-api\//],
      ['better-sqlite3 のCソース・deps', /node_modules\/better-sqlite3\/(deps|src)\//],
      ['他OS用ネイティブバイナリ(win32/linux)', /prebuilds\/(win32|linux|linuxmusl)-/],
      ['ソースマップ', /\.map$/],
      ['型定義(.d.ts/.d.cts/.d.mts)', /\.d\.(ts|cts|mts)$/],
      ['zodのTypeScriptソース', /node_modules\/zod\/src\//],
      [
        'drizzle-orm の他DB方言(mysql-core等)',
        /node_modules\/drizzle-orm\/(mysql-core|singlestore-core|gel-core|libsql|expo-sqlite|d1|bun-sqlite|neon-http|pglite)\//
      ],
      ['README/CHANGELOG', /node_modules\/.*\/(README|CHANGELOG|HISTORY)[^/]*$/]
    ]
    const log: string[] = [`ファイル総数: asar内=${list.length} unpacked=${unpacked.length}`]
    for (const [label, re] of forbidden) {
      const found = has(re)
      log.push(
        `除外確認 ${label}: ${found.length === 0 ? '含まれない(OK)' : '含まれる: ' + found.slice(0, 3).join(', ')}`
      )
      expect(found, `${label}が含まれていない`).toEqual([])
    }
    // 必要なものは含まれる
    const required: Array<[string, RegExp]> = [
      ['Mainエントリ', /out\/main\/index\.js$/],
      ['Preload', /out\/preload\/index\.(js|mjs|cjs)$/],
      ['Renderer', /out\/renderer\/index\.html$/],
      ['better-sqlite3 ネイティブ(darwin)', /better-sqlite3\/.*\.node$/],
      ['adm-zip', /node_modules\/adm-zip\/adm-zip\.js$/],
      ['drizzle-orm(sqlite)', /node_modules\/drizzle-orm\/(better-sqlite3|sqlite-core)\//]
    ]
    for (const [label, re] of required) {
      const found = has(re)
      log.push(`必要ファイル ${label}: ${found.length}件`)
      expect(found.length, `${label}が含まれている`).toBeGreaterThan(0)
    }
    const du = (p: string): string =>
      execFileSync('du', ['-sh', p], { encoding: 'utf8' }).split('\t')[0]!
    log.push(
      `app.asar=${du(join(resources, 'app.asar'))} / app.asar.unpacked=${du(join(resources, 'app.asar.unpacked'))}`
    )
    noteEvidence('TC-70', '配布物(arm64の.app、--dirビルド)の除外確認結果', log.join('\n'))
  })

  test('TC-71: アプリアイコン(案C)が設定され、icnsに必要なサイズが含まれる', () => {
    const resources = join(APP!, 'Contents', 'Resources')
    const icns = join(resources, 'icon.icns')
    expect(existsSync(icns)).toBe(true)
    const plist = execFileSync('plutil', ['-p', join(APP!, 'Contents', 'Info.plist')], {
      encoding: 'utf8'
    })
    expect(plist).toContain('"CFBundleIconFile" => "icon.icns"')
    const work = mkdtempSync(join(tmpdir(), 'jimuhub-icon-'))
    try {
      execFileSync('iconutil', ['-c', 'iconset', icns, '-o', join(work, 'icon.iconset')])
      const sizes = readdirSync(join(work, 'icon.iconset')).sort()
      noteEvidence('TC-71', 'icon.icnsに含まれるサイズ一覧(iconutilで展開)', sizes.join('\n'))
      for (const n of [
        'icon_16x16.png',
        'icon_32x32.png',
        'icon_128x128.png',
        'icon_256x256.png',
        'icon_512x512.png',
        'icon_512x512@2x.png'
      ]) {
        expect(sizes, n).toContain(n)
      }
      // 最大サイズをエビデンス画像として保存(目視確認用)
      execFileSync('cp', [
        join(work, 'icon.iconset', 'icon_512x512@2x.png'),
        evidenceFilePath('TC-71', 'icon.icnsの最大サイズ(1024px)', 'png')
      ])
      const dims = execFileSync(
        'sips',
        [
          '-g',
          'pixelWidth',
          '-g',
          'pixelHeight',
          join(work, 'icon.iconset', 'icon_512x512@2x.png')
        ],
        { encoding: 'utf8' }
      )
      expect(dims).toContain('1024')
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
    expect(statSync(icns).size).toBeGreaterThan(10_000)
  })

  test('TC-72: 配布版が起動し、データは--user-data-dirに作成され(JIMUHUB_DATA_DIRは無視)、DB・PDF生成が動作する', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'jimuhub-packaged-ud-'))
    const ignoredDir = mkdtempSync(join(tmpdir(), 'jimuhub-packaged-ignored-'))
    const app = await electron.launch({
      executablePath: join(APP!, 'Contents', 'MacOS', '事務HUB'),
      args: [`--user-data-dir=${userData}`],
      env: { ...process.env, JIMUHUB_DATA_DIR: ignoredDir, JIMUHUB_WINDOW_SHOW: '0' }
    })
    try {
      const window = await app.firstWindow({ timeout: 30_000 })
      await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - ホーム')
      await shot(window, 'TC-72', '配布版のホーム画面')
      expect(await app.evaluate(({ app: a }) => a.isPackaged)).toBe(true)
      // 保存先は --user-data-dir。JIMUHUB_DATA_DIRは配布版では無視される(SEC-01)
      await expect.poll(() => existsSync(join(userData, 'data.sqlite'))).toBe(true)
      expect(readdirSync(ignoredDir)).toEqual([])

      // DB読み書き(better-sqlite3)・PDF生成(printToPDF)が配布版で動作する
      await setupCompany(window)
      const c = await createClientApi(window, '配布版確認商事', { furigana: 'ハイフバンカクニン' })
      const q = await finalizeQuoteApi(window, c, '2026-10-02', [
        { name: '配布版の見積', quantity: 1, unitPrice: 5000, taxRate: 10 }
      ])
      expect(realpathSync(q.pdfPath).startsWith(join(realpathSync(userData), 'documents'))).toBe(
        true
      )
      expect(dbQuery(userData, 'SELECT quote_number,status FROM quotes')).toBe('2026-001|finalized')
      const { text } = pdfText(q.pdfPath)
      expect(text).toContain('配布版の見積')
      expect(text).toContain('5,500')
      await window.reload()
      await expect(
        window
          .locator('.summary-card')
          .filter({ has: window.getByText('見積書件数', { exact: true }) })
          .locator('.summary-value')
      ).toHaveText('1件')
      await shot(window, 'TC-72', '配布版で見積書をPDF保存した後のホーム(見積書1件)')
      noteEvidence(
        'TC-72',
        '配布版の確認結果',
        `isPackaged=true\n--user-data-dir配下にdata.sqlite作成、JIMUHUB_DATA_DIR指定先は空のまま(無視された)\n見積書2026-001のPDFを生成(${realpathSync(q.pdfPath).replace(realpathSync(userData), '<user-data-dir>')})し内容を確認`
      )
    } finally {
      await app.close().catch(() => undefined)
      rmSync(userData, { recursive: true, force: true })
      rmSync(ignoredDir, { recursive: true, force: true })
    }
  })
})
