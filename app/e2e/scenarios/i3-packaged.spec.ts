import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { createWorkDir } from '../../test-support/work-dir.mjs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { noteEvidence, shot } from './evidence-dir'
import { createClientApi, dbQuery, setupCompany } from './helpers'
import { accountId, createRecordApi, dumpAll, mustApi } from './helpers-i2'
import { createProjectApi, finalizeInvoiceWithProject, getProjectApi } from './helpers-i3'

/**
 * 【tester作成】イテレーション3: 配布版(パッケージ済み.app)での案件管理・バックアップ・復元・データベース移行(TC-127)。
 * `archiver`・`yauzl`・`better-sqlite3`が配布版で動作すること、旧版(スキーマ版4)のデータから配布版で移行できることを確認する。
 * 配布版ではE2E用の環境変数(保存先・復元元の指定)が無効のため、OS標準ダイアログ(dialog)をMainで差し替えて指定する。
 * 実行: JIMUHUB_PACKAGED_APP=<.appのパス> npx playwright test --config=e2e/scenarios/playwright.config.ts i3-packaged
 */
const APP = process.env.JIMUHUB_PACKAGED_APP
const here = fileURLToPath(new URL('.', import.meta.url))

async function launchPackaged(userData: string): Promise<ElectronApplication> {
  return electron.launch({
    executablePath: join(APP!, 'Contents', 'MacOS', '事務HUB'),
    args: [`--user-data-dir=${userData}`],
    env: { ...process.env, JIMUHUB_WINDOW_SHOW: '0' }
  })
}

async function stubDialogs(
  app: ElectronApplication,
  paths: { save?: string; open?: string }
): Promise<void> {
  await app.evaluate(({ dialog }, p) => {
    ;(dialog as unknown as Record<string, unknown>).showSaveDialog = async () => ({
      canceled: !p.save,
      filePath: p.save ?? ''
    })
    ;(dialog as unknown as Record<string, unknown>).showOpenDialog = async () => ({
      canceled: !p.open,
      filePaths: p.open ? [p.open] : []
    })
  }, paths)
}

test.describe('配布版: 案件管理・バックアップ・復元・移行', () => {
  test.skip(!APP, 'JIMUHUB_PACKAGED_APP未指定(配布用.appのパスが必要)')

  test('TC-127: 配布版で、案件の登録・紐づけ・案件別収支、エクスポート・復元(ストリーム)、復元前の確認、旧版(スキーマ版4)データの移行が動作する', async () => {
    test.setTimeout(180_000)
    const work = createWorkDir('e2e', 'jimuhub-i3-pkg')
    const zip = join(work, 'packaged.zip')
    const srcUd = join(work, 'src-ud')
    const dstUd = join(work, 'dst-ud')
    const lines: string[] = []

    // --- 1) 案件・紐づけ・収支(配布版)→エクスポート
    let srcDump = ''
    const a1 = await launchPackaged(srcUd)
    try {
      const w1 = await a1.firstWindow({ timeout: 30_000 })
      await expect(w1.locator('.titlebar-title')).toHaveText('事務HUB - ホーム')
      await setupCompany(w1)
      const c = await createClientApi(w1, '配布版案件確認商事')
      const p = await createProjectApi(w1, { name: '配布版の案件', clientId: c })
      await finalizeInvoiceWithProject(w1, { clientId: c, unitPrice: 100000, projectId: p })
      const acc = await accountId(w1, '通信費')
      await createRecordApi(w1, {
        accountId: acc,
        description: '配布版の経費',
        amount: 11000,
        projectId: p
      } as never)
      const d = await getProjectApi(w1, p)
      expect(d.summary).toMatchObject({ sales: 110000, expense: 11000, balance: 99000 })
      await w1.getByRole('button', { name: '案件管理' }).click()
      await expect(w1.getByRole('cell', { name: '配布版の案件' })).toBeVisible()
      await shot(w1, 'TC-127', '配布版の案件一覧(売上・経費・差引)')
      await stubDialogs(a1, { save: zip })
      const ex = await mustApi<{ success: boolean }>(w1, 'exportData')
      expect(ex.success).toBe(true)
      expect(existsSync(zip)).toBe(true)
      expect(readdirSync(work).filter((n) => n.endsWith('.partial'))).toEqual([])
      srcDump = dumpAllAt(srcUd) // 起動中に読む(終了後は付属ファイルが残り、読み取り専用で開けないため)
      lines.push(
        '配布版で案件・請求書・経費を登録し、案件別収支(売上110,000・経費11,000・差引99,000)を確認、ストリーム方式でエクスポート成功'
      )
    } finally {
      await a1.close().catch(() => undefined)
    }

    // --- 2) 別の保存先(配布版)で復元。案件を含むため確認画面は出ない
    const a2 = await launchPackaged(dstUd)
    try {
      const w2 = await a2.firstWindow({ timeout: 30_000 })
      await stubDialogs(a2, { open: zip })
      const ins = await mustApi<{
        success: boolean
        inspection: { needsConfirmation: boolean; hasProjects: boolean; schemaVersion: number }
      }>(w2, 'inspectBackup')
      expect(ins.inspection).toMatchObject({
        hasProjects: true,
        schemaVersion: 6,
        needsConfirmation: false
      })
      const r = await mustApi<{ success: boolean; error?: string }>(w2, 'importData', {
        token: (ins.inspection as unknown as { token: string }).token
      })
      expect(r.success, r.error).toBe(true)
      expect(dumpAllAt(dstUd)).toBe(srcDump)
      await w2.getByRole('button', { name: '案件管理' }).click()
      await expect(w2.getByRole('cell', { name: '配布版の案件' })).toBeVisible()
      await shot(w2, 'TC-127', '配布版で別の保存先へ復元した後の案件一覧')
      lines.push('配布版で復元成功。全テーブル(案件・付け替え履歴を含む)のダンプが元と一致')
      // 現在の案件がある状態で、案件を含まない旧形式JSONを復元する場合は、確認画面が必要と判定される
      const legacyJson = join(work, 'legacy.json')
      execFileSync('sh', [
        '-c',
        `printf '%s' '{"schemaVersion":3,"appVersion":"0.2.0","exportedAt":"2026-09-28T00:00:00.000Z","data":{"clients":[]}}' > "${legacyJson}"`
      ])
      await stubDialogs(a2, { open: legacyJson })
      const ins2 = await mustApi<{
        inspection: { needsConfirmation: boolean; currentProjectCount: number; token: string }
      }>(w2, 'inspectBackup')
      expect(ins2.inspection).toMatchObject({ needsConfirmation: true, currentProjectCount: 1 })
      await mustApi(w2, 'discardBackup', ins2.inspection.token)
      lines.push(
        '配布版で、案件を含まない旧形式JSONの復元は確認が必要(needsConfirmation=true)と判定'
      )
    } finally {
      await a2.close().catch(() => undefined)
    }

    // --- 3) 旧版(スキーマ版4)のデータから、配布版で移行する
    const v4Ud = createWorkDir('e2e', 'jimuhub-i3-pkg-v4')
    const repoRoot = join(here, '..', '..', '..')
    execFileSync(
      'node',
      [join(repoRoot, 'docs', '07_test', 'tools', 'make-v4-fixture.mjs'), repoRoot, v4Ud],
      { stdio: 'pipe' }
    )
    expect(dbQuery(v4Ud, "select value from app_meta where key='schema_version'")).toBe('4')
    const a3 = await launchPackaged(v4Ud)
    try {
      const w3 = await a3.firstWindow({ timeout: 30_000 })
      await expect(w3.locator('.titlebar-title')).toHaveText('事務HUB - ホーム')
      expect(dbQuery(v4Ud, "select value from app_meta where key='schema_version'")).toBe('6')
      expect(
        readdirSync(join(v4Ud, 'backups')).filter((n) => n.startsWith('pre-migration_v4_'))
      ).toHaveLength(1)
      expect(dbQuery(v4Ud, 'select count(*) from cash_records')).toBe('3')
      await shot(w3, 'TC-127', '配布版で旧版(スキーマ版4)のデータから起動(移行済み)')
      lines.push(
        '配布版で旧版(スキーマ版4)のデータから起動し、最新のスキーマ版6へ移行・移行前の退避を作成・既存データを保持'
      )
    } finally {
      await a3.close().catch(() => undefined)
    }
    noteEvidence('TC-127', '配布版の確認結果', lines.join('\n'))
  })
})

function dumpAllAt(userData: string): string {
  return [
    dumpAll(userData, dbQuery),
    dbQuery(userData, 'select * from projects order by id'),
    dbQuery(userData, 'select * from project_link_history order by id')
  ].join('\n--\n')
}
