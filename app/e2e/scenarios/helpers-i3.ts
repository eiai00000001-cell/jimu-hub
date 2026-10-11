import type { Page } from '@playwright/test'
import { callApi, mustApi } from './helpers-i2'

/**
 * イテレーション3(案件管理・バックアップのストリーム化)の結合シナリオ用の補助関数(tester作成)。
 * 実装コード(app/src)は参照のみで変更しない。
 */

export interface NewProject {
  name: string
  clientId?: number | null
  startDate?: string
  endDate?: string
  memo?: string
}

export async function createProjectApi(window: Page, p: NewProject): Promise<number> {
  const r = await mustApi<{ id: number }>(window, 'createProject', {
    clientId: null,
    startDate: '',
    endDate: '',
    memo: '',
    ...p
  })
  return r.id
}

export interface ProjectSummaryLite {
  sales: number
  withholding: number
  expense: number
  balance: number
  counts: {
    quotes: number
    invoicesIssued: number
    invoicesDraft: number
    incomes: number
    expenses: number
  }
}

export interface ProjectDetailLite {
  id: number
  name: string
  status: 'active' | 'completed'
  summary: ProjectSummaryLite
  deletable: boolean
  quotes: Array<{ id: number }>
  invoices: Array<{ id: number }>
  records: Array<{ id: number }>
  history: Array<{
    kind: string
    targetType: string
    targetId: number
    fromProjectName: string | null
    toProjectName: string | null
  }>
}

export async function getProjectApi(window: Page, id: number): Promise<ProjectDetailLite> {
  return mustApi<ProjectDetailLite>(window, 'getProject', id)
}

/** 見積書の下書きを(案件つきで)保存する */
export async function saveQuoteDraftApi(
  window: Page,
  clientId: number,
  projectId: number | null | undefined,
  issueDate = '2026-10-04',
  unitPrice = 1000
): Promise<number> {
  const r = await mustApi<{ id: number }>(window, 'saveQuoteDraft', {
    clientId,
    issueDate,
    validUntil: '',
    remarks: '',
    lineItems: [{ name: '下書き明細', quantity: 1, unit: '', unitPrice, taxRate: 10 }],
    ...(projectId === undefined ? {} : { projectId })
  })
  return r.id
}

export async function saveInvoiceDraftApi(
  window: Page,
  clientId: number,
  projectId: number | null | undefined,
  issueDate = '2026-10-04',
  unitPrice = 1000
): Promise<number> {
  const r = await mustApi<{ id: number }>(window, 'saveInvoiceDraft', {
    clientId,
    issueDate,
    dueDate: '',
    remarks: '',
    lineItems: [
      {
        name: '下書き明細',
        quantity: 1,
        unit: '',
        unitPrice,
        taxRate: 10,
        withholdingTarget: false
      }
    ],
    ...(projectId === undefined ? {} : { projectId })
  })
  return r.id
}

export interface FinalizeSpec {
  clientId: number
  projectId?: number | null
  issueDate?: string
  unitPrice: number
  quantity?: number
  withholding?: boolean
  id?: number
}

export async function finalizeInvoiceWithProject(
  window: Page,
  s: FinalizeSpec
): Promise<{ id: number; invoiceNumber: string }> {
  return mustApi(window, 'finalizeInvoice', {
    ...(s.id ? { id: s.id } : {}),
    clientId: s.clientId,
    issueDate: s.issueDate ?? '2026-10-05',
    dueDate: '',
    remarks: '',
    lineItems: [
      {
        name: '業務委託',
        quantity: s.quantity ?? 1,
        unit: '式',
        unitPrice: s.unitPrice,
        taxRate: 10,
        withholdingTarget: s.withholding ?? false
      }
    ],
    ...(s.projectId === undefined ? {} : { projectId: s.projectId })
  })
}

export async function finalizeQuoteWithProject(
  window: Page,
  s: FinalizeSpec
): Promise<{ id: number; quoteNumber: string }> {
  return mustApi(window, 'finalizeQuote', {
    ...(s.id ? { id: s.id } : {}),
    clientId: s.clientId,
    issueDate: s.issueDate ?? '2026-10-02',
    validUntil: '',
    remarks: '',
    lineItems: [
      {
        name: '設計',
        quantity: s.quantity ?? 1,
        unit: '式',
        unitPrice: s.unitPrice,
        taxRate: 10
      }
    ],
    ...(s.projectId === undefined ? {} : { projectId: s.projectId })
  })
}

export async function changeLinkApi(
  window: Page,
  targetType: 'quote' | 'invoice' | 'cash_record',
  targetId: number,
  projectId: number | null
): ReturnType<typeof callApi<{ changed: boolean }>> {
  return callApi<{ changed: boolean }>(window, 'changeProjectLink', {
    targetType,
    targetId,
    projectId
  })
}

/** window.confirm を、指定した回答で1回だけ処理する(確認ダイアログの文言を返す) */
export function answerNextConfirm(window: Page, accept: boolean): Promise<string> {
  return new Promise((resolve) => {
    window.once('dialog', (d) => {
      const message = d.message()
      void (accept ? d.accept() : d.dismiss()).then(() => resolve(message))
    })
  })
}
