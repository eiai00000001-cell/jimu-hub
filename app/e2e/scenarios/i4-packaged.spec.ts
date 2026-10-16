import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createWorkDir } from '../../test-support/work-dir.mjs'
import { noteEvidence, shot } from './evidence-dir'
import { dbQuery } from './helpers'
import { mustApi } from './helpers-i2'
import { createTaskApi, dumpTasks } from './helpers-i4'

/**
 * 【tester作成】イテレーション4: 配布版(パッケージ済み.app)でのスキーマ版5→6の移行とタスクの往復(TC-153)。
 * 実行: JIMUHUB_PACKAGED_APP=<.appのパス> npx playwright test --config=e2e/scenarios/playwright.config.ts i4-packaged
 */
const APP = process.env.JIMUHUB_PACKAGED_APP
const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..')

const launch = (ud: string): Promise<ElectronApplication> =>
  electron.launch({
    executablePath: join(APP!, 'Contents', 'MacOS', '事務HUB'),
    args: [`--user-data-dir=${ud}`],
    env: { ...process.env, JIMUHUB_WINDOW_SHOW: '0' }
  })

test.describe('配布版: タスク・移行', () => {
  test.skip(!APP, 'JIMUHUB_PACKAGED_APP未指定(配布用.appのパスが必要)')
  test('TC-153: 配布版で、スキーマ版5のデータが版6へ移行し、タスクの登録・エクスポート・復元が動作する', async () => {
    test.setTimeout(180_000)
    const work = createWorkDir('e2e', 'jimuhub-i4-pkg')
    const v5 = join(work, 'v5-ud')
    execFileSync('mkdir', [v5])
    execFileSync(
      'node',
      [join(root, 'docs', '07_test', 'tools', 'make-v5-fixture.mjs'), root, v5],
      { stdio: 'pipe' }
    )
    const zip = join(work, 'packaged.zip')
    const lines: string[] = []
    let srcTasks = ''
    const a1 = await launch(v5)
    try {
      const w = await a1.firstWindow({ timeout: 30_000 })
      await expect(w.locator('.titlebar-title')).toHaveText('事務HUB - ホーム')
      expect(dbQuery(v5, "select value from app_meta where key='schema_version'")).toBe('6')
      expect(
        readdirSync(join(v5, 'backups')).filter((n) => n.startsWith('pre-migration_v5_'))
      ).toHaveLength(1)
      const pid = Number(dbQuery(v5, "select id from projects where name='版5の進行中案件'"))
      const t = await createTaskApi(w, {
        name: '配布版のタスク',
        projectId: pid,
        dueDate: '2020-01-01'
      })
      await createTaskApi(w, { name: '配布版の完了タスク' }).then((id) =>
        mustApi(w, 'completeTask', id)
      )
      await w.getByRole('button', { name: 'タスク・期限' }).click()
      await expect(w.getByRole('row', { name: /配布版のタスク/ })).toHaveClass(/overdue/)
      await shot(w, 'TC-153', '配布版のタスク一覧(版5から移行したデータに登録。期限超過の強調)')
      await a1.evaluate(({ dialog }, p) => {
        ;(dialog as unknown as Record<string, unknown>).showSaveDialog = async () => ({
          canceled: false,
          filePath: p
        })
      }, zip)
      const ex = await mustApi<{ success: boolean }>(w, 'exportData')
      expect(ex.success).toBe(true)
      srcTasks = dumpTasks(v5)
      void t
      lines.push(
        '配布版でスキーマ版5のデータから起動し版6へ移行(移行前の退避あり)、タスクを登録してエクスポート成功'
      )
    } finally {
      await a1.close().catch(() => undefined)
    }
    const dst = join(work, 'dst-ud')
    execFileSync('mkdir', [dst])
    const a2 = await launch(dst)
    try {
      const w = await a2.firstWindow({ timeout: 30_000 })
      await a2.evaluate(({ dialog }, p) => {
        ;(dialog as unknown as Record<string, unknown>).showOpenDialog = async () => ({
          canceled: false,
          filePaths: [p]
        })
      }, zip)
      const ins = await mustApi<{
        inspection: {
          token: string
          hasTasks: boolean
          needsConfirmation: boolean
          schemaVersion: number
        }
      }>(w, 'inspectBackup')
      expect(ins.inspection).toMatchObject({
        hasTasks: true,
        needsConfirmation: false,
        schemaVersion: 6
      })
      const r = await mustApi<{ success: boolean; error?: string }>(w, 'importData', {
        token: ins.inspection.token
      })
      expect(r.success, r.error).toBe(true)
      expect(dumpTasks(dst)).toBe(srcTasks)
      await w.getByRole('button', { name: 'タスク・期限' }).click()
      await w.getByLabel('状態', { exact: true }).selectOption('all')
      await expect(w.getByText('該当 2件')).toBeVisible()
      await shot(w, 'TC-153', '配布版で別の保存先へ復元した後のタスク一覧')
      lines.push('配布版で復元成功。tasksの内容は元と完全に一致')
    } finally {
      await a2.close().catch(() => undefined)
    }
    noteEvidence('TC-153', '配布版の確認結果', lines.join('\n'))
    void existsSync
  })
})
