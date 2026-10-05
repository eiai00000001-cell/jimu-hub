import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'

/**
 * イテレーション2(入出金・経費の記録)の結合シナリオ用の補助関数(tester作成)。
 * 実装コード(app/src)は参照のみで変更しない。
 */

export interface ApiResult<T = unknown> {
  ok: boolean
  value?: T
  error?: string
}

/** Rendererの`window.jimuhubApi`の任意メソッドを呼び出し、成功値または(接頭辞を除いた)エラー文言を返す */
export async function callApi<T = unknown>(
  window: Page,
  method: string,
  ...args: unknown[]
): Promise<ApiResult<T>> {
  return window.evaluate(
    async ([m, a]) => {
      const api = (
        window as unknown as { jimuhubApi: Record<string, (...x: unknown[]) => unknown> }
      ).jimuhubApi
      try {
        const value = (await api[m as string](...(a as unknown[]))) as unknown
        return { ok: true, value }
      } catch (e) {
        const raw = e instanceof Error ? e.message : String(e)
        let msg = raw
          .replace(/^Error invoking remote method '[^']*': /, '')
          .replace(/^\w*Error: /, '')
        // 画面外(IPC直叩き)ではZodの検証エラーがJSON配列の文字列で届く。文言(message)だけを取り出す
        if (msg.startsWith('[')) {
          try {
            msg = (JSON.parse(msg) as Array<{ message: string }>).map((x) => x.message).join(' / ')
          } catch {
            /* そのまま */
          }
        }
        return { ok: false, error: msg }
      }
    },
    [method, args] as const
  ) as Promise<ApiResult<T>>
}

/** 成功を前提にAPIを呼ぶ(失敗時は例外) */
export async function mustApi<T = unknown>(
  window: Page,
  method: string,
  ...args: unknown[]
): Promise<T> {
  const r = await callApi<T>(window, method, ...args)
  if (!r.ok) throw new Error(`${method} failed: ${r.error}`)
  return r.value as T
}

interface AccountLite {
  id: number
  name: string
  kind: 'expense' | 'income'
  status: string
}

export async function accountId(window: Page, name: string): Promise<number> {
  const list = await mustApi<AccountLite[]>(window, 'listAccounts', { includeInactive: true })
  const a = list.find((x) => x.name === name)
  if (!a) throw new Error(`勘定科目が見つかりません: ${name}`)
  return a.id
}

/** メインプロセスの領収書選択(E2E用環境変数)のパスを実行中に差し替える */
export async function setReceiptPaths(app: ElectronApplication, paths: string[]): Promise<void> {
  await app.evaluate((_electron, p) => {
    process.env.JIMUHUB_E2E_RECEIPT_PATHS = p
  }, paths.join(','))
}

export async function setEnv(app: ElectronApplication, name: string, value: string): Promise<void> {
  await app.evaluate(
    (_electron, [n, v]) => {
      process.env[n as string] = v as string
    },
    [name, value]
  )
}

/** 1x1の有効なPNG */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

export interface Fixtures {
  dir: string
  pdf: string
  png: string
  jpg: string
  fakePng: string // 拡張子はpngだが中身はテキスト
  empty: string // 0バイトのpdf
  txt: string // 対応外の拡張子
  big: string // 10MB超のpdf
}

/** 架空の領収書ファイル一式を一時ディレクトリへ作る(個人情報を含まない) */
export function makeReceiptFixtures(): Fixtures {
  const dir = mkdtempSync(join(tmpdir(), 'jimuhub-i2-fixtures-'))
  const pdf = join(dir, 'receipt_sample.pdf')
  writeFileSync(pdf, '%PDF-1.4\n% dummy receipt for test\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
  const png = join(dir, 'receipt_sample.png')
  writeFileSync(png, PNG_1X1)
  const jpg = join(dir, 'receipt_sample.jpg')
  execFileSync('sips', ['-s', 'format', 'jpeg', png, '--out', jpg], { stdio: 'pipe' })
  const fakePng = join(dir, 'fake.png')
  writeFileSync(fakePng, 'this is not a png image')
  const empty = join(dir, 'empty.pdf')
  writeFileSync(empty, '')
  const txt = join(dir, 'memo.txt')
  writeFileSync(txt, 'plain text')
  const big = join(dir, 'too_big.pdf')
  writeFileSync(big, Buffer.concat([Buffer.from('%PDF-1.4\n'), randomBytes(10 * 1024 * 1024 + 10)]))
  return { dir, pdf, png, jpg, fakePng, empty, txt, big }
}

export interface PickedToken {
  token: string
  fileName: string
}

/** 領収書を選択(環境変数で指定したパス)してトークンを得る */
export async function pickTokens(
  window: Page,
  app: ElectronApplication,
  paths: string[]
): Promise<{ files: PickedToken[]; errors: Array<{ fileName: string; error: string }> }> {
  await setReceiptPaths(app, paths)
  return mustApi(window, 'pickReceipts')
}

export interface NewRecord {
  kind?: 'income' | 'expense'
  recordDate?: string
  amount?: number
  accountId: number
  description?: string
  clientId?: number | null
  paymentMethod?: string | null
  taxCategory?: string | null
  receiptTokens?: string[]
}

export async function createRecordApi(window: Page, r: NewRecord): Promise<number> {
  const res = await mustApi<{ id: number }>(window, 'createRecord', {
    kind: 'expense',
    recordDate: '2026-10-01',
    amount: 1100,
    description: '試験用の記録',
    clientId: null,
    paymentMethod: null,
    taxCategory: null,
    receiptTokens: [],
    ...r
  })
  return res.id
}

/** 入金済みにする(API) */
export async function markPaid(window: Page, invoiceId: number, date: string): Promise<void> {
  await mustApi(window, 'updateInvoicePaymentStatus', invoiceId, {
    paymentStatus: 'paid',
    paymentDate: date
  })
}

/** テスト用一時データのDBを直接書き換える(改ざん・前提データの作成用。アプリ本体の実データには触れない)。アプリ起動中でも実行できる */
export function dbExec(dataDir: string, sql: string): void {
  execFileSync('sqlite3', [join(dataDir, 'data.sqlite'), sql], { encoding: 'utf8', stdio: 'pipe' })
}

/** メインプロセスの`shell.openPath`・`showItemInFolder`と`dialog.showMessageBox`を差し替える(外部アプリを起動させず、呼び出しを記録する) */
export async function stubShell(
  app: ElectronApplication,
  confirmResponse: 0 | 1 = 0
): Promise<void> {
  await app.evaluate(({ shell, dialog }, resp) => {
    const g = globalThis as unknown as { __shellCalls: string[]; __dialogCalls: string[] }
    g.__shellCalls = []
    g.__dialogCalls = []
    ;(shell as unknown as { openPath: (p: string) => Promise<string> }).openPath = async (p) => {
      g.__shellCalls.push(`open:${p}`)
      return ''
    }
    ;(shell as unknown as { showItemInFolder: (p: string) => void }).showItemInFolder = (p) => {
      g.__shellCalls.push(`show:${p}`)
    }
    ;(
      dialog as unknown as { showMessageBox: (...a: unknown[]) => Promise<unknown> }
    ).showMessageBox = async (...a: unknown[]) => {
      const opt = a[a.length - 1] as { message?: string }
      g.__dialogCalls.push(opt.message ?? '')
      return { response: resp, checkboxChecked: false }
    }
  }, confirmResponse)
}

export async function shellCalls(
  app: ElectronApplication
): Promise<{ shell: string[]; dialog: string[] }> {
  return app.evaluate(() => {
    const g = globalThis as unknown as { __shellCalls?: string[]; __dialogCalls?: string[] }
    return { shell: g.__shellCalls ?? [], dialog: g.__dialogCalls ?? [] }
  })
}

/** 既存のデータ保存先(一時ディレクトリ)でアプリを起動し直す(移行テスト用)。終了時にディレクトリは削除しない */
export async function relaunchOnDir(
  dataDir: string,
  extraEnv: Record<string, string> = {}
): Promise<{ app: ElectronApplication; window: Page }> {
  const { _electron: electron } = await import('@playwright/test')
  const { fileURLToPath } = await import('node:url')
  const entry = join(
    fileURLToPath(new URL('.', import.meta.url)),
    '..',
    '..',
    'out',
    'main',
    'index.js'
  )
  const app = await electron.launch({
    args: [entry],
    env: { ...process.env, JIMUHUB_DATA_DIR: dataDir, JIMUHUB_WINDOW_SHOW: '0', ...extraEnv }
  })
  const window = await app.firstWindow()
  return { app, window }
}

/** I2のテーブルを含む全テーブルの内容(ID順)を文字列化する。DBの往復比較用 */
export function dumpAll(dataDir: string, dbQueryFn: (dir: string, sql: string) => string): string {
  const q = [
    'select * from clients order by id',
    'select * from company_profile',
    'select * from quotes order by id',
    'select * from quote_line_items order by id',
    'select * from invoices order by id',
    'select * from invoice_line_items order by id',
    'select * from accounts order by id',
    'select * from cash_records order by id',
    'select * from receipts order by id',
    'select * from cash_record_history order by id',
    'select doc_type,year,last_number from document_number_sequences order by doc_type,year'
  ]
  return q
    .map((s) => dbQueryFn(dataDir, s))
    .join('\n--\n')
    .split(dataDir)
    .join('<D>')
}
