import { test, expect, type Page } from '@playwright/test'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/electron-app'
import { noteEvidence, shot } from './evidence-dir'
import { createClientApi, dbQuery, listFilesRecursive, setupCompany, sha256File } from './helpers'
import {
  accountId,
  createRecordApi,
  dbExec,
  dumpAll,
  makeReceiptFixtures,
  mustApi,
  pickTokens,
  setEnv,
  type Fixtures
} from './helpers-i2'
import {
  createProjectApi,
  finalizeInvoiceWithProject,
  finalizeQuoteWithProject,
  getProjectApi,
  saveQuoteDraftApi
} from './helpers-i3'
import {
  buildZip,
  exportToLegacyJson,
  mapExportTable,
  overwriteDeclaredSizes,
  readExport,
  readZipEntries
} from '../../src/main/services/backup/test-helpers'

/**
 * 【tester作成】イテレーション3: バックアップ・復元のストリーム化(F-32)、旧形式ZIPの復元前確認(F-33)、
 * 案件のバックアップ対象化と復元時の補正(★F8)(TC-114〜TC-118)。
 * 参照元: 詳細設計書 4.2章・4.3章・4.32章・4.33章・6.15章・8章
 */

let workDir: string
let fx: Fixtures
let launched: LaunchedApp | undefined

test.beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'jimuhub-i3-backup-'))
  fx = makeReceiptFixtures()
})
// 作業用の一時フォルダは、ユーザーの許可なく削除しない運用のため、削除せずに残す(場所はテスト結果報告書に記載)
test.afterAll(() => {
  void fx
})
test.afterEach(async () => {
  if (launched) await closeApp(launched)
  launched = undefined
})

async function start(extraEnv: Record<string, string> = {}): Promise<LaunchedApp> {
  launched = await launchApp(extraEnv)
  return launched
}

/** 案件・付け替え履歴を含む、全テーブルの内容(ID順)を文字列化する */
function dumpAllI3(dataDir: string): string {
  return [
    dumpAll(dataDir, dbQuery),
    dbQuery(dataDir, 'select * from projects order by id'),
    dbQuery(dataDir, 'select * from project_link_history order by id')
  ].join('\n--\n')
}

async function importViaUi(window: Page, confirm = false): Promise<string> {
  await window.getByRole('button', { name: 'ホーム' }).click()
  await window.getByRole('button', { name: 'データを復元' }).click()
  await window.getByRole('button', { name: 'ファイルを選択して復元' }).click()
  await window.getByRole('button', { name: '続行' }).click()
  if (confirm) await window.getByRole('button', { name: '復元する' }).click()
  const message = window.locator('.modal .message-success, .modal .message-error')
  await expect(message).toBeVisible()
  return message.innerText()
}

async function trackProgress(window: Page): Promise<void> {
  await window.evaluate(() => {
    const w = window as unknown as {
      __p: unknown[]
      jimuhubApi: { onDataProgress: (cb: (p: unknown) => void) => void }
    }
    w.__p = []
    w.jimuhubApi.onDataProgress((p) => w.__p.push(p))
  })
}
async function progressLog(
  window: Page
): Promise<Array<{ phase: string; stage: string; current: number; total: number }>> {
  return window.evaluate(
    () =>
      (
        window as unknown as {
          __p: Array<{ phase: string; stage: string; current: number; total: number }>
        }
      ).__p
  )
}

/** 案件・紐づけ・領収書・履歴を含む元データを作り、エクスポートして返す */
async function buildSource(zipPath: string): Promise<{ summaryA: unknown; dump: string }> {
  const src = await start({ JIMUHUB_E2E_EXPORT_PATH: zipPath })
  const { window, dataDir, app } = src
  await setupCompany(window)
  const client = await createClientApi(window, '案件往復商事株式会社', {
    furigana: 'アンケンオウフクショウジ'
  })
  const A = await createProjectApi(window, {
    name: '往復の案件A',
    clientId: client,
    startDate: '2026-10-01',
    endDate: '2026-12-31',
    memo: '往復確認'
  })
  const B = await createProjectApi(window, { name: '往復の案件B(完了)' })
  const q = await finalizeQuoteWithProject(window, {
    clientId: client,
    unitPrice: 30000,
    projectId: A
  })
  const inv = await finalizeInvoiceWithProject(window, {
    clientId: client,
    unitPrice: 100000,
    projectId: A,
    withholding: true
  })
  await mustApi(window, 'updateInvoicePaymentStatus', inv.id, {
    paymentStatus: 'paid',
    paymentDate: '2026-10-20'
  })
  const acc = await accountId(window, '通信費')
  const { files } = await pickTokens(window, app, [fx.pdf])
  const rec = await createRecordApi(window, {
    accountId: acc,
    description: '往復の経費(領収書つき)',
    amount: 8800,
    receiptTokens: files.map((f) => f.token),
    projectId: A
  } as never)
  void rec
  const rec2 = await createRecordApi(window, {
    accountId: acc,
    description: '付け替える経費',
    amount: 1000,
    projectId: A
  } as never)
  await mustApi(window, 'changeProjectLink', {
    targetType: 'cash_record',
    targetId: rec2,
    projectId: B
  })
  const draft = await saveQuoteDraftApi(window, client, A)
  await mustApi(window, 'deleteQuoteDraft', draft)
  await mustApi(window, 'completeProject', B)
  void q
  const summaryA = (await getProjectApi(window, A)).summary
  const dump = dumpAllI3(dataDir)
  await window.getByRole('button', { name: 'データをエクスポート' }).click()
  await window.getByRole('button', { name: 'エクスポート実行' }).click()
  await expect(window.getByText(/保存しました/)).toBeVisible()
  await closeApp(src)
  launched = undefined
  return { summaryA, dump }
}

test('TC-114: [F-32] ストリーム方式のエクスポート→復元の往復。案件・紐づけ・付け替え履歴・領収書が完全に一致し、manifest・JSON Lines形式、作業用ファイル・一時フォルダが残らない', async () => {
  const zip = join(workDir, 'roundtrip.zip')
  const { summaryA, dump } = await buildSource(zip)

  // 形式: manifest.json + data/<テーブル>.jsonl、PDF・領収書の実体。作業用の.partialは残らない
  const exp = readExport(zip)
  expect(exp.manifest.schemaVersion).toBe(5)
  expect(exp.manifest.tables.projects.count).toBe(2)
  expect(exp.manifest.tables.projectLinkHistory.count).toBeGreaterThanOrEqual(6)
  expect(exp.records('projects').map((r) => r.name)).toEqual(['往復の案件A', '往復の案件B(完了)'])
  expect(readdirSync(workDir).filter((n) => n.endsWith('.partial'))).toEqual([])
  const names = [...exp.entries.keys()]
  expect(names.filter((n) => n.startsWith('documents/receipts/'))).toHaveLength(1)
  expect(names.filter((n) => /^documents\/(quotes|invoices)\/.*\.pdf$/.test(n))).toHaveLength(2)
  noteEvidence(
    'TC-114',
    'エクスポートZIPのmanifestとエントリ一覧',
    `${JSON.stringify(exp.manifest, null, 2)}\n--\n${names.join('\n')}`
  )

  // 空のデータ保存先へ復元(進捗も記録)
  const { window, dataDir } = await start({ JIMUHUB_E2E_IMPORT_PATH: zip })
  await trackProgress(window)
  const msg = await importViaUi(window)
  expect(msg).toMatch(/復元が完了しました\(\d+件\)/)
  expect(msg).not.toContain('改変')
  expect(msg).not.toContain('案件への紐づけ')
  await shot(window, 'TC-114', '案件・領収書を含むZIPの復元完了(警告なし)')
  const progress = await progressLog(window)
  const stages = new Set(progress.map((p) => `${p.phase}:${p.stage}`))
  expect(stages.has('import:extract')).toBe(true)
  expect(stages.has('import:verify')).toBe(true)
  // DB・ファイルの完全一致(案件・付け替え履歴を含む)
  expect(dumpAllI3(dataDir)).toBe(dump)
  expect(listFilesRecursive(join(dataDir, 'documents', 'receipts'))).toHaveLength(1)
  // 作業用の一時フォルダは、成功後に残らない
  const tmp = join(dataDir, 'tmp')
  const leftover = existsSync(tmp) ? readdirSync(tmp) : []
  expect(leftover).toEqual([])
  await window.getByLabel('閉じる').click()

  // 復元後の案件別収支・付け替え履歴・追記専用トリガー・採番の継続
  const sumA = (await getProjectApi(window, 1)).summary
  expect(sumA).toEqual(summaryA)
  expect(() => dbExec(dataDir, "update project_link_history set target_label='x'")).toThrow()
  expect(() => dbExec(dataDir, 'delete from project_link_history')).toThrow()
  const nextProject = await createProjectApi(window, { name: '復元後の案件' })
  expect(nextProject).toBe(3)
  await window.getByRole('button', { name: '案件管理' }).click()
  await window.locator('#project-status').selectOption('all')
  await expect(window.locator('tbody tr')).toHaveCount(3)
  await window.getByRole('cell', { name: '往復の案件A' }).click()
  await expect(window.getByText('付け替え履歴')).toBeVisible()
  await shot(
    window,
    'TC-114',
    '復元後の案件詳細(案件別収支・紐づく書類と記録・付け替え履歴が復元されている)'
  )
  noteEvidence(
    'TC-114',
    '往復の照合',
    `全テーブル(案件・付け替え履歴を含む)のダンプ一致(${dump.split('\n').length}行)\n進捗の段階: ${[...stages].join(', ')}\n一時フォルダ(tmp)の残存: ${leftover.length}件\n案件別収支: ${JSON.stringify(sumA)}`
  )
})

test('TC-115: [F-32] 復元時の上限・異常系。宣言値の偽装・エントリ数超過・展開中の破損・案件の制約違反で、現在のデータが変わらず、一時フォルダが残らない。起動時に残骸を削除する', async () => {
  const zip = join(workDir, 'limits-source.zip')
  await buildSource(zip)

  const { window, dataDir, app } = await start({ JIMUHUB_E2E_IMPORT_PATH: zip })
  await setupCompany(window)
  const c = await createClientApi(window, '現在のデータの取引先')
  const cur = await createProjectApi(window, { name: '現在の案件', clientId: c })
  void cur
  const before = dumpAllI3(dataDir)
  const log: string[] = []
  const setImport = async (p: string): Promise<void> => setEnv(app, 'JIMUHUB_E2E_IMPORT_PATH', p)
  const tryImport = async (
    label: string,
    path: string,
    expectMsg: RegExp | string
  ): Promise<void> => {
    await setImport(path)
    const r = await mustApi<{ success: boolean; error?: string }>(window, 'importData')
    expect(r.success, label).toBe(false)
    if (typeof expectMsg === 'string') expect(r.error, label).toContain(expectMsg)
    else expect(r.error, label).toMatch(expectMsg)
    expect(dumpAllI3(dataDir), `${label}: 現在のデータは変わらない`).toBe(before)
    const tmp = join(dataDir, 'tmp')
    expect(existsSync(tmp) ? readdirSync(tmp) : [], `${label}: 一時フォルダが残らない`).toEqual([])
    log.push(`${label}: ${r.error}`)
  }

  // (a) 宣言値の偽装(解凍爆弾): 展開前の目録で、宣言サイズの合計が上限(2GiB)を超える
  const forged = join(workDir, 'forged-size.zip')
  copyFileSync(zip, forged)
  overwriteDeclaredSizes(forged, 1500 * 1024 * 1024, 100)
  await tryImport('宣言値の偽装(合計2GiB超)', forged, '復元できる上限')

  // (b) エントリ数が10万件を超える
  const many = join(workDir, 'many-entries.zip')
  const entries: Record<string, Buffer | string> = {
    'manifest.json': readZipEntries(zip).get('manifest.json')!
  }
  for (let i = 0; i < 100_001; i += 1) entries[`documents/receipts/2026/${i}.txt`] = ''
  buildZip(many, entries)
  await tryImport('エントリ数が10万件超', many, /読み込めませんでした|上限/)

  // (c) manifest.jsonの宣言と実際のレコードが食い違うZIP・テーブルの欠落
  const noTable = join(workDir, 'no-table.zip')
  copyFileSync(zip, noTable)
  const z = new AdmZip(noTable)
  z.deleteFile('data/clients.jsonl')
  z.writeZip(noTable)
  await setImport(noTable)
  const rNoTable = await mustApi<{ success: boolean; error?: string }>(window, 'importData')
  log.push(`テーブルのjsonlが欠落: success=${rNoTable.success} ${rNoTable.error ?? ''}`)
  expect(rNoTable.success).toBe(false)
  expect(dumpAllI3(dataDir)).toBe(before)

  // (d) 展開中の破損: 圧縮データ(data/projects.jsonl)の途中のバイトを書き換える(展開時にエラーになる)
  const corrupt = join(workDir, 'corrupt-entry.zip')
  copyFileSync(zip, corrupt)
  {
    const bytes = readFileSync(corrupt)
    const name = Buffer.from('data/projects.jsonl')
    const nameAt = bytes.indexOf(name)
    const headerAt = nameAt - 30
    expect(bytes.readUInt32LE(headerAt)).toBe(0x04034b50)
    const dataAt =
      headerAt + 30 + bytes.readUInt16LE(headerAt + 26) + bytes.readUInt16LE(headerAt + 28)
    const method = bytes.readUInt16LE(headerAt + 8)
    expect(method).toBe(8) // deflate
    bytes[dataAt] = 0xff
    bytes[dataAt + 1] = 0xff
    writeFileSync(corrupt, bytes)
  }
  await tryImport('展開中の破損(圧縮データ)', corrupt, /./)

  // (e) 案件の制約違反(状態が不正)→入れ替え中の失敗: ロールバックと退避からの復旧で元に戻る
  await setImport(zip)
  await mustApi(window, 'importData') // いったん正常に復元して、復元後の状態を基準にする
  const base = dumpAllI3(dataDir)
  const badStatus = join(workDir, 'bad-project-status.zip')
  copyFileSync(zip, badStatus)
  mapExportTable(badStatus, 'projects', (r, i) => (i === 0 ? { ...r, status: 'unknown' } : r))
  await setImport(badStatus)
  const rBad = await mustApi<{ success: boolean; error?: string }>(window, 'importData')
  expect(rBad.success).toBe(false)
  expect(rBad.error).toContain('復元に失敗しました。データは復元前の状態に戻しました')
  expect(dumpAllI3(dataDir)).toBe(base)
  expect(listFilesRecursive(join(dataDir, 'documents', 'receipts'))).toHaveLength(1)
  expect(() => dbExec(dataDir, 'delete from project_link_history')).toThrow() // トリガーも維持
  log.push(`案件の制約違反(status=unknown): ${rBad.error}。DB・領収書は復元前と同一、トリガー維持`)
  const tmp = join(dataDir, 'tmp')
  expect(existsSync(tmp) ? readdirSync(tmp) : []).toEqual([])

  // (f) 起動時に、異常終了で残った一時フォルダを削除する(詳細設計書4.1章手順0-2)
  await app.close()
  mkdirSync(join(dataDir, 'tmp', 'restore-20260101-000000', 'documents'), { recursive: true })
  writeFileSync(join(dataDir, 'tmp', 'restore-20260101-000000', 'documents', 'junk.pdf'), 'junk')
  const { relaunchOnDir } = await import('./helpers-i2')
  const re = await relaunchOnDir(dataDir)
  await expect(re.window.getByText('事務HUB').first()).toBeVisible()
  const remains = existsSync(join(dataDir, 'tmp')) ? readdirSync(join(dataDir, 'tmp')) : []
  expect(remains).toEqual([])
  log.push('起動時: 残っていた一時フォルダ(restore-*)を削除')
  await re.app.close()
  launched = undefined
  noteEvidence('TC-115', '上限・異常系の結果(いずれも現在のデータは変わらない)', log.join('\n'))
})

let sharedZip: string | undefined
async function getSharedZip(): Promise<string> {
  if (!sharedZip) {
    sharedZip = join(workDir, 'shared-source.zip')
    await buildSource(sharedZip)
  }
  return sharedZip
}

interface Inspection {
  token: string
  fileName: string
  schemaVersion: number
  hasReceipts: boolean
  hasProjects: boolean
  currentReceiptCount: number
  currentProjectCount: number
  needsConfirmation: boolean
}

async function inspect(window: Page, label: string): Promise<Inspection> {
  const r = await mustApi<{ success: boolean; inspection?: Inspection; error?: string }>(
    window,
    'inspectBackup'
  )
  if (!r.success || !r.inspection) throw new Error(`inspectBackup(${label}) failed: ${r.error}`)
  return r.inspection
}

/** 版5のZIPから、案件(または領収書)を含まないZIPを作る */
function dropFromV5(
  src: string,
  name: string,
  drop: { projects?: boolean; receipts?: boolean }
): string {
  const out = join(workDir, name)
  copyFileSync(src, out)
  const z = new AdmZip(out)
  const manifest = JSON.parse(z.readAsText('manifest.json')) as {
    tables: Record<string, { file: string; count: number }>
  }
  if (drop.projects) {
    z.updateFile('data/projects.jsonl', Buffer.from('\n'))
    z.updateFile('data/projectLinkHistory.jsonl', Buffer.from('\n'))
    manifest.tables.projects.count = 0
    manifest.tables.projectLinkHistory.count = 0
  }
  if (drop.receipts) {
    z.updateFile('data/receipts.jsonl', Buffer.from('\n'))
    manifest.tables.receipts.count = 0
    for (const e of z.getEntries())
      if (e.entryName.startsWith('documents/receipts/')) z.deleteFile(e)
  }
  z.updateFile('manifest.json', Buffer.from(JSON.stringify(manifest)))
  z.writeZip(out)
  return out
}

test('TC-116: [F-33] 復元前の確認の判定。領収書・案件を含まないバックアップ(旧形式のJSON・ZIP、案件のない版5)を、現在の領収書・案件の有無との組み合わせごとに確認画面の要否が決まる', async () => {
  const src = await getSharedZip()
  const legacyJson = join(workDir, 'legacy-v3.json')
  writeFileSync(
    legacyJson,
    JSON.stringify({
      schemaVersion: 3,
      appVersion: '0.2.0',
      exportedAt: '2026-09-28T00:00:00.000Z',
      data: { clients: [] }
    })
  )
  // 従来形式のZIP(版4: data.json 1本。領収書あり・案件なし)
  const legacy = exportToLegacyJson(src, 4) as { data: Record<string, unknown> }
  delete legacy.data.projects
  delete legacy.data.projectLinkHistory
  for (const t of ['quotes', 'invoices', 'cashRecords'])
    for (const row of legacy.data[t] as Array<Record<string, unknown>>) delete row.projectId
  const legacyEntries: Record<string, Buffer | string> = { 'data.json': JSON.stringify(legacy) }
  for (const [n, c] of readZipEntries(src)) if (n.startsWith('documents/')) legacyEntries[n] = c
  const legacyZip4 = join(workDir, 'legacy-v4.zip')
  buildZip(legacyZip4, legacyEntries)
  // 従来形式のZIP(版4の領収書0件)
  const legacy4NoReceipts = {
    ...legacy,
    data: { ...legacy.data, receipts: [], cashRecords: [], cashRecordHistory: [] }
  }
  const legacyZip4Empty = join(workDir, 'legacy-v4-no-receipts.zip')
  buildZip(legacyZip4Empty, { 'data.json': JSON.stringify(legacy4NoReceipts) })
  const v5NoProjects = dropFromV5(src, 'v5-no-projects.zip', { projects: true })
  const v5NoReceipts = dropFromV5(src, 'v5-no-receipts.zip', { receipts: true })

  const files: Array<{
    label: string
    path: string
    hasR: boolean
    hasP: boolean
    schema: number
  }> = [
    { label: '旧形式JSON(版3)', path: legacyJson, hasR: false, hasP: false, schema: 3 },
    {
      label: '従来形式ZIP(版4・領収書あり・案件なし)',
      path: legacyZip4,
      hasR: true,
      hasP: false,
      schema: 4
    },
    {
      label: '従来形式ZIP(版4・領収書0件)',
      path: legacyZip4Empty,
      hasR: false,
      hasP: false,
      schema: 4
    },
    { label: '版5(案件0件・領収書あり)', path: v5NoProjects, hasR: true, hasP: false, schema: 5 },
    { label: '版5(領収書0件・案件あり)', path: v5NoReceipts, hasR: false, hasP: true, schema: 5 },
    { label: '版5(領収書・案件とも含む)', path: src, hasR: true, hasP: true, schema: 5 }
  ]

  const { window, dataDir, app } = await start()
  await setupCompany(window)
  const client = await createClientApi(window, '確認画面の判定商事')
  const acc = await accountId(window, '通信費')
  const { files: picked } = await pickTokens(window, app, [fx.pdf])
  const rec = await createRecordApi(window, {
    accountId: acc,
    description: '領収書つきの経費',
    receiptTokens: picked.map((f) => f.token)
  })
  const proj = await createProjectApi(window, { name: '現在の案件', clientId: client })
  const lines: string[] = [
    '現在の状態(領収書,案件) | ファイル | schema | hasReceipts | hasProjects | 現在の領収書 | 現在の案件 | needsConfirmation(期待) '
  ]
  const states: Array<{ r: number; p: number; setup: () => Promise<void> }> = [
    { r: 1, p: 1, setup: async () => undefined },
    {
      r: 0,
      p: 1,
      setup: async () => {
        const d = await mustApi<{ receipts: Array<{ id: number }> }>(window, 'getRecord', rec)
        await mustApi(window, 'updateRecord', {
          id: rec,
          kind: 'expense',
          recordDate: '2026-10-01',
          amount: 1100,
          accountId: acc,
          description: '領収書つきの経費',
          clientId: null,
          paymentMethod: null,
          taxCategory: null,
          reason: '領収書を外す',
          removeReceiptIds: d.receipts.map((x) => x.id),
          addReceiptTokens: []
        })
      }
    },
    { r: 0, p: 0, setup: async () => void (await mustApi(window, 'deleteProject', proj)) },
    {
      r: 1,
      p: 0,
      setup: async () => {
        const { files: again } = await pickTokens(window, app, [fx.png])
        await createRecordApi(window, {
          accountId: acc,
          description: '領収書を再度つける',
          receiptTokens: again.map((f) => f.token)
        })
      }
    }
  ]
  for (const st of states) {
    await st.setup()
    for (const f of files) {
      await setEnv(app, 'JIMUHUB_E2E_IMPORT_PATH', f.path)
      const r = await inspect(window, f.label)
      const expected = (!f.hasR && st.r >= 1) || (!f.hasP && st.p >= 1)
      lines.push(
        `(${st.r},${st.p}) | ${f.label} | ${r.schemaVersion} | ${r.hasReceipts} | ${r.hasProjects} | ${r.currentReceiptCount} | ${r.currentProjectCount} | ${r.needsConfirmation}(期待 ${expected})`
      )
      expect(r.schemaVersion, `${f.label}`).toBe(f.schema)
      expect(r.hasReceipts, `${f.label} hasReceipts`).toBe(f.hasR)
      expect(r.hasProjects, `${f.label} hasProjects`).toBe(f.hasP)
      expect(r.currentReceiptCount).toBeGreaterThanOrEqual(st.r === 0 ? 0 : 1)
      expect(r.currentProjectCount).toBe(st.p)
      expect(r.needsConfirmation, `(${st.r},${st.p}) ${f.label}`).toBe(expected)
      await mustApi(window, 'discardBackup', r.token)
    }
  }
  // 確認の前後で、現在のデータは変わらない(確認だけでは何も変更しない)
  noteEvidence('TC-116', '確認画面の要否の判定表(inspectBackupの結果)', lines.join('\n'))
  expect(existsSync(dataDir)).toBe(true)
})

test('TC-117: [F-33] 復元前の確認画面の操作。領収書・案件が消える旨の表示、「キャンセル」が初期フォーカス、キャンセルで何も変更せずトークン破棄、「復元する」で復元、確認不要の場合は直接復元、ファイル変更の検知', async () => {
  const src = await getSharedZip()
  const legacyJson = join(workDir, 'legacy-for-ui.json')
  writeFileSync(
    legacyJson,
    JSON.stringify({
      schemaVersion: 3,
      appVersion: '0.2.0',
      exportedAt: '2026-09-28T00:00:00.000Z',
      data: { clients: [] }
    })
  )
  const { window, dataDir, app } = await start({ JIMUHUB_E2E_IMPORT_PATH: legacyJson })
  await setupCompany(window)
  const client = await createClientApi(window, '確認画面の操作商事')
  const acc = await accountId(window, '通信費')
  const { files: picked } = await pickTokens(window, app, [fx.pdf])
  await createRecordApi(window, {
    accountId: acc,
    description: '領収書つきの経費',
    receiptTokens: picked.map((f) => f.token)
  })
  await createProjectApi(window, { name: '現在の案件', clientId: client })
  await createProjectApi(window, { name: '現在の案件その2' })
  const before = dumpAllI3(dataDir)

  // 確認画面
  await window.getByRole('button', { name: 'ホーム' }).click()
  await window.getByRole('button', { name: 'データを復元' }).click()
  await window.getByRole('button', { name: 'ファイルを選択して復元' }).click()
  await window.getByRole('button', { name: '続行' }).click()
  await expect(window.getByText('復元前の確認')).toBeVisible()
  await expect(
    window.getByText('選択したバックアップを復元すると、次のデータが消えます。')
  ).toBeVisible()
  await expect(
    window.getByText(
      'このバックアップには領収書が含まれていないため、復元すると現在の領収書(1件)はすべて消えます。'
    )
  ).toBeVisible()
  await expect(
    window.getByText(
      'このバックアップには案件のデータが含まれていないため、復元すると現在の案件(2件)と、案件への紐づけ・付け替え履歴はすべて消えます。'
    )
  ).toBeVisible()
  await expect(
    window.getByText('復元前の状態は自動で退避され、直近3回分が保存されます。')
  ).toBeVisible()
  // 「キャンセル」が初期フォーカス(誤操作で復元しない)
  const focused = await window.evaluate(() => document.activeElement?.textContent ?? '')
  expect(focused).toBe('キャンセル')
  await shot(
    window,
    'TC-117',
    '復元前の確認画面(領収書・案件が消える旨、「キャンセル」が初期フォーカス)'
  )
  // キャンセル: 何も変更されず、最初の状態へ戻る。選択したファイルのトークンは破棄される
  await window.getByRole('button', { name: 'キャンセル' }).click()
  await expect(window.getByRole('button', { name: 'ファイルを選択して復元' })).toBeVisible()
  expect(dumpAllI3(dataDir)).toBe(before)
  expect(
    existsSync(join(dataDir, 'backups')) ? readdirSync(join(dataDir, 'backups')).length : 0
  ).toBe(0)
  // 「復元する」
  await window.getByRole('button', { name: 'ファイルを選択して復元' }).click()
  await window.getByRole('button', { name: '続行' }).click()
  await window.getByRole('button', { name: '復元する' }).click()
  await expect(window.getByText(/復元が完了しました/)).toBeVisible()
  await shot(window, 'TC-117', '「復元する」を選んだ後の完了表示')
  expect(dbQuery(dataDir, 'select count(*) from projects')).toBe('0')
  expect(dbQuery(dataDir, 'select count(*) from receipts')).toBe('0')
  expect(readdirSync(join(dataDir, 'backups')).length).toBeGreaterThanOrEqual(1) // 復元前の状態が退避される
  await window.getByLabel('閉じる').click()

  // 確認が不要な場合(現在の領収書・案件がない状態、または含むバックアップ)は、確認画面を出さず直接復元する
  await setEnv(app, 'JIMUHUB_E2E_IMPORT_PATH', legacyJson)
  const msg = await importViaUi(window)
  expect(msg).toMatch(/復元が完了しました/)
  await window.getByLabel('閉じる').click()
  await setEnv(app, 'JIMUHUB_E2E_IMPORT_PATH', src)
  const msg2 = await importViaUi(window) // 案件・領収書を含むバックアップ: 確認なし
  expect(msg2).toMatch(/復元が完了しました/)
  await window.getByLabel('閉じる').click()
  expect(dbQuery(dataDir, 'select count(*) from projects')).toBe('2')
  // 現在の案件があり、案件を含まない版5を復元しようとすると、案件のみの確認が出る(領収書は含むため出ない)
  const noProj = dropFromV5(src, 'v5-no-projects-ui.zip', { projects: true })
  await setEnv(app, 'JIMUHUB_E2E_IMPORT_PATH', noProj)
  await window.getByRole('button', { name: 'ホーム' }).click()
  await window.getByRole('button', { name: 'データを復元' }).click()
  await window.getByRole('button', { name: 'ファイルを選択して復元' }).click()
  await window.getByRole('button', { name: '続行' }).click()
  await expect(window.getByText(/現在の案件\(2件\)/)).toBeVisible()
  await expect(window.getByText(/現在の領収書/)).toHaveCount(0)
  await shot(window, 'TC-117', '案件のみが消える場合の確認画面(領収書の文言は出ない)')
  await window.getByRole('button', { name: 'キャンセル' }).click()

  // 確認後にファイルが変更された場合は、復元しない(トークンの検証)
  const changing = join(workDir, 'changing.zip')
  copyFileSync(noProj, changing)
  await setEnv(app, 'JIMUHUB_E2E_IMPORT_PATH', changing)
  const ins = await inspect(window, 'changing')
  expect(ins.needsConfirmation).toBe(true)
  writeFileSync(changing, Buffer.concat([readFileSync(changing), Buffer.from('x')]))
  const res = await mustApi<{ success: boolean; error?: string }>(window, 'importData', {
    token: ins.token
  })
  expect(res.success).toBe(false)
  expect(res.error).toBe(
    '選択したファイルが変更されたか、無効になりました。もう一度ファイルを選択してください'
  )
  // 破棄済みのトークンでも復元できない
  await setEnv(app, 'JIMUHUB_E2E_IMPORT_PATH', noProj)
  const ins2 = await inspect(window, 'discard')
  await mustApi(window, 'discardBackup', ins2.token)
  const res2 = await mustApi<{ success: boolean; error?: string }>(window, 'importData', {
    token: ins2.token
  })
  expect(res2.success).toBe(false)
  expect(dbQuery(dataDir, 'select count(*) from projects')).toBe('2')
  noteEvidence(
    'TC-117',
    'ファイル変更・破棄済みトークンの扱い',
    `ファイル変更後: ${res.error}\n破棄済みトークン: success=${res2.success} ${res2.error ?? ''}`
  )
})

/** 旧版(スキーマ版4。タグ v0.3.0)の実際のスキーマで、データ保存先を作る(docs/07_test/tools/make-v4-fixture.mjs) */
function makeV4DataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'jimuhub-i3-v4-'))
  const repoRoot = join(__dirname_i3(), '..', '..', '..')
  execFileSync(
    'node',
    [join(repoRoot, 'docs', '07_test', 'tools', 'make-v4-fixture.mjs'), repoRoot, dir],
    {
      stdio: 'pipe'
    }
  )
  return dir
}
function __dirname_i3(): string {
  return fileURLToPath(new URL('.', import.meta.url))
}

/** 読み取り(-readonlyなし)。アプリが異常終了した後の、付属ファイル(-wal・-shm)が残るDBの確認用 */
function dbRead(dataDir: string, sql: string): string {
  return execFileSync('sqlite3', ['-separator', '|', join(dataDir, 'data.sqlite'), sql], {
    encoding: 'utf8'
  }).trim()
}

const V4_TABLES = [
  'clients',
  'company_profile',
  'document_number_sequences',
  'quotes',
  'quote_line_items',
  'invoices',
  'invoice_line_items',
  'accounts',
  'cash_records',
  'receipts',
  'cash_record_history'
]

/** 各テーブルを、版4の列だけで(後から追加された案件ID列を除いて)文字列化する */
function dumpV4Columns(
  dataDir: string,
  columns: Record<string, string[]>,
  query: (dir: string, sql: string) => string = dbQuery
): string {
  return V4_TABLES.map((t) =>
    query(dataDir, `select ${columns[t].join(',')} from ${t} order by 1,2`)
  )
    .join('\n--\n')
    .split(dataDir)
    .join('<D>')
}

test('TC-118: [移行] スキーマ版4(イテレーション2の旧版が作ったデータ)から版5への移行。移行前の自動退避、データ・PDF・領収書の保持、案件のテーブル・列の追加、再起動で冪等、移行後の新機能と改変検知', async () => {
  const dataDir = makeV4DataDir()
  try {
    expect(dbQuery(dataDir, "select value from app_meta where key='schema_version'")).toBe('4')
    expect(
      dbQuery(
        dataDir,
        "select count(*) from sqlite_master where name in ('projects','project_link_history')"
      )
    ).toBe('0')
    const columns: Record<string, string[]> = {}
    for (const t of V4_TABLES)
      columns[t] = dbQuery(dataDir, `select name from pragma_table_info('${t}')`).split('\n')
    const pre = dumpV4Columns(dataDir, columns)
    const files = Object.fromEntries(
      listFilesRecursive(join(dataDir, 'documents')).map((f) => [
        f.slice(dataDir.length),
        sha256File(f)
      ])
    )
    expect(Object.keys(files)).toHaveLength(3) // 見積書PDF・請求書PDF・領収書
    noteEvidence(
      'TC-118',
      '移行前(スキーマ版4。旧版 v0.3.0 の定義で作成)のDBの状態',
      `schema_version=4\nテーブル: ${dbQuery(dataDir, "select group_concat(name) from sqlite_master where type='table'")}\n件数: clients=${dbQuery(dataDir, 'select count(*) from clients')} quotes=${dbQuery(dataDir, 'select count(*) from quotes')} invoices=${dbQuery(dataDir, 'select count(*) from invoices')} cash_records=${dbQuery(dataDir, 'select count(*) from cash_records')} receipts=${dbQuery(dataDir, 'select count(*) from receipts')}\nファイル:\n${Object.entries(
        files
      )
        .map(([k, v]) => `${k.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/, '<uuid>')} ${v}`)
        .join('\n')}`
    )

    // 新版で起動(移行)
    const { relaunchOnDir } = await import('./helpers-i2')
    const re = await relaunchOnDir(dataDir)
    await expect(re.window.getByText('事務HUB').first()).toBeVisible()
    await expect(re.window.locator('.titlebar-title')).toHaveText('事務HUB - ホーム')
    expect(dbQuery(dataDir, "select value from app_meta where key='schema_version'")).toBe('5')
    // 移行前の自動退避(VACUUM INTO)。退避は移行前の版4のまま
    const backups = readdirSync(join(dataDir, 'backups')).filter((n) =>
      n.startsWith('pre-migration_v4_')
    )
    expect(backups).toHaveLength(1)
    const backupPath = join(dataDir, 'backups', backups[0])
    const bk = (sql: string): string =>
      execFileSync('sqlite3', ['-readonly', backupPath, sql], { encoding: 'utf8' }).trim()
    expect(bk("select value from app_meta where key='schema_version'")).toBe('4')
    expect(bk('select count(*) from cash_records')).toBe('3')
    // 案件のテーブル・列・索引・トリガー
    expect(
      dbQuery(
        dataDir,
        "select group_concat(name) from (select name from sqlite_master where name in ('projects','project_link_history') order by name)"
      )
    ).toBe('project_link_history,projects')
    for (const t of ['quotes', 'invoices', 'cash_records'])
      expect(
        dbQuery(dataDir, `select count(*) from pragma_table_info('${t}') where name='project_id'`),
        t
      ).toBe('1')
    expect(
      dbQuery(
        dataDir,
        "select count(*) from sqlite_master where type='index' and name in ('idx_quotes_project','idx_invoices_project','idx_cash_records_project','idx_projects_status','idx_projects_client','idx_projects_name')"
      )
    ).toBe('6')
    expect(
      dbQuery(
        dataDir,
        "select count(*) from sqlite_master where type='trigger' and tbl_name='project_link_history'"
      )
    ).toBe('2')
    // 既存データは変わらない(版4の列の内容・ファイルのSHA-256が一致。案件ID列はNULL)
    expect(dumpV4Columns(dataDir, columns)).toBe(pre)
    for (const t of ['quotes', 'invoices', 'cash_records'])
      expect(dbQuery(dataDir, `select count(*) from ${t} where project_id is not null`), t).toBe(
        '0'
      )
    expect(
      Object.fromEntries(
        listFilesRecursive(join(dataDir, 'documents')).map((f) => [
          f.slice(dataDir.length),
          sha256File(f)
        ])
      )
    ).toEqual(files)
    expect(dbQuery(dataDir, 'select count(*) from projects')).toBe('0')
    await shot(
      re.window,
      'TC-118',
      '版4のデータから起動した直後のホーム(取引先1件・見積書2件・請求書1件が保持)'
    )

    // 移行後の画面: 既存データが見え、改変検知(記録ハッシュ・領収書・PDF)が誤検知しない
    await re.window.getByRole('button', { name: '入出金・経費' }).click()
    await re.window.getByRole('cell', { name: '旧版の通信費(領収書あり)' }).click()
    await expect(re.window.getByText('ファイルの改変が疑われます')).toHaveCount(0)
    const recId = Number(
      dbQuery(dataDir, "select id from cash_records where description='旧版の通信費(領収書あり)'")
    )
    const d = await mustApi<{
      integrity: {
        recordHashOk: boolean
        historyHashOk: boolean
        receipts: Array<{ state: string }>
      }
    }>(re.window, 'getRecord', recId)
    expect(
      d.integrity.recordHashOk &&
        d.integrity.historyHashOk &&
        d.integrity.receipts.every((r) => r.state === 'ok')
    ).toBe(true)
    expect(
      dbQuery(dataDir, 'select sum(pdf_hash_mismatch) from quotes') +
        dbQuery(dataDir, 'select sum(pdf_hash_mismatch) from invoices')
    ).toBe('00')
    await shot(
      re.window,
      'TC-118',
      '移行後の旧版データの記録詳細(領収書・改変検知の誤検知なし。案件欄は「案件なし」)'
    )
    await expect(re.window.getByText('案件なし').first()).toBeVisible()
    // 新機能が使える: 案件を作り、移行前のデータを紐づける
    const pid = await createProjectApi(re.window, { name: '移行後の案件' })
    await mustApi(re.window, 'changeProjectLink', {
      targetType: 'cash_record',
      targetId: recId,
      projectId: pid
    })
    await mustApi(re.window, 'changeProjectLink', {
      targetType: 'invoice',
      targetId: 1,
      projectId: pid
    })
    const detail = await getProjectApi(re.window, pid)
    expect(detail.summary.sales).toBe(55000)
    expect(detail.summary.expense).toBe(5500)
    // 紐づけても移行前のデータの記録ハッシュ・PDFハッシュは変わらない
    expect(dumpV4Columns(dataDir, columns)).toBe(pre)
    await re.app.close()

    // 再起動: 移行は冪等で、退避は増えない
    const re2 = await relaunchOnDir(dataDir)
    await expect(re2.window.getByText('事務HUB').first()).toBeVisible()
    expect(dbQuery(dataDir, "select value from app_meta where key='schema_version'")).toBe('5')
    expect(
      readdirSync(join(dataDir, 'backups')).filter((n) => n.startsWith('pre-migration_')).length
    ).toBe(1)
    expect(dbQuery(dataDir, 'select count(*) from projects')).toBe('1')
    expect(dbQuery(dataDir, 'select count(*) from accounts')).toBe('14')
    // 移行後のデータのエクスポートは版5で、案件を含む
    const out = join(workDir, 'migrated-export.zip')
    await setEnv(re2.app, 'JIMUHUB_E2E_EXPORT_PATH', out)
    const ex = await mustApi<{ success: boolean }>(re2.window, 'exportData')
    expect(ex.success).toBe(true)
    const exp = readExport(out)
    expect(exp.manifest.schemaVersion).toBe(5)
    expect(exp.manifest.tables.projects.count).toBe(1)
    expect(exp.manifest.tables.projectLinkHistory.count).toBe(2)
    await re2.app.close()
    noteEvidence(
      'TC-118',
      '移行後の確認結果',
      `schema_version=5、退避: ${backups.join(', ')}(退避内のschema_version=4、cash_records=3)\n案件のテーブル・案件ID列3・索引6・トリガー2を追加\n版4の列の内容・PDF/領収書のSHA-256は移行前後で一致、案件ID列はNULL\n再起動後も退避は1件、schema_version=5、accounts=14\n移行後のエクスポート: schemaVersion=${exp.manifest.schemaVersion}、projects=${exp.manifest.tables.projects.count}`
    )
  } finally {
    // 一時フォルダは削除せずに残す
  }
})

test('TC-119: [移行] 移行に失敗した場合のロールバック。スキーマ版は4のまま・既存データは無傷・移行前の退避が残り、原因を取り除くと次の起動で移行できる', async () => {
  const dataDir = makeV4DataDir()
  try {
    const columns: Record<string, string[]> = {}
    for (const t of V4_TABLES)
      columns[t] = dbRead(dataDir, `select name from pragma_table_info('${t}')`).split('\n')
    const pre = dumpV4Columns(dataDir, columns, dbRead)
    // 移行を失敗させる: 案件のテーブルと同名で、列の構成が異なる表を先に置く(索引の作成で失敗する)
    dbExec(dataDir, 'create table projects (id integer primary key, note text)')
    const { relaunchOnDir } = await import('./helpers-i2')
    const re = await relaunchOnDir(dataDir)
    // 起動エラー画面になる(データを読めない扱い)
    await expect(
      re.window
        .getByText(/データを読み込めませんでした|起動できませんでした|読み込めません/)
        .first()
    ).toBeVisible({ timeout: 15000 })
    await shot(re.window, 'TC-119', '移行に失敗したときの起動エラー画面')
    const body = await re.window.locator('body').innerText()
    await re.app.close()
    expect(dbRead(dataDir, "select value from app_meta where key='schema_version'")).toBe('4') // ロールバックされ、版4のまま
    for (const t of ['quotes', 'invoices', 'cash_records'])
      expect(
        dbRead(dataDir, `select count(*) from pragma_table_info('${t}') where name='project_id'`),
        t
      ).toBe('0')
    expect(dumpV4Columns(dataDir, columns, dbRead)).toBe(pre)
    const backups = readdirSync(join(dataDir, 'backups')).filter((n) =>
      n.startsWith('pre-migration_v4_')
    )
    expect(backups.length).toBeGreaterThanOrEqual(1)
    // 原因を取り除いて再起動すると移行できる
    dbExec(dataDir, 'drop table projects')
    const re2 = await relaunchOnDir(dataDir)
    await expect(re2.window.getByText('事務HUB').first()).toBeVisible()
    await expect(re2.window.locator('.titlebar-title')).toHaveText('事務HUB - ホーム')
    expect(dbRead(dataDir, "select value from app_meta where key='schema_version'")).toBe('5')
    expect(dumpV4Columns(dataDir, columns, dbRead)).toBe(pre)
    await re2.app.close()
    noteEvidence(
      'TC-119',
      '移行失敗時の結果',
      `失敗時の画面の文言:\n${body.replace(/\s+/g, ' ').slice(0, 400)}\nロールバック後: schema_version=4、案件ID列なし、既存データは変更前と一致、退避=${backups.join(', ')}\n原因除去後の再起動: schema_version=5、データは変更前と一致`
    )
  } finally {
    // 一時フォルダは削除せずに残す
  }
})

test('TC-120: [F-32・★F8] 復元時の案件の整合の補正。存在しない案件を指す紐づけ・存在しない取引先の案件は「案件なし」「取引先なし」に補正され、件数が完了メッセージに出る(復元は中断しない)。版4以前の復元は案件を空にする', async () => {
  const src = await getSharedZip()
  const fixed = join(workDir, 'fix-links.zip')
  copyFileSync(src, fixed)
  // 見積書・記録の紐づけ先を、存在しない案件(999)にする。案件の取引先を、存在しない取引先(888)にする
  mapExportTable(fixed, 'quotes', (r) => ({ ...r, projectId: 999 }))
  mapExportTable(fixed, 'cashRecords', (r, i) => (i === 0 ? { ...r, projectId: 999 } : r))
  mapExportTable(fixed, 'projects', (r, i) => (i === 0 ? { ...r, clientId: 888 } : r))
  const { window, dataDir } = await start({ JIMUHUB_E2E_IMPORT_PATH: fixed })
  const msg = await importViaUi(window)
  const fixCount = readExport(fixed).records('quotes').length + 1 + 1
  expect(msg).toContain('復元が完了しました')
  expect(msg).toContain(
    `案件への紐づけ${fixCount}件を、対応する案件が無いため「案件なし」にしました`
  )
  expect(dbQuery(dataDir, 'select count(*) from quotes where project_id is not null')).toBe('0')
  expect(
    dbQuery(dataDir, 'select ifnull(project_id,0) from cash_records order by id limit 1')
  ).toBe('0')
  expect(dbQuery(dataDir, 'select ifnull(client_id,0) from projects order by id limit 1')).toBe('0')
  // 有効な紐づけは補正されない
  expect(
    dbQuery(dataDir, 'select count(*) from cash_records where project_id is not null')
  ).not.toBe('0')
  await shot(window, 'TC-120', '存在しない案件を指す紐づけを補正した復元の完了メッセージ')
  noteEvidence(
    'TC-120',
    '補正の結果',
    `${msg}\n見積書の案件ID=すべてNULL、記録(先頭)の案件ID=NULL、案件(先頭)の取引先=NULL`
  )
  await window.getByLabel('閉じる').click()

  // 版4以前(従来形式)の復元: 案件は空、紐づけ列はNULL。案件が現在あれば確認画面が出る(TC-117と同じ判定)
  const legacy = exportToLegacyJson(src, 4) as { data: Record<string, unknown> }
  delete legacy.data.projects
  delete legacy.data.projectLinkHistory
  for (const t of ['quotes', 'invoices', 'cashRecords'])
    for (const row of legacy.data[t] as Array<Record<string, unknown>>) delete row.projectId
  const entries: Record<string, Buffer | string> = { 'data.json': JSON.stringify(legacy) }
  for (const [n, c] of readZipEntries(src)) if (n.startsWith('documents/')) entries[n] = c
  const legacyZip = join(workDir, 'legacy-v4-restore.zip')
  buildZip(legacyZip, entries)
  await createProjectApi(window, { name: '復元で消える案件' })
  await setEnv(launched!.app, 'JIMUHUB_E2E_IMPORT_PATH', legacyZip)
  // 現在の案件がある → 案件を含まない旧形式なので確認画面
  await window.getByRole('button', { name: 'ホーム' }).click()
  await window.getByRole('button', { name: 'データを復元' }).click()
  await window.getByRole('button', { name: 'ファイルを選択して復元' }).click()
  await window.getByRole('button', { name: '続行' }).click()
  await expect(
    window.getByText(/現在の案件\(\d+件\)と、案件への紐づけ・付け替え履歴はすべて消えます/)
  ).toBeVisible()
  await window.getByRole('button', { name: '復元する' }).click()
  await expect(window.getByText(/復元が完了しました/)).toBeVisible()
  expect(dbQuery(dataDir, 'select count(*) from projects')).toBe('0')
  expect(dbQuery(dataDir, 'select count(*) from project_link_history')).toBe('0')
  expect(dbQuery(dataDir, 'select count(*) from quotes where project_id is not null')).toBe('0')
  expect(dbQuery(dataDir, 'select count(*) from quotes')).not.toBe('0') // 書類は復元される
  await shot(window, 'TC-120', '版4(従来形式)の復元後。案件・付け替え履歴は空、書類は復元')
})
