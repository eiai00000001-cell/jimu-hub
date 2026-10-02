import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

/** 結合シナリオ共通のテスト用架空データ(実在の個人情報は使わない) */
export const COMPANY = {
  name: '試験用デザイン事務所',
  address: '東京都千代田区試験1-2-3(架空)',
  invoiceRegistrationNumber: 'T1234567890123',
  bankName: '架空銀行',
  bankBranch: '試験支店',
  accountType: '普通' as const,
  accountNumber: '1234567',
  accountHolder: 'シケンデザインジムショ'
}

type Api = Window['jimuhubApi']

/** Rendererのwindow.jimuhubApi経由で自社情報を登録する(画面操作の事前準備用) */
export async function setupCompany(
  window: Page,
  overrides: Partial<typeof COMPANY> = {}
): Promise<void> {
  const input = { ...COMPANY, ...overrides }
  await window.evaluate(
    (i) => (window as unknown as { jimuhubApi: Api }).jimuhubApi.saveCompanyProfile(i as never),
    input
  )
}

export async function createClientApi(
  window: Page,
  name: string,
  extra: Record<string, unknown> = {}
): Promise<number> {
  return window.evaluate(
    async ([n, e]) => {
      const api = (window as unknown as { jimuhubApi: Api }).jimuhubApi
      const result = await api.createClient({
        name: n,
        honorific: '御中',
        ...(e as object)
      } as never)
      return result.id
    },
    [name, extra] as const
  )
}

export interface LineSpec {
  name: string
  quantity: number
  unit?: string
  unitPrice: number
  taxRate: 10 | 8
  withholdingTarget?: boolean
}

export async function finalizeQuoteApi(
  window: Page,
  clientId: number,
  issueDate: string,
  lines: LineSpec[],
  remarks = ''
): Promise<{ id: number; quoteNumber: string; pdfPath: string }> {
  return window.evaluate(
    async ([c, d, l, r]) => {
      const api = (window as unknown as { jimuhubApi: Api }).jimuhubApi
      return api.finalizeQuote({
        clientId: c,
        issueDate: d,
        validUntil: '',
        remarks: r,
        lineItems: (l as LineSpec[]).map((x) => ({ unit: '', ...x }))
      } as never) as Promise<{ id: number; quoteNumber: string; pdfPath: string }>
    },
    [clientId, issueDate, lines, remarks] as const
  )
}

export async function finalizeInvoiceApi(
  window: Page,
  clientId: number,
  issueDate: string,
  lines: LineSpec[],
  remarks = ''
): Promise<{ id: number; invoiceNumber: string; pdfPath: string }> {
  return window.evaluate(
    async ([c, d, l, r]) => {
      const api = (window as unknown as { jimuhubApi: Api }).jimuhubApi
      return api.finalizeInvoice({
        clientId: c,
        issueDate: d,
        dueDate: '',
        remarks: r,
        lineItems: (l as LineSpec[]).map((x) => ({ unit: '', withholdingTarget: false, ...x }))
      } as never) as Promise<{ id: number; invoiceNumber: string; pdfPath: string }>
    },
    [clientId, issueDate, lines, remarks] as const
  )
}

/** 読み取り専用でSQLiteを問い合わせる(macOS標準のsqlite3 CLI。アプリ本体のDBは変更しない) */
export function dbQuery(dataDir: string, sql: string): string {
  return execFileSync(
    'sqlite3',
    ['-readonly', '-separator', '|', join(dataDir, 'data.sqlite'), sql],
    {
      encoding: 'utf8'
    }
  ).trim()
}

export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export function listFilesRecursive(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listFilesRecursive(p))
    else out.push(p)
  }
  return out
}

let pdfTextBin: string | null = null

/** macOS標準のPDFKit(swift)でPDFのテキストとページ数を取り出す。戻り値の先頭行は`PAGES:<n>` */
export function pdfText(pdfPath: string): { pages: number; text: string } {
  if (!pdfTextBin) {
    const dir = join(tmpdir(), 'jimuhub-pdf-tools')
    mkdirSync(dir, { recursive: true })
    const bin = join(dir, 'pdf-text')
    if (!existsSync(bin)) {
      execFileSync('swiftc', ['-O', join(__dirname, 'tools', 'pdf-text.swift'), '-o', bin], {
        stdio: 'pipe'
      })
    }
    pdfTextBin = bin
  }
  const out = execFileSync(pdfTextBin, [pdfPath], { encoding: 'utf8' })
  const [first, ...rest] = out.split('\n')
  return { pages: Number((first ?? '').replace('PAGES:', '')), text: rest.join('\n') }
}

/** PDFの1ページ目をPNGへ変換する(macOS標準のsips)。エビデンス用 */
export function pdfToPng(pdfPath: string, pngPath: string): void {
  execFileSync('sips', ['-s', 'format', 'png', pdfPath, '--out', pngPath], { stdio: 'pipe' })
}

export function todayIso(): string {
  const d = new Date()
  const pad = (v: number): string => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
