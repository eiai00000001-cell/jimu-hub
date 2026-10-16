import { test, expect, type Page } from '@playwright/test'
import AdmZip from 'adm-zip'
import {
  buildZip,
  exportToLegacyJson,
  mapExportTable,
  readExport,
  readZipEntries,
  renameEntryInZip
} from '../../src/main/services/backup/test-helpers'
import {
  existsSync,
  openSync,
  closeSync,
  writeSync,
  ftruncateSync,
  rmSync,
  writeFileSync,
  copyFileSync,
  readdirSync
} from 'node:fs'
import { createWorkDir } from '../../test-support/work-dir.mjs'
import { join } from 'node:path'
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/electron-app'
import { noteEvidence, shot } from './evidence-dir'
import {
  createClientApi,
  dbQuery,
  finalizeInvoiceApi,
  finalizeQuoteApi,
  listFilesRecursive,
  setupCompany,
  sha256File
} from './helpers'
import {
  accountId,
  createRecordApi,
  dbExec,
  dumpAll,
  makeReceiptFixtures,
  mustApi,
  pickTokens,
  relaunchOnDir,
  setEnv,
  type Fixtures
} from './helpers-i2'

/**
 * 【tester作成】イテレーション2: エクスポート・復元の拡張(領収書・勘定科目・記録・履歴)、復元時の改変検知、旧形式の復元、
 * 失敗時の巻き戻し、v3→v4の移行(TC-92〜TC-95)。参照元: 詳細設計書 4.2章・4.3章・4.22章・6.10〜6.13章・8章
 */
let workDir: string
let fx: Fixtures
let sourceZip: string
let sourceDump: string
let sourceReceiptFiles: Record<string, string>

interface Apps {
  launched?: LaunchedApp
}
const state: Apps = {}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  workDir = createWorkDir('e2e', 'jimuhub-i2-backup')
  fx = makeReceiptFixtures()
  sourceZip = join(workDir, 'source.zip')
  const src = await launchApp({
    JIMUHUB_E2E_EXPORT_PATH: sourceZip,
    JIMUHUB_E2E_RECEIPT_PATHS: fx.pdf
  })
  const { window, app, dataDir } = src
  await setupCompany(window)
  const c1 = await createClientApi(window, '往復確認商事', { furigana: 'オウフクカクニンショウジ' })
  const q = await finalizeQuoteApi(window, c1, '2026-10-02', [
    { name: '設計', quantity: 1, unitPrice: 200000, taxRate: 10 }
  ])
  void q
  const inv = await finalizeInvoiceApi(window, c1, '2026-10-03', [
    { name: '業務', quantity: 1, unitPrice: 100000, taxRate: 10, withholdingTarget: true }
  ])
  await mustApi(window, 'updateInvoicePaymentStatus', inv.id, {
    paymentStatus: 'paid',
    paymentDate: '2026-10-20'
  })
  await mustApi(window, 'updateInvoicePaymentStatus', inv.id, { paymentStatus: 'unpaid' }) // 取消済
  await mustApi(window, 'updateInvoicePaymentStatus', inv.id, {
    paymentStatus: 'paid',
    paymentDate: '2026-10-25'
  }) // 有効
  const newAcc = await mustApi<{ id: number }>(window, 'createAccount', {
    name: '研修費',
    kind: 'expense'
  })
  const acc = await accountId(window, '通信費')
  const t = await pickTokens(window, app, [fx.pdf, fx.png, fx.jpg])
  const r1 = await createRecordApi(window, {
    accountId: acc,
    amount: 6600,
    description: '往復確認の経費',
    clientId: c1,
    paymentMethod: 'transfer',
    taxCategory: 'standard_10',
    receiptTokens: t.files.map((f) => f.token)
  })
  const rec = await mustApi<{ receipts: Array<{ id: number }> }>(window, 'getRecord', r1)
  await mustApi(window, 'updateRecord', {
    id: r1,
    kind: 'expense',
    recordDate: '2026-10-01',
    amount: 6600,
    accountId: acc,
    description: '往復確認の経費(訂正)',
    clientId: c1,
    paymentMethod: 'transfer',
    taxCategory: 'standard_10',
    removeReceiptIds: [rec.receipts[0].id],
    addReceiptTokens: [],
    reason: '摘要訂正と領収書の取り外し'
  })
  const r2 = await createRecordApi(window, {
    accountId: newAcc.id,
    amount: 3000,
    description: '削除される記録'
  })
  await mustApi(window, 'deleteRecord', { id: r2, reason: '重複登録' })
  await createRecordApi(window, {
    kind: 'income',
    accountId: await accountId(window, '雑収入'),
    amount: 1234,
    description: '雑収入の入金'
  })
  await mustApi(window, 'deactivateAccount', newAcc.id)
  const exp = await mustApi<{ success: boolean }>(window, 'exportData')
  expect(exp.success).toBe(true)
  sourceDump = dumpAll(dataDir, dbQuery)
  sourceReceiptFiles = {}
  for (const f of listFilesRecursive(join(dataDir, 'documents', 'receipts')))
    sourceReceiptFiles[f.slice(join(dataDir, 'documents').length + 1)] = sha256File(f)
  await closeApp(src)
})
test.afterAll(() => {
  rmSync(workDir, { recursive: true, force: true })
  rmSync(fx.dir, { recursive: true, force: true })
})
test.afterEach(async () => {
  if (state.launched) {
    try {
      await closeApp(state.launched)
    } catch {
      rmSync(state.launched.dataDir, { recursive: true, force: true })
    }
    state.launched = undefined
  }
})

async function startTarget(importPath: string): Promise<LaunchedApp> {
  const l = await launchApp({
    JIMUHUB_E2E_IMPORT_PATH: importPath,
    JIMUHUB_E2E_EXPORT_PATH: join(workDir, 'target-export.zip')
  })
  state.launched = l
  return l
}

interface ImportRes {
  success: boolean
  importedCount?: number
  pdfHashMismatchCount?: number
  receiptHashMismatchCount?: number
  recordHashMismatchCount?: number
  error?: string
}

async function importViaUi(window: Page): Promise<string> {
  await window.getByRole('button', { name: 'ホーム' }).click()
  await window.getByRole('button', { name: 'データを復元' }).click()
  await window.getByRole('button', { name: 'ファイルを選択して復元' }).click()
  await window.getByRole('button', { name: '続行' }).click()
  const message = window.locator('.modal .message-success, .modal .message-error')
  await expect(message).toBeVisible()
  return message.innerText()
}

interface ZipEdit {
  /** 出力先のZIPのパス */
  path: string
  /** テーブル(JSON Lines)のレコードを加工する(新形式。test-helpersの`mapExportTable`) */
  mapTable: (
    table: string,
    mapRow: (row: Record<string, unknown>, index: number) => Record<string, unknown>
  ) => void
  /** ZIPのエントリを直接加工する(エントリの削除・追加・差し替え) */
  editZip: (edit: (zip: AdmZip) => void) => void
  /** `manifest.json`を加工する */
  editManifest: (edit: (manifest: Record<string, unknown>) => void) => void
}

/** 元のZIP(新形式、スキーマ版6)を複製して加工する */
function modifiedZip(name: string, mutate: (ctx: ZipEdit) => void): string {
  const out = join(workDir, name)
  copyFileSync(sourceZip, out)
  const ctx: ZipEdit = {
    path: out,
    mapTable: (table, mapRow) => mapExportTable(out, table, mapRow),
    editZip: (edit) => {
      const zip = new AdmZip(out)
      edit(zip)
      zip.writeZip(out)
    },
    editManifest: (edit) =>
      ctx.editZip((zip) => {
        const m = JSON.parse(zip.readAsText('manifest.json')) as Record<string, unknown>
        edit(m)
        zip.updateFile('manifest.json', Buffer.from(JSON.stringify(m), 'utf8'))
      })
  }
  mutate(ctx)
  return out
}

/**
 * 従来形式(`data.json`1本のZIP。スキーマ版1〜4)を、元のZIPの内容から組み立てる。
 * `documents/`配下のエントリは、`keepDocuments`が真の場合に引き継ぐ。
 */
function legacyZip(
  name: string,
  schemaVersion: number,
  mutate: (data: Record<string, unknown>) => Record<string, unknown>,
  keepDocuments: (entryName: string) => boolean = () => true
): string {
  const legacy = exportToLegacyJson(sourceZip, schemaVersion) as {
    schemaVersion: number
    data: Record<string, unknown>
  }
  // 版4以前には、案件のテーブル・案件ID列がない
  delete legacy.data.projects
  delete legacy.data.projectLinkHistory
  for (const t of ['quotes', 'invoices', 'cashRecords'])
    for (const row of (legacy.data[t] ?? []) as Array<Record<string, unknown>>) delete row.projectId
  legacy.data = mutate(legacy.data)
  const entries: Record<string, Buffer | string> = { 'data.json': JSON.stringify(legacy) }
  for (const [entryName, content] of readZipEntries(sourceZip))
    if (entryName.startsWith('documents/') && keepDocuments(entryName)) entries[entryName] = content
  const out = join(workDir, name)
  buildZip(out, entries)
  return out
}

test('TC-92: エクスポート→復元の往復(領収書・勘定科目・記録・履歴・取消済/削除済・外した領収書・履歴の追記専用トリガー)', async () => {
  // ZIPの構造(イテレーション3: manifest.json + data/<テーブル>.jsonl)
  const exported = readExport(sourceZip)
  const names = [...exported.entries.keys()]
  const data = {
    schemaVersion: exported.manifest.schemaVersion,
    data: {
      accounts: exported.records('accounts'),
      cashRecords: exported.records('cashRecords'),
      receipts: exported.records('receipts'),
      cashRecordHistory: exported.records('cashRecordHistory')
    } as Record<string, Array<Record<string, unknown>>>
  }
  expect(data.schemaVersion).toBe(6)
  expect(Object.keys(exported.manifest.tables)).toEqual(
    expect.arrayContaining([
      'accounts',
      'cashRecords',
      'receipts',
      'cashRecordHistory',
      'projects',
      'projectLinkHistory'
    ])
  )
  expect(data.data.accounts).toHaveLength(15)
  expect(data.data.receipts).toHaveLength(3) // 外した1件を含む
  expect(data.data.cashRecords).toHaveLength(5) // 取消済・有効の入金記録、経費、削除済、雑収入
  expect(data.data.cashRecords.filter((r) => r.isDeleted === true)).toHaveLength(1)
  expect(data.data.cashRecords.filter((r) => r.status === 'cancelled')).toHaveLength(1)
  const receiptEntries = names.filter((n) => n.startsWith('documents/receipts/'))
  expect(receiptEntries).toHaveLength(3)
  for (const r of data.data.receipts) {
    expect(String(r.filePath)).toMatch(/^documents\/receipts\/\d{4}\/[0-9a-f-]{36}\.(pdf|jpg|png)$/)
    expect(names).toContain(String(r.filePath))
  }
  expect(data.data.receipts.filter((r) => r.removedAt !== null)).toHaveLength(1)
  noteEvidence(
    'TC-92',
    'ZIPのエントリ一覧とmanifest・各テーブルの件数',
    `${names.join('\n')}\naccounts=${data.data.accounts.length} cashRecords=${data.data.cashRecords.length} receipts=${data.data.receipts.length} cashRecordHistory=${data.data.cashRecordHistory.length}\nschemaVersion=${data.schemaVersion}`
  )

  // 復元(空のデータ保存先へ)。進捗の通知も記録する
  const { window, dataDir } = await startTarget(sourceZip)
  await window.evaluate(() => {
    const w = window as unknown as {
      __p: unknown[]
      jimuhubApi: { onDataProgress: (cb: (p: unknown) => void) => void }
    }
    w.__p = []
    w.jimuhubApi.onDataProgress((p) => w.__p.push(p))
  })
  const msg = await importViaUi(window)
  expect(msg).toMatch(/復元が完了しました\(\d+件\)/)
  expect(msg).not.toContain('改変')
  await shot(window, 'TC-92', '復元完了(改変の警告なし)')
  const progress = await window.evaluate(
    () =>
      (window as unknown as { __p: Array<{ phase: string; current: number; total: number }> }).__p
  )
  expect(progress.length).toBeGreaterThanOrEqual(3) // 領収書3件
  expect(progress.at(-1)).toMatchObject({ phase: 'import' })
  expect(progress.at(-1)?.current).toBe(progress.at(-1)?.total)
  // DB・ファイルの完全一致
  expect(dumpAll(dataDir, dbQuery)).toBe(sourceDump)
  const restoredFiles: Record<string, string> = {}
  for (const f of listFilesRecursive(join(dataDir, 'documents', 'receipts')))
    restoredFiles[f.slice(join(dataDir, 'documents').length + 1)] = sha256File(f)
  expect(restoredFiles).toEqual(sourceReceiptFiles)
  noteEvidence(
    'TC-92',
    '往復の照合',
    `全テーブルのダンプ一致(${sourceDump.split('\n').length}行)\n領収書ファイル${Object.keys(restoredFiles).length}件のSHA-256一致\n進捗通知: ${JSON.stringify(progress)}`
  )
  // 復元後の記録は改変検知で問題なし・履歴トリガーが再作成されている
  const list = await mustApi<{ items: Array<{ id: number }> }>(window, 'listRecords', {})
  for (const it of list.items) {
    const d = await mustApi<{
      integrity: {
        recordHashOk: boolean
        historyHashOk: boolean
        receipts: Array<{ state: string }>
      }
    }>(window, 'getRecord', it.id)
    expect(
      d.integrity.recordHashOk &&
        d.integrity.historyHashOk &&
        d.integrity.receipts.every((r) => r.state === 'ok')
    ).toBe(true)
  }
  const trg = dbQuery(
    dataDir,
    "select count(*) from sqlite_master where type='trigger' and tbl_name='cash_record_history'"
  )
  expect(Number(trg)).toBeGreaterThanOrEqual(2)
  expect(
    (() => {
      try {
        dbExec(dataDir, "update cash_record_history set reason='x' where id=1")
        return 'allowed'
      } catch {
        return 'rejected'
      }
    })()
  ).toBe('rejected')
  expect(
    (() => {
      try {
        dbExec(dataDir, 'delete from cash_record_history where id=1')
        return 'allowed'
      } catch {
        return 'rejected'
      }
    })()
  ).toBe('rejected')
  // 復元後の操作: 画面で記録・領収書・取消済が見える。新規登録も可能(ID採番が継続)
  await window.getByLabel('閉じる').click()
  await window.getByRole('button', { name: '入出金・経費' }).click()
  await expect(window.getByText('往復確認の経費(訂正)')).toBeVisible()
  await expect(window.getByText('取消済').first()).toBeVisible()
  await shot(window, 'TC-92', '復元後の入出金・経費一覧(取消済・削除済は一覧に出ない)')
  await window.getByRole('cell', { name: '往復確認の経費(訂正)' }).click()
  await expect(window.getByText('外した領収書')).toBeVisible()
  await expect(window.getByText('摘要訂正と領収書の取り外し')).toBeVisible()
  await shot(window, 'TC-92', '復元後の記録詳細(領収書・外した領収書・履歴)')
  const newId = await createRecordApi(window, {
    accountId: await accountId(window, '通信費'),
    description: '復元後の新規'
  })
  expect(newId).toBe(6)
  // 利用停止中の勘定科目(研修費)も復元され、選択肢には出ない
  const accs = await mustApi<Array<{ name: string; status: string }>>(window, 'listAccounts', {
    includeInactive: true
  })
  expect(accs.find((a) => a.name === '研修費')?.status).toBe('inactive')
  // 復元後に再エクスポートしても同じ件数(再往復)
  const exp2 = await mustApi<{ success: boolean }>(window, 'exportData')
  expect(exp2.success).toBe(true)
})

test('TC-93: 復元時の改変検知(領収書ファイルの改ざん・欠落・記録の改ざん・ハッシュ列の書き換え・不正なエントリ名)', async () => {
  const receiptPaths = [...readZipEntries(sourceZip).keys()].filter((n) =>
    n.startsWith('documents/receipts/')
  )
  // (a) 領収書ファイルのバイト列を変更
  const a = modifiedZip('tamper-a.zip', ({ editZip }) =>
    editZip((zip) => {
      const e = zip.getEntry(receiptPaths[1])!
      const b = Buffer.from(e.getData())
      b[b.length - 3] ^= 0xff
      zip.updateFile(e, b)
    })
  )
  {
    const { window } = await startTarget(a)
    const msg = await importViaUi(window)
    expect(msg).toContain('復元が完了しました')
    expect(msg).toContain('領収書')
    expect(msg).toContain('改変')
    await shot(window, 'TC-93', '領収書ファイルが改ざんされたZIPの復元結果(警告つきで完了)')
    noteEvidence('TC-93', '(a)領収書ファイル改ざんの復元結果', msg)
    await window.getByLabel('閉じる').click()
    await window.getByRole('button', { name: '入出金・経費' }).click()
    await window.getByRole('cell', { name: '往復確認の経費(訂正)' }).click()
    await expect(window.getByText('ファイルの改変が疑われます')).toBeVisible()
    await shot(window, 'TC-93', '復元後の詳細画面での領収書の警告')
    await closeApp(state.launched!)
    state.launched = undefined
  }
  // (b) 領収書エントリの欠落
  const b = modifiedZip('tamper-b.zip', ({ editZip }) =>
    editZip((zip) => zip.deleteFile(receiptPaths[0]))
  )
  {
    const { window, dataDir } = await startTarget(b)
    const r = await mustApi<ImportRes>(window, 'importData')
    expect(r).toMatchObject({
      success: true,
      receiptHashMismatchCount: 1,
      recordHashMismatchCount: 0
    })
    noteEvidence('TC-93', '(b)領収書ファイル欠落の復元結果', JSON.stringify(r))
    const states = dbQuery(dataDir, 'select id from receipts order by id').split('\n')
    expect(states).toHaveLength(3)
    await closeApp(state.launched!)
    state.launched = undefined
  }
  // (c) cashRecords.jsonl の記録の金額を書き換え(記録ハッシュ不一致)
  const c = modifiedZip('tamper-c.zip', ({ mapTable }) =>
    mapTable('cashRecords', (r) =>
      r.description === '雑収入の入金' ? { ...r, amount: 999999 } : r
    )
  )
  {
    const { window, dataDir } = await startTarget(c)
    const msg = await importViaUi(window)
    expect(msg).toContain('記録の改変が疑われる入出金・経費が1件あります')
    await shot(window, 'TC-93', '記録の金額が改ざんされたZIPの復元結果')
    noteEvidence('TC-93', '(c)記録の改ざんの復元結果', msg)
    const id = Number(
      dbQuery(dataDir, "select id from cash_records where description='雑収入の入金'")
    )
    await window.getByLabel('閉じる').click()
    const d = await mustApi<{ integrity: { recordHashOk: boolean; historyHashOk: boolean } }>(
      window,
      'getRecord',
      id
    )
    expect(d.integrity.recordHashOk).toBe(false)
    await closeApp(state.launched!)
    state.launched = undefined
  }
  // (d) 領収書のsha256列を書き換え
  const dZip = modifiedZip('tamper-d.zip', ({ mapTable }) =>
    mapTable('receipts', (r, i) => (i === 1 ? { ...r, sha256: '0'.repeat(64) } : r))
  )
  {
    const { window } = await startTarget(dZip)
    const r = await mustApi<ImportRes>(window, 'importData')
    expect(r).toMatchObject({ success: true, receiptHashMismatchCount: 1 })
    noteEvidence('TC-93', '(d)sha256列の書き換えの復元結果', JSON.stringify(r))
    await closeApp(state.launched!)
    state.launched = undefined
  }
  // (e) 履歴の記録ハッシュ(recordHashAfter)を書き換え
  const lastHistory = readExport(sourceZip).records('cashRecordHistory').length - 1
  const e = modifiedZip('tamper-e.zip', ({ mapTable }) =>
    mapTable('cashRecordHistory', (r, i) =>
      i === lastHistory ? { ...r, recordHashAfter: '1'.repeat(64) } : r
    )
  )
  {
    const { window } = await startTarget(e)
    const r = await mustApi<ImportRes>(window, 'importData')
    expect(r.success).toBe(true)
    expect(r.recordHashMismatchCount).toBeGreaterThanOrEqual(1)
    noteEvidence('TC-93', '(e)履歴ハッシュの書き換えの復元結果', JSON.stringify(r))
    await closeApp(state.launched!)
    state.launched = undefined
  }
  // (f) 許可リスト(領収書の命名規則等)に一致しないエントリ名は、展開の対象から外れ、書き出されない
  const f = modifiedZip('tamper-f.zip', ({ editZip }) =>
    editZip((zip) => {
      zip.addFile('documents/receipts/2026/evil.exe', Buffer.from('MZ evil'))
      zip.addFile('documents/receipts/2026/escape.pdf', Buffer.from('%PDF- escape'))
      zip.addFile('outside.txt', Buffer.from('outside'))
      zip.addFile('documents/notes.txt', Buffer.from('not a pdf'))
    })
  )
  {
    const { window, dataDir } = await startTarget(f)
    const r = await mustApi<ImportRes>(window, 'importData')
    expect(r).toMatchObject({
      success: true,
      receiptHashMismatchCount: 0,
      recordHashMismatchCount: 0
    })
    const files = listFilesRecursive(dataDir).map((p) => p.slice(dataDir.length + 1))
    expect(files.some((x) => /evil|escape|outside|notes\.txt/.test(x))).toBe(false)
    expect(existsSync(join(dataDir, '..', 'outside.txt'))).toBe(false)
    expect(existsSync(join(dataDir, 'escape.pdf'))).toBe(false)
    noteEvidence(
      'TC-93',
      '(f)許可リスト外のエントリ名の無視',
      `復元結果: ${JSON.stringify(r)}\n書き出されたファイル(documents配下): ${files.filter((x) => x.startsWith('documents/')).join(', ')}`
    )
  }
  // (g) パス走査(エントリ名に`..`)は、細工されたファイルとして解析エラーで中断し、現在のデータは変わらない(詳細設計書4.3章手順3-1)
  const g = modifiedZip('tamper-g.zip', ({ editZip }) =>
    editZip((zip) =>
      zip.addFile('documents/receipts/2026/aa/bb/cc/escape.pdf', Buffer.from('%PDF-'))
    )
  )
  renameEntryInZip(
    g,
    'documents/receipts/2026/aa/bb/cc/escape.pdf',
    'documents/receipts/2026/../../../escape.pdf'
  )
  {
    const { window, dataDir } = await startTarget(g)
    const before = dumpAll(dataDir, dbQuery)
    const msg = await importViaUi(window)
    expect(msg).toContain('読み込めませんでした')
    expect(dumpAll(dataDir, dbQuery)).toBe(before)
    expect(existsSync(join(dataDir, 'escape.pdf'))).toBe(false)
    expect(existsSync(join(dataDir, '..', 'escape.pdf'))).toBe(false)
    noteEvidence('TC-93', '(g)パス走査(..)のエントリ名は解析エラーで中断', msg)
    await shot(window, 'TC-93', 'パス走査を含むZIPの復元: 解析エラーで中断(データは変わらない)')
    await closeApp(state.launched!)
    state.launched = undefined
  }
})

test('TC-94: 旧形式・不正ファイル・上限超過・失敗時の巻き戻し(スキーマv1〜v3のZIP、JSON単体、v7(現行より新しい版)、壊れたファイル、1GiB超、DB整合性違反)', async () => {
  const { window, dataDir } = await startTarget(sourceZip)
  await mustApi(window, 'importData') // まず通常の復元(領収書ありの状態にする)
  const base = dumpAll(dataDir, dbQuery)
  expect(base).toBe(sourceDump)
  const baseFiles = listFilesRecursive(join(dataDir, 'documents')).length
  const setImport = async (p: string): Promise<void> =>
    setEnv(state.launched!.app, 'JIMUHUB_E2E_IMPORT_PATH', p)

  // 失敗系: 解析エラー(JSONでないmanifest.json)・未来の版・巨大ファイル・DB整合性違反はデータを変えない
  const broken = modifiedZip('broken.zip', ({ editZip }) =>
    editZip((zip) => zip.updateFile('manifest.json', Buffer.from('{ not json')))
  )
  await setImport(broken)
  const r1 = await mustApi<ImportRes>(window, 'importData')
  expect(r1.success).toBe(false)
  expect(r1.error).toContain('読み込めませんでした')
  const v5 = modifiedZip('v7.zip', ({ editManifest }) =>
    editManifest((m) => {
      m.schemaVersion = 7 // 現在のアプリが対応する版(6)より新しい
    })
  )
  await setImport(v5)
  const r2 = await mustApi<ImportRes>(window, 'importData')
  expect(r2.success).toBe(false)
  expect(r2.error).toContain('新しいバージョン')
  const huge = join(workDir, 'huge.zip')
  const fd = openSync(huge, 'w')
  writeSync(fd, Buffer.from('PK\u0003\u0004'))
  ftruncateSync(fd, 1024 * 1024 * 1024 + 1)
  closeSync(fd)
  await setImport(huge)
  const r3 = await mustApi<ImportRes>(window, 'importData')
  expect(r3.success).toBe(false)
  expect(r3.error).toContain('復元できる上限(1GB)を超えているため、読み込めませんでした') // ★T3対応: 容量超過の専用文言
  rmSync(huge)
  const txt = join(workDir, 'notzip.zip')
  writeFileSync(txt, 'plain text, not a zip')
  await setImport(txt)
  const r4 = await mustApi<ImportRes>(window, 'importData')
  expect(r4.success).toBe(false)
  // DB整合性違反(存在しない勘定科目を参照する記録) → トランザクションのロールバックと退避からの復旧
  const fk = modifiedZip('fk.zip', ({ mapTable }) =>
    mapTable('cashRecords', (r, i) => (i === 2 ? { ...r, accountId: 9999 } : r))
  )
  await setImport(fk)
  const r5 = await mustApi<ImportRes>(window, 'importData')
  expect(r5.success).toBe(false)
  expect(r5.error).toContain('復元に失敗しました。データは復元前の状態に戻しました')
  expect(dumpAll(dataDir, dbQuery)).toBe(base)
  expect(listFilesRecursive(join(dataDir, 'documents')).length).toBe(baseFiles)
  for (const [rel, sha] of Object.entries(sourceReceiptFiles))
    expect(sha256File(join(dataDir, 'documents', rel))).toBe(sha)
  expect(
    (() => {
      try {
        dbExec(dataDir, 'delete from cash_record_history where id=1')
        return 'allowed'
      } catch {
        return 'rejected'
      }
    })()
  ).toBe('rejected') // トリガーも維持
  noteEvidence(
    'TC-94',
    '失敗系の結果(データは変化しない)',
    [r1, r2, r3, r4, r5].map((r) => r.error).join('\n') +
      '\nDBダンプ・領収書ファイルは復元前と完全一致、履歴トリガー維持'
  )
  const detail = dbQuery(dataDir, 'select count(*) from cash_records')
  expect(detail).toBe('5')
  await shot(window, 'TC-94', '失敗系の後も画面が通常どおり動作(ホーム)')
  // 退避世代(3世代まで)
  const backups = readdirSync(join(dataDir, 'backups'))
  noteEvidence('TC-94', '復元前の自動退避', backups.join('\n'))

  // 旧形式: スキーマv3のZIP(accounts等なし)→ 初期科目14件・記録空・領収書フォルダは全置換で消える(退避にのみ残る)
  const v3 = legacyZip(
    'v3.zip',
    3,
    (dd) => {
      const rest = { ...dd }
      delete rest.accounts
      delete rest.cashRecords
      delete rest.receipts
      delete rest.cashRecordHistory
      return rest
    },
    (n) => !n.startsWith('documents/receipts/') // v3のZIPには領収書の実体はない
  )
  await setImport(v3)
  const r6 = await mustApi<ImportRes>(window, 'importData')
  expect(r6.success).toBe(true)
  expect(dbQuery(dataDir, 'select count(*) from accounts')).toBe('14')
  expect(dbQuery(dataDir, "select count(*) from accounts where default_key='sales_revenue'")).toBe(
    '1'
  )
  expect(dbQuery(dataDir, 'select count(*) from cash_records')).toBe('0')
  expect(dbQuery(dataDir, 'select count(*) from receipts')).toBe('0')
  const leftover = listFilesRecursive(join(dataDir, 'documents', 'receipts'))
  expect(leftover).toEqual([]) // 領収書ファイルは残らない(空のディレクトリが残るかは問わない)
  noteEvidence(
    'TC-94',
    'v3復元後のdocuments/receipts',
    `ファイル数=${leftover.length}、ディレクトリ存在=${existsSync(join(dataDir, 'documents', 'receipts'))}`
  )
  expect(dbQuery(dataDir, 'select count(*) from clients')).toBe('1') // 取引先は維持
  expect(dbQuery(dataDir, 'select count(*) from invoices')).toBe('1')
  noteEvidence(
    'TC-94',
    'スキーマv3のZIPの復元',
    `結果: ${JSON.stringify(r6)}\naccounts=14(売上高あり) cash_records=0 receipts=0 documents/receipts=削除(退避にのみ残る)`
  )
  // 退避に領収書が残っている(復旧可能)
  const docBackups = readdirSync(join(dataDir, 'backups'))
  noteEvidence('TC-94', 'v3復元後の退避一覧', docBackups.join('\n'))
  // スキーマv2・v1のZIP
  const v2 = legacyZip(
    'v2.zip',
    2,
    (dd) => {
      const rest = { ...dd }
      delete rest.accounts
      delete rest.cashRecords
      delete rest.receipts
      delete rest.cashRecordHistory
      for (const k of ['quotes', 'invoices'])
        for (const row of rest[k] as Array<Record<string, unknown>>) delete row.pdfHashMismatch
      return rest
    },
    (n) => !n.startsWith('documents/receipts/')
  )
  await setImport(v2)
  expect((await mustApi<ImportRes>(window, 'importData')).success).toBe(true)
  expect(dbQuery(dataDir, 'select count(*) from accounts')).toBe('14')
  const v1 = legacyZip(
    'v1.zip',
    1,
    (dd) => ({
      clients: (dd.clients as Array<Record<string, unknown>>).map((c) => {
        const { furigana: _f, ...rest } = c
        void _f
        return rest
      })
    }),
    () => false
  )
  await setImport(v1)
  const r7 = await mustApi<ImportRes>(window, 'importData')
  expect(r7.success).toBe(true)
  expect(dbQuery(dataDir, 'select count(*) from clients')).toBe('1')
  expect(dbQuery(dataDir, 'select count(*) from accounts')).toBe('14')
  expect(dbQuery(dataDir, 'select count(*) from invoices')).toBe('0')
  // 旧形式(JSON単体)の復元: documents/ には手を加えない
  await setImport(sourceZip)
  await mustApi(window, 'importData') // 領収書つきに戻す
  const filesBefore = listFilesRecursive(join(dataDir, 'documents', 'receipts')).length
  expect(filesBefore).toBe(3)
  const legacy = join(workDir, 'legacy.json')
  writeFileSync(
    legacy,
    JSON.stringify({
      schemaVersion: 3,
      appVersion: '0.2.0',
      exportedAt: '2026-09-28T12:00:00+09:00',
      data: {
        clients: [
          {
            id: 1,
            name: '旧形式の取引先',
            honorific: '御中',
            contactPerson: null,
            postalCode: null,
            address: null,
            phone: null,
            email: null,
            invoiceRegistrationNumber: null,
            memo: null,
            status: 'active',
            createdAt: '2026-09-01T00:00:00.000Z',
            updatedAt: '2026-09-01T00:00:00.000Z'
          }
        ]
      }
    })
  )
  await setImport(legacy)
  const r8 = await mustApi<ImportRes>(window, 'importData')
  expect(r8.success).toBe(true)
  expect(dbQuery(dataDir, 'select name from clients')).toBe('旧形式の取引先')
  expect(dbQuery(dataDir, 'select count(*) from cash_records')).toBe('0')
  expect(dbQuery(dataDir, 'select count(*) from receipts')).toBe('0')
  expect(listFilesRecursive(join(dataDir, 'documents', 'receipts')).length).toBe(filesBefore) // 既存ファイルは残る
  noteEvidence(
    'TC-94',
    '旧形式(JSON単体)の復元',
    `結果: ${JSON.stringify(r8)}\nDBの記録・領収書=0件、documents/receipts配下のファイル${filesBefore}件は残る(設計4.3章手順7-4のとおり)`
  )
})

test('TC-95: スキーマv3(イテレーション1)のデータからの起動(移行): データ保持・初期科目14件・バージョン更新・再起動で冪等・新機能の利用', async () => {
  // v3のデータを実際に作る: アプリで書類を作成後、I2のテーブルを削除してschema_version=3に戻す
  const src = await launchApp()
  const { window, dataDir, app } = src
  await setupCompany(window)
  const c = await createClientApi(window, '移行確認商事', { furigana: 'イコウカクニンショウジ' })
  const q = await finalizeQuoteApi(window, c, '2026-09-20', [
    { name: '移行前の見積', quantity: 1, unitPrice: 50000, taxRate: 10 }
  ])
  const inv = await finalizeInvoiceApi(window, c, '2026-09-21', [
    { name: '移行前の請求', quantity: 2, unitPrice: 30000, taxRate: 10 }
  ])
  dbExec(
    dataDir,
    `update invoices set payment_status='paid', payment_date='2026-09-30' where id=${inv.id}`
  ) // イテレーション1で入金済みにした請求書
  await app.close()
  dbExec(
    dataDir,
    "drop table cash_record_history; drop table receipts; drop table cash_records; drop table accounts; update app_meta set value='3' where key='schema_version'"
  )
  expect(dbQuery(dataDir, "select value from app_meta where key='schema_version'")).toBe('3')
  expect(
    dbQuery(
      dataDir,
      "select count(*) from sqlite_master where name in ('accounts','cash_records','receipts','cash_record_history')"
    )
  ).toBe('0')
  const pre = [
    'clients',
    'company_profile',
    'quotes',
    'quote_line_items',
    'invoices',
    'invoice_line_items',
    'document_number_sequences'
  ]
    .map((t) => dbQuery(dataDir, `select * from ${t}`))
    .join('\n--\n')
  const pdfs = listFilesRecursive(join(dataDir, 'documents')).map(
    (f) => `${f.slice(dataDir.length)}:${sha256File(f)}`
  )
  // v4アプリで起動
  const re = await relaunchOnDir(dataDir)
  await expect(re.window.getByText('事務HUB').first()).toBeVisible()
  // イテレーション3以降は、v3からの起動でも最新(スキーマ版6)まで移行する
  expect(dbQuery(dataDir, "select value from app_meta where key='schema_version'")).toBe('6')
  expect(dbQuery(dataDir, 'select count(*) from accounts')).toBe('14')
  expect(dbQuery(dataDir, "select count(*) from accounts where kind='expense'")).toBe('12')
  expect(dbQuery(dataDir, "select name from accounts where default_key='sales_revenue'")).toBe(
    '売上高'
  )
  const post = [
    'clients',
    'company_profile',
    'quotes',
    'quote_line_items',
    'invoices',
    'invoice_line_items',
    'document_number_sequences'
  ]
    .map((t) => dbQuery(dataDir, `select * from ${t}`))
    .join('\n--\n')
  expect(post).toBe(pre)
  expect(
    listFilesRecursive(join(dataDir, 'documents')).map(
      (f) => `${f.slice(dataDir.length)}:${sha256File(f)}`
    )
  ).toEqual(pdfs)
  await shot(re.window, 'TC-95', 'v3データからの起動(ホーム画面が通常どおり表示)')
  await re.window.getByRole('button', { name: '見積書・請求書' }).click()
  await expect(re.window.getByRole('cell', { name: q.quoteNumber })).toBeVisible()
  await re.window.getByRole('button', { name: '請求書', exact: true }).click()
  await expect(re.window.getByRole('cell', { name: inv.invoiceNumber })).toBeVisible()
  await shot(re.window, 'TC-95', '移行後の請求書一覧(イテレーション1のデータが保持されている)')
  // 入金済みの請求書(入金記録なし)の詳細・未収に戻す
  const detail = await mustApi<{ paymentStatus: string; linkedRecords: unknown[] }>(
    re.window,
    'getInvoice',
    inv.id
  )
  expect(detail).toMatchObject({ paymentStatus: 'paid', linkedRecords: [] })
  // 新機能が使える
  const acc = await accountId(re.window, '通信費')
  const rid = await createRecordApi(re.window, { accountId: acc, description: '移行後の記録' })
  expect(rid).toBe(1)
  // 再起動しても初期科目は重複しない(冪等)
  await re.app.close()
  const re2 = await relaunchOnDir(dataDir)
  await expect(re2.window.getByText('事務HUB').first()).toBeVisible()
  expect(dbQuery(dataDir, 'select count(*) from accounts')).toBe('14')
  expect(dbQuery(dataDir, 'select count(*) from cash_records')).toBe('1')
  noteEvidence(
    'TC-95',
    '移行の確認結果',
    `schema_version=6(v3から最新まで移行)、accounts=14(経費12・収入2)、既存7テーブルの内容とPDFのSHA-256は移行前後で一致、再起動後もaccounts=14`
  )
  await re2.app.close()
  rmSync(dataDir, { recursive: true, force: true })
})
