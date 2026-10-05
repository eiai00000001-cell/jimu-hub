import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/electron-app'
import { noteEvidence, shot } from './evidence-dir'
import { dbQuery, listFilesRecursive } from './helpers'
import { accountId, createRecordApi, dbExec, mustApi, pickTokens } from './helpers-i2'

/**
 * 【tester作成】★F2・★R4: 大きなデータ(領収書の合計が数百MB規模)でのエクスポート・復元の時間・進捗・メモリ使用量、
 * 見込みサイズ警告(復元上限1GiBの80%)、1GiB超のZIPの扱い(TC-99)。架空データ(乱数)のみ使用する。
 * 規模は環境変数 I2_CAP_FILES(既定36件≒340MB)、I2_CAP_HUGE=1(1GiB超の実測)で変更する。
 */
const FILES = Number(process.env.I2_CAP_FILES ?? 36)
const FILE_BYTES = 9.5 * 1024 * 1024

function rssMb(pid: number): number {
  try {
    const out = execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).trim()
    return Math.round(Number(out) / 1024)
  } catch {
    return 0
  }
}

async function seedReceipts(
  l: LaunchedApp,
  dir: string,
  count: number,
  bytes: number
): Promise<{ made: number }> {
  const acc = await accountId(l.window, '消耗品費')
  let made = 0
  while (made < count) {
    const batch = Math.min(5, count - made)
    const paths: string[] = []
    for (let i = 0; i < batch; i++) {
      const p = join(dir, `cap_${made + i}.pdf`)
      writeFileSync(p, Buffer.concat([Buffer.from('%PDF-1.4\n'), randomBytes(Math.floor(bytes))]))
      paths.push(p)
    }
    const t = await pickTokens(l.window, l.app, paths)
    await createRecordApi(l.window, {
      accountId: acc,
      description: `大容量確認 ${made + 1}〜${made + batch}`,
      receiptTokens: t.files.map((f) => f.token)
    })
    for (const p of paths) rmSync(p)
    made += batch
  }
  return { made }
}

test('TC-99a: 領収書の合計が数百MB規模のエクスポート・復元(時間・進捗・メモリ)', async () => {
  test.setTimeout(540_000)
  const work = mkdtempSync(join(tmpdir(), 'jimuhub-i2-cap-'))
  const zipPath = join(work, 'big.zip')
  const l = await launchApp({ JIMUHUB_E2E_EXPORT_PATH: zipPath, JIMUHUB_E2E_IMPORT_PATH: zipPath })
  try {
    const { window, dataDir, app } = l
    const pid = app.process().pid as number
    const t0 = Date.now()
    await seedReceipts(l, work, FILES, FILE_BYTES)
    const seedSec = (Date.now() - t0) / 1000
    const totalBytes = Number(dbQuery(dataDir, 'select sum(file_size) from receipts'))
    const rows = Number(dbQuery(dataDir, 'select count(*) from receipts'))
    expect(rows).toBe(FILES)
    // 進捗の受信記録(Renderer側で到着時刻を記録)と、Renderer自体の応答性(100ms間隔のタイマーの最大遅延)
    await window.evaluate(() => {
      const w = window as unknown as {
        __p: Array<{ t: number; phase: string; current: number; total: number }>
        __gap: number
        jimuhubApi: {
          onDataProgress: (
            cb: (p: { phase: string; current: number; total: number }) => void
          ) => void
        }
      }
      w.__p = []
      w.__gap = 0
      const t0 = performance.now()
      w.jimuhubApi.onDataProgress((p) =>
        w.__p.push({ t: Math.round(performance.now() - t0), ...p })
      )
      // 画面に実際に表示された進捗文言(role=status)を記録する
      const wl = window as unknown as { __shown: Array<{ t: number; text: string }> }
      wl.__shown = []
      new MutationObserver(() => {
        const el = document.querySelector('[role=status]')
        if (el && el.textContent) {
          const last = wl.__shown[wl.__shown.length - 1]
          if (!last || last.text !== el.textContent)
            wl.__shown.push({ t: Math.round(performance.now() - t0), text: el.textContent })
        }
      }).observe(document.body, { subtree: true, childList: true, characterData: true })
      let last = performance.now()
      setInterval(() => {
        const n = performance.now()
        w.__gap = Math.max(w.__gap, n - last - 100)
        last = n
      }, 100)
    })
    // --- エクスポート(画面から)
    let peak = rssMb(pid)
    const sampler = setInterval(() => {
      peak = Math.max(peak, rssMb(pid))
    }, 250)
    await window.getByRole('button', { name: 'データをエクスポート' }).click()
    const e0 = Date.now()
    await window.getByRole('button', { name: 'エクスポート実行' }).click()
    let shotTaken = false
    for (let i = 0; i < 600 && !shotTaken; i++) {
      const txt = await window.locator('.modal').innerText()
      if (/書き出しています\(\d+\/\d+\)/.test(txt)) {
        await shot(window, 'TC-99', 'エクスポート中の進捗表示(領収書を書き出しています(n/total))')
        shotTaken = true
      } else if (/保存しました/.test(txt)) break
      await window.waitForTimeout(100)
    }
    await expect(window.getByText(/保存しました/)).toBeVisible({ timeout: 300_000 })
    const exportSec = (Date.now() - e0) / 1000
    const exportPeak = peak
    const zipBytes = statSync(zipPath).size
    const exportProgress = await window.evaluate(
      () => (window as unknown as { __p: Array<{ t: number }> }).__p
    )
    const exportShown = await window.evaluate(
      () => (window as unknown as { __shown: Array<{ t: number; text: string }> }).__shown
    )
    await shot(window, 'TC-99', 'エクスポート完了')
    await window.getByLabel('閉じる').click()
    // --- 復元(画面から)
    peak = rssMb(pid)
    await window.evaluate(() => {
      ;(window as unknown as { __p: unknown[]; __gap: number }).__p = []
      ;(window as unknown as { __gap: number }).__gap = 0
    })
    await window.getByRole('button', { name: 'データを復元' }).click()
    await window.getByRole('button', { name: 'ファイルを選択して復元' }).click()
    const i0 = Date.now()
    await window.getByRole('button', { name: '続行' }).click()
    shotTaken = false
    for (let i = 0; i < 600 && !shotTaken; i++) {
      const txt = await window.locator('.modal').innerText()
      if (/復元しています\(\d+\/\d+\)/.test(txt)) {
        await shot(window, 'TC-99', '復元中の進捗表示(領収書・PDFを復元しています(n/total))')
        shotTaken = true
      } else if (/復元が完了/.test(txt)) break
      await window.waitForTimeout(100)
    }
    await expect(window.locator('.modal .message-success, .modal .message-error')).toBeVisible({
      timeout: 300_000
    })
    const importSec = (Date.now() - i0) / 1000
    clearInterval(sampler)
    const importPeak = peak
    const msg = await window.locator('.modal .message-success, .modal .message-error').innerText()
    const importProgress = await window.evaluate(
      () => (window as unknown as { __p: Array<{ t: number; current: number; total: number }> }).__p
    )
    const importShown = await window.evaluate(() =>
      (window as unknown as { __shown: Array<{ t: number; text: string }> }).__shown.filter((x) =>
        x.text.includes('復元')
      )
    )
    const gap = await window.evaluate(() => (window as unknown as { __gap: number }).__gap)
    await shot(window, 'TC-99', '復元完了(改変の警告なし)')
    expect(msg).toContain('復元が完了しました')
    expect(msg).not.toContain('改変')
    expect(Number(dbQuery(dataDir, 'select count(*) from receipts'))).toBe(FILES)
    expect(listFilesRecursive(join(dataDir, 'documents', 'receipts')).length).toBe(FILES)
    const spread =
      importProgress.length > 1
        ? importProgress[importProgress.length - 1].t - importProgress[0].t
        : 0
    noteEvidence(
      'TC-99',
      '大容量の計測結果(領収書の合計が数百MB規模)',
      [
        `領収書: ${FILES}件、合計${(totalBytes / 1024 / 1024).toFixed(0)}MB(1件あたり約9.5MB・乱数=圧縮されにくい)`,
        `データ作成(選択→保存→ハッシュ算出): ${seedSec.toFixed(1)}秒`,
        `エクスポート: ${exportSec.toFixed(1)}秒、ZIP=${(zipBytes / 1024 / 1024).toFixed(0)}MB、Mainプロセスのメモリ(RSS)ピーク約${exportPeak}MB、進捗通知${exportProgress.length}回`,
        `復元: ${importSec.toFixed(1)}秒、Mainプロセスのメモリ(RSS)ピーク約${importPeak}MB、進捗通知${importProgress.length}回(最初〜最後の到着の幅${spread}ms)`,
        `復元中のRendererのタイマー最大遅延: ${Math.round(gap)}ms(画面が固まらないかの目安)`,
        `エクスポート進捗の到着: 最初${exportProgress[0]?.t}ms〜最後${exportProgress.at(-1)?.t}ms(処理時間${(exportSec * 1000).toFixed(0)}ms)。画面に表示された進捗文言: ${exportShown.filter((x) => x.text.includes('書き出')).length}種類(例: ${exportShown.filter((x) => x.text.includes('書き出'))[0]?.text ?? 'なし'} 〜 ${exportShown.filter((x) => x.text.includes('書き出')).at(-1)?.text ?? 'なし'})`,
        `復元の進捗文言として画面に表示された数: ${importShown.length}種類(例: ${importShown[0]?.text ?? 'なし'} 〜 ${importShown.at(-1)?.text ?? 'なし'})`,
        `復元結果: ${msg}`
      ].join('\n')
    )
    noteEvidence(
      'TC-99',
      '進捗通知の到着時刻(復元・先頭10件)',
      JSON.stringify(importProgress.slice(0, 10))
    )
  } finally {
    await closeApp(l).catch(() => rmSync(l.dataDir, { recursive: true, force: true }))
    rmSync(work, { recursive: true, force: true })
  }
})

test('TC-99b: 見込みサイズが復元上限の80%を超える場合の警告(文言・続行/中止)', async () => {
  test.setTimeout(120_000)
  const work = mkdtempSync(join(tmpdir(), 'jimuhub-i2-warn-'))
  const zipPath = join(work, 'warn.zip')
  const l = await launchApp({ JIMUHUB_E2E_EXPORT_PATH: zipPath })
  try {
    const { window, dataDir, app } = l
    await seedReceipts(l, work, 1, 1024 * 1024)
    // 見込みサイズ(DBのfile_size合計)を、上限1GiBの80%(約859MB)超に書き換えて警告の条件を再現する(実ファイルは1MB)
    dbExec(dataDir, 'update receipts set file_size=900000000 where id=1')
    const direct = await mustApi<{ success: boolean; warnLargeBackup?: boolean }>(
      window,
      'exportData'
    )
    expect(direct).toMatchObject({ success: false, warnLargeBackup: true })
    // 境界: 80%ちょうど(858,993,459)は警告なし、+1で警告(PDFが無いためfile_sizeのみが対象)
    dbExec(dataDir, 'update receipts set file_size=858993459 where id=1')
    expect((await mustApi<{ success: boolean }>(window, 'exportData')).success).toBe(true)
    dbExec(dataDir, 'update receipts set file_size=858993460 where id=1')
    expect(await mustApi(window, 'exportData')).toMatchObject({ warnLargeBackup: true })
    rmSync(zipPath, { force: true })
    // 画面: 警告の文言→中止
    const msgs: string[] = []
    window.once('dialog', async (d) => {
      msgs.push(d.message())
      await d.dismiss()
    })
    await window.getByRole('button', { name: 'データをエクスポート' }).click()
    await window.getByRole('button', { name: 'エクスポート実行' }).click()
    await expect.poll(() => msgs.length).toBe(1)
    expect(msgs[0]).toBe(
      '領収書の容量が大きいため、このファイルは復元できない可能性があります。続行しますか'
    )
    expect(() => statSync(zipPath)).toThrow() // 中止ではファイルを書かない
    await shot(window, 'TC-99', '警告ダイアログ後に中止(ファイルは作られない)')
    // 続行
    window.once('dialog', (d) => void d.accept())
    await window.getByRole('button', { name: 'エクスポート実行' }).click()
    await expect(window.getByText(/保存しました/)).toBeVisible()
    expect(statSync(zipPath).size).toBeGreaterThan(0)
    await shot(window, 'TC-99', '警告で「続行」を選ぶと書き出される')
    noteEvidence(
      'TC-99',
      '警告の閾値(復元上限1GiBの80%)',
      `858,993,459バイト: 警告なし/858,993,460バイト: 警告\n文言: ${msgs[0]}\n中止→書き出さない、続行→書き出す`
    )
    void app
  } finally {
    await closeApp(l).catch(() => rmSync(l.dataDir, { recursive: true, force: true }))
    rmSync(work, { recursive: true, force: true })
  }
})

test('TC-99c: [任意・I2_CAP_HUGE=1] 1GiB超のZIPを実際に書き出した場合の挙動(書き出し後に復元できるか)', async () => {
  test.skip(
    process.env.I2_CAP_HUGE !== '1',
    'I2_CAP_HUGE=1 のときのみ実行(10GB級のディスクとメモリを使用)'
  )
  test.setTimeout(1_500_000)
  const work = mkdtempSync(join(tmpdir(), 'jimuhub-i2-huge-'))
  const zipPath = join(work, 'huge.zip')
  const l = await launchApp({ JIMUHUB_E2E_EXPORT_PATH: zipPath, JIMUHUB_E2E_IMPORT_PATH: zipPath })
  try {
    const { window, app } = l
    const pid = app.process().pid as number
    await seedReceipts(l, work, 108, 10 * 1024 * 1024 - 100)
    let peak = 0
    const sampler = setInterval(() => {
      peak = Math.max(peak, rssMb(pid))
    }, 500)
    const warn = await mustApi<{ success: boolean; warnLargeBackup?: boolean }>(
      window,
      'exportData'
    )
    expect(warn.warnLargeBackup).toBe(true)
    const e0 = Date.now()
    const res = await mustApi<{ success: boolean; error?: string }>(window, 'exportData', {
      confirmLarge: true
    })
    const exportSec = (Date.now() - e0) / 1000
    const zipBytes = res.success ? statSync(zipPath).size : 0
    let importResult = '(書き出し失敗のため未実施)'
    if (res.success) {
      const i0 = Date.now()
      const r = await mustApi<{ success: boolean; error?: string }>(window, 'importData')
      importResult = `${JSON.stringify(r)}(${((Date.now() - i0) / 1000).toFixed(1)}秒)`
    }
    clearInterval(sampler)
    noteEvidence(
      'TC-99',
      '1GiB超のZIPの実測',
      `領収書108件(約1.05GiB)\n警告: あり\n書き出し: ${JSON.stringify(res)}、${exportSec.toFixed(1)}秒、ZIP=${(zipBytes / 1024 / 1024).toFixed(0)}MB(上限1024MB)、Mainメモリ(RSS)ピーク約${peak}MB\n復元: ${importResult}`
    )
  } finally {
    await closeApp(l).catch(() => rmSync(l.dataDir, { recursive: true, force: true }))
    rmSync(work, { recursive: true, force: true })
  }
})
