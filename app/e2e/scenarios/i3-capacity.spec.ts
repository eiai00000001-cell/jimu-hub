import { test, expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createWorkDir } from '../../test-support/work-dir.mjs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ElectronApplication } from '@playwright/test'
import { launchApp, type LaunchedApp } from '../fixtures/electron-app'
import { noteEvidence, shot } from './evidence-dir'
import { dbQuery, listFilesRecursive, sha256File } from './helpers'
import { accountId, createRecordApi, pickTokens } from './helpers-i2'

/**
 * 【tester作成】★F2: 1GiBに近い規模のバックアップ・復元のメモリ使用量・時間の実測(TC-121)、
 * 1GiBを超える場合の挙動(エクスポートの中止・復元のエラー。TC-122)。架空の乱数データのみ使用する。
 * 参照元: 詳細設計書 4.32章(受け入れの観点(a): Mainプロセスのヒープ使用量の増加が約100MB以内。基本設計書8.1章★31)
 * 規模: 環境変数 I3_CAP_FILES(既定104件×10,000,000バイト≒1.04GB。復元上限1GiBの97%)で変更する。
 * 領収書の生成は docs/07_test/tools/make-large-receipts.mjs を使う。
 */
const FILES = Number(process.env.I3_CAP_FILES ?? 104)
const FILE_BYTES = 10_000_000
const HEAP_LIMIT_MB = 100 // 合格基準(詳細設計書4.32章)
const here = fileURLToPath(new URL('.', import.meta.url))
const GENERATOR = join(
  here,
  '..',
  '..',
  '..',
  'docs',
  '07_test',
  'tools',
  'make-large-receipts.mjs'
)

interface Mem {
  heapUsed: number
  rss: number
  external: number
  arrayBuffers: number
}
const MB = 1024 * 1024

/** Mainプロセスのメモリ(ガベージコレクション後)。`--expose_gc`相当の関数をMain内で用意して呼ぶ */
async function mainMem(app: ElectronApplication, gc: boolean): Promise<Mem> {
  return app.evaluate((_e, doGc) => {
    const req =
      (process as unknown as { mainModule: { require: NodeRequire } }).mainModule?.require ??
      require
    if (doGc) {
      req('v8').setFlagsFromString('--expose_gc')
      const gcFn = req('vm').runInNewContext('gc') as () => void
      gcFn()
      gcFn()
    }
    const m = process.memoryUsage()
    return { heapUsed: m.heapUsed, rss: m.rss, external: m.external, arrayBuffers: m.arrayBuffers }
  }, gc)
}

/** アプリの全プロセス(Main・Renderer・GPU等の子孫)のRSSの合計(MB) */
function treeRssMb(rootPid: number): number {
  const out = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,rss='], { encoding: 'utf8' })
  const rows = out
    .trim()
    .split('\n')
    .map((l) => l.trim().split(/\s+/).map(Number))
  const children = new Map<number, number[]>()
  const rss = new Map<number, number>()
  for (const [pid, ppid, kb] of rows) {
    rss.set(pid, kb)
    children.set(ppid, [...(children.get(ppid) ?? []), pid])
  }
  let total = 0
  const stack = [rootPid]
  while (stack.length > 0) {
    const pid = stack.pop()!
    total += rss.get(pid) ?? 0
    stack.push(...(children.get(pid) ?? []))
  }
  return Math.round(total / 1024)
}

interface Sampling {
  samples: Array<{ t: number; heapMb: number; rssMainMb: number; rssTreeMb: number }>
  stop: () => void
  maxGapMs: () => number
}

/** 一定間隔(約250ms)でMainのヒープ・RSSを記録する。Mainが同期処理で塞がると、次の応答までの遅れ(maxGap)として現れる */
function startSampling(app: ElectronApplication, pid: number, t0: number): Sampling {
  const samples: Sampling['samples'] = []
  let running = true
  let maxGap = 0
  let last = Date.now()
  const loop = (async (): Promise<void> => {
    while (running) {
      try {
        const m = await mainMem(app, false)
        const now = Date.now()
        maxGap = Math.max(maxGap, now - last - 250)
        last = now
        samples.push({
          t: now - t0,
          heapMb: Math.round((m.heapUsed / MB) * 10) / 10,
          rssMainMb: Math.round(m.rss / MB),
          rssTreeMb: treeRssMb(pid)
        })
      } catch {
        /* アプリ終了時 */
      }
      await new Promise((r) => setTimeout(r, 250))
    }
  })()
  void loop
  return {
    samples,
    stop: () => {
      running = false
    },
    maxGapMs: () => maxGap
  }
}

function summarize(s: Sampling['samples'], baseHeapMb: number): string {
  if (s.length === 0) return '(サンプルなし)'
  const maxHeap = Math.max(...s.map((x) => x.heapMb))
  const maxRssMain = Math.max(...s.map((x) => x.rssMainMb))
  const maxRssTree = Math.max(...s.map((x) => x.rssTreeMb))
  return `サンプル数=${s.length}、ヒープ最大=${maxHeap}MB(基準${baseHeapMb.toFixed(1)}MBからの増加=${(maxHeap - baseHeapMb).toFixed(1)}MB)、Main RSS最大=${maxRssMain}MB、全プロセスRSS最大=${maxRssTree}MB`
}

async function seed(l: LaunchedApp, genDir: string, from: number, count: number): Promise<void> {
  execFileSync('node', [GENERATOR, genDir, String(count), String(FILE_BYTES), String(from)], {
    stdio: 'pipe'
  })
  const acc = await accountId(l.window, '消耗品費')
  for (let i = 0; i < count; i += 5) {
    const batch = Math.min(5, count - i)
    const paths = Array.from({ length: batch }, (_, k) =>
      join(genDir, `large_${String(from + i + k).padStart(3, '0')}.pdf`)
    )
    const t = await pickTokens(l.window, l.app, paths)
    expect(t.errors).toEqual([])
    await createRecordApi(l.window, {
      accountId: acc,
      description: `大容量確認 ${from + i + 1}〜${from + i + batch}`,
      receiptTokens: t.files.map((f) => f.token)
    })
  }
}

test('TC-121: [F-32・★F2] 1GiBに近いバックアップのエクスポート・復元で、Mainプロセスのヒープ使用量の増加が約100MB以内。所要時間・RSS・ハッシュ一致・一時ファイルの残存なし', async () => {
  test.setTimeout(1_500_000)
  const work = createWorkDir('e2e', 'jimuhub-i3-cap')
  const zipPath = join(work, 'big.zip')
  const genDir = join(work, 'gen')
  const lines: string[] = []

  // ---- エクスポート ----
  const src = await launchApp({ JIMUHUB_E2E_EXPORT_PATH: zipPath })
  const { window, app, dataDir } = src
  const pid = app.process().pid as number
  const s0 = Date.now()
  await seed(src, genDir, 0, FILES)
  const seedSec = (Date.now() - s0) / 1000
  const totalBytes = Number(dbQuery(dataDir, 'select sum(file_size) from receipts'))
  expect(Number(dbQuery(dataDir, 'select count(*) from receipts'))).toBe(FILES)
  lines.push(
    `データ: 領収書${FILES}件(1件${(FILE_BYTES / 1e6).toFixed(0)}MB・乱数=圧縮されにくい)、合計${(totalBytes / 1e6).toFixed(0)}MB(${((totalBytes / 1024 ** 3) * 100).toFixed(1)}% of 1GiB)。作成: ${seedSec.toFixed(0)}秒`
  )

  const baseSrc = await mainMem(app, true)
  const baseHeapSrc = baseSrc.heapUsed / MB
  lines.push(
    `[エクスポート] 開始前(GC後): ヒープ=${baseHeapSrc.toFixed(1)}MB、Main RSS=${(baseSrc.rss / MB).toFixed(0)}MB、全プロセスRSS=${treeRssMb(pid)}MB`
  )
  const e0 = Date.now()
  const sampling = startSampling(app, pid, e0)
  await window.getByRole('button', { name: 'データをエクスポート' }).click()
  // 見込みサイズが復元上限の80%を超えるため、確認(window.confirm)が出る。文言を記録して続行する
  let largeWarning = ''
  window.once('dialog', (d) => {
    largeWarning = d.message()
    void d.accept()
  })
  await window.getByRole('button', { name: 'エクスポート実行' }).click()
  await expect(window.getByText(/保存しました/)).toBeVisible({ timeout: 600_000 })
  lines.push(`[エクスポート] 大容量の確認(window.confirm): ${largeWarning || '(表示なし)'}`)
  const exportSec = (Date.now() - e0) / 1000
  sampling.stop()
  await new Promise((r) => setTimeout(r, 400))
  const afterExp = await mainMem(app, true)
  const zipBytes = statSync(zipPath).size
  const expSummary = summarize(sampling.samples, baseHeapSrc)
  const expMaxHeap = Math.max(...sampling.samples.map((x) => x.heapMb))
  const expIncrease = expMaxHeap - baseHeapSrc
  lines.push(
    `[エクスポート] 所要時間=${exportSec.toFixed(1)}秒、ZIP=${(zipBytes / 1e6).toFixed(0)}MB(${((zipBytes / 1024 ** 3) * 100).toFixed(1)}% of 1GiB)`
  )
  lines.push(`[エクスポート] ${expSummary}、Mainが応答しなかった最長=${sampling.maxGapMs()}ms`)
  lines.push(
    `[エクスポート] 完了後(GC後): ヒープ=${(afterExp.heapUsed / MB).toFixed(1)}MB(基準比${(afterExp.heapUsed / MB - baseHeapSrc).toFixed(1)}MB)`
  )
  noteEvidence(
    'TC-121',
    'エクスポート中のサンプリングログ(経過ms, ヒープMB, Main RSS MB, 全プロセスRSS MB)',
    sampling.samples.map((x) => `${x.t},${x.heapMb},${x.rssMainMb},${x.rssTreeMb}`).join('\n')
  )
  await shot(window, 'TC-121', '1GiB規模のエクスポート完了')
  // 作業用ファイル・一時フォルダが残らない
  expect(readdirSync(work).filter((n) => n.endsWith('.partial'))).toEqual([])
  const tmpSrc = join(dataDir, 'tmp')
  expect(existsSync(tmpSrc) ? readdirSync(tmpSrc) : []).toEqual([])
  expect(zipBytes).toBeLessThan(1024 ** 3) // 復元上限1GiB以内
  // ZIPに含まれる領収書のSHA-256(生成時の一覧と一致)
  const gen = JSON.parse(readFileSync(join(genDir, 'sha256.json'), 'utf8')) as Record<
    string,
    string
  >
  const dbHashes = dbQuery(dataDir, 'select sha256 from receipts order by sha256').split('\n')
  expect(dbHashes).toEqual(Object.values(gen).sort())
  await window.getByLabel('閉じる').click()
  await app.close()

  // ---- 復元(空のデータ保存先へ) ----
  const tgt = await launchApp({ JIMUHUB_E2E_IMPORT_PATH: zipPath })
  const tpid = tgt.app.process().pid as number
  const baseTgt = await mainMem(tgt.app, true)
  const baseHeapTgt = baseTgt.heapUsed / MB
  lines.push(
    `[復元] 開始前(GC後): ヒープ=${baseHeapTgt.toFixed(1)}MB、Main RSS=${(baseTgt.rss / MB).toFixed(0)}MB、全プロセスRSS=${treeRssMb(tpid)}MB`
  )
  await tgt.window.getByRole('button', { name: 'データを復元' }).click()
  await tgt.window.getByRole('button', { name: 'ファイルを選択して復元' }).click()
  const i0 = Date.now()
  const sampling2 = startSampling(tgt.app, tpid, i0)
  await tgt.window.getByRole('button', { name: '続行' }).click()
  let shotTaken = false
  for (let i = 0; i < 4000 && !shotTaken; i++) {
    const txt = await tgt.window
      .locator('.modal')
      .innerText()
      .catch(() => '')
    if (/復元しています\(\d+\/\d+\)/.test(txt)) {
      await shot(tgt.window, 'TC-121', '復元中の進捗表示(領収書・PDFを復元しています)')
      shotTaken = true
    } else if (/復元が完了|復元に失敗|読み込めません/.test(txt)) break
    await tgt.window.waitForTimeout(150)
  }
  const done = tgt.window.locator('.modal .message-success, .modal .message-error')
  await expect(done).toBeVisible({ timeout: 600_000 })
  const importSec = (Date.now() - i0) / 1000
  sampling2.stop()
  await new Promise((r) => setTimeout(r, 400))
  const msg = await done.innerText()
  const afterImp = await mainMem(tgt.app, true)
  const impSummary = summarize(sampling2.samples, baseHeapTgt)
  const impMaxHeap = Math.max(...sampling2.samples.map((x) => x.heapMb))
  const impIncrease = impMaxHeap - baseHeapTgt
  lines.push(`[復元] 所要時間=${importSec.toFixed(1)}秒`)
  lines.push(`[復元] ${impSummary}、Mainが応答しなかった最長=${sampling2.maxGapMs()}ms`)
  lines.push(
    `[復元] 完了後(GC後): ヒープ=${(afterImp.heapUsed / MB).toFixed(1)}MB(基準比${(afterImp.heapUsed / MB - baseHeapTgt).toFixed(1)}MB)`
  )
  lines.push(`[復元] 結果: ${msg}`)
  noteEvidence(
    'TC-121',
    '復元中のサンプリングログ(経過ms, ヒープMB, Main RSS MB, 全プロセスRSS MB)',
    sampling2.samples.map((x) => `${x.t},${x.heapMb},${x.rssMainMb},${x.rssTreeMb}`).join('\n')
  )
  await shot(tgt.window, 'TC-121', '1GiB規模の復元完了(改変の警告なし)')
  expect(msg).toContain('復元が完了しました')
  expect(msg).not.toContain('改変')
  // データのハッシュ一致(DBの記録・復元したファイルのSHA-256が、生成時の一覧と一致)
  const restoredFiles = listFilesRecursive(join(tgt.dataDir, 'documents', 'receipts'))
  expect(restoredFiles).toHaveLength(FILES)
  const restoredHashes = restoredFiles.map((f) => sha256File(f)).sort()
  expect(restoredHashes).toEqual(Object.values(gen).sort())
  expect(dbQuery(tgt.dataDir, 'select sha256 from receipts order by sha256').split('\n')).toEqual(
    restoredHashes
  )
  const tmpTgt = join(tgt.dataDir, 'tmp')
  expect(existsSync(tmpTgt) ? readdirSync(tmpTgt) : []).toEqual([])
  lines.push(
    `[整合] 復元したファイル${FILES}件のSHA-256は、生成時の一覧・DBの記録と一致。一時フォルダ・作業用ファイルの残存なし`
  )

  // ---- 判定 ----
  lines.push(
    `[判定] ヒープ使用量の増加: エクスポート${expIncrease.toFixed(1)}MB、復元${impIncrease.toFixed(1)}MB(基準${HEAP_LIMIT_MB}MB以内)`
  )
  noteEvidence('TC-121', '1GiB規模の実測結果(まとめ)', lines.join('\n'))
  expect(expIncrease, 'エクスポートのヒープ増加').toBeLessThanOrEqual(HEAP_LIMIT_MB)
  expect(impIncrease, '復元のヒープ増加').toBeLessThanOrEqual(HEAP_LIMIT_MB)
  await tgt.app.close()
})

test('TC-122: [F-32] 1GiBを超える場合。エクスポートは見込みサイズの時点で中止して何も書き出さず、復元は上限超過の専用文言で中止して現在のデータは変わらない', async () => {
  test.setTimeout(1_500_000)
  const work = createWorkDir('e2e', 'jimuhub-i3-over')
  const zipPath = join(work, 'over.zip')
  const genDir = join(work, 'gen')
  const OVER = Math.ceil((1024 ** 3 * 1.02) / FILE_BYTES) // 上限1GiBを約2%超える件数
  const l = await launchApp({ JIMUHUB_E2E_EXPORT_PATH: zipPath })
  const { window, app, dataDir } = l
  await seed(l, genDir, 0, OVER)
  const total = Number(dbQuery(dataDir, 'select sum(file_size) from receipts'))
  expect(total).toBeGreaterThan(1024 ** 3)
  const log: string[] = [
    `領収書${OVER}件、合計${(total / 1e6).toFixed(0)}MB(1GiB=${(1024 ** 3 / 1e6).toFixed(0)}MB を超える)`
  ]
  // エクスポート(画面): 中止され、ファイルが作られない
  await window.getByRole('button', { name: 'データをエクスポート' }).click()
  await window.getByRole('button', { name: 'エクスポート実行' }).click()
  const err = window.locator('.modal .message-error')
  await expect(err).toBeVisible({ timeout: 300_000 })
  const errText = await err.innerText()
  expect(errText).toContain('復元できる上限(1GB)を超えるため、エクスポートを中止しました')
  expect(existsSync(zipPath)).toBe(false)
  expect(existsSync(`${zipPath}.partial`)).toBe(false)
  const tmp = join(dataDir, 'tmp')
  expect(existsSync(tmp) ? readdirSync(tmp) : []).toEqual([])
  await shot(window, 'TC-122', '1GiB超のエクスポートは中止され、理由が表示される')
  log.push(
    `エクスポート: ${errText.replace(/\s+/g, ' ')}。ZIP・作業用ファイル・一時フォルダは作られていない`
  )
  await window.getByLabel('閉じる').click()
  // 復元: 1GiBを超えるファイル(ZIPの先頭を持つ疎ファイル)は、読み込み前に上限超過として拒否される。現在のデータは変わらない
  const huge = join(work, 'huge.zip')
  execFileSync('sh', [
    '-c',
    `printf 'PK\\003\\004' > "${huge}" && truncate -s 1073741825 "${huge}"`
  ])
  const before = dbQuery(dataDir, 'select count(*), sum(file_size) from receipts')
  const { setEnv } = await import('./helpers-i2')
  await setEnv(app, 'JIMUHUB_E2E_IMPORT_PATH', huge)
  await window.getByRole('button', { name: 'データを復元' }).click()
  await window.getByRole('button', { name: 'ファイルを選択して復元' }).click()
  await window.getByRole('button', { name: '続行' }).click()
  const impErr = window.locator('.modal .message-error')
  await expect(impErr).toBeVisible({ timeout: 60_000 })
  const impText = await impErr.innerText()
  expect(impText).toContain('復元できる上限(1GB)を超えているため、読み込めませんでした')
  expect(dbQuery(dataDir, 'select count(*), sum(file_size) from receipts')).toBe(before)
  expect(existsSync(tmp) ? readdirSync(tmp) : []).toEqual([])
  await shot(window, 'TC-122', '1GiB超のファイルの復元は上限超過の専用文言で中止される')
  log.push(
    `復元(1GiB+1バイトのファイル): ${impText.replace(/\s+/g, ' ')}。現在のデータは変わらない`
  )
  noteEvidence('TC-122', '1GiB超の挙動', log.join('\n'))
  void createHash
  void (null as unknown as Page)
})
