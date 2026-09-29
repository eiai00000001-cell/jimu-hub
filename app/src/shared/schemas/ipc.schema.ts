import { z } from 'zod'
import { CLIENT_SORT_KEYS, CLIENT_STATUS_FILTERS } from '../types/client'
import { QUOTE_STATUS_FILTERS } from '../types/quote'

/**
 * IPC境界(Renderer→Main)で受け取る値の実行時バリデーションスキーマ。
 * 参照元: レビュー結果報告書 v0.0 No.3(型注釈のみでは実行時の不正値を防げないため)
 */

/** clients:get・clients:update・clients:deactivateのid */
export const ClientIdSchema = z.number().int().positive()

/** clients:listのfilter(keyword・sort・statusFilter) */
export const ClientListFilterSchema = z.object({
  keyword: z.string().optional(),
  sort: z.enum(CLIENT_SORT_KEYS).optional(),
  statusFilter: z.enum(CLIENT_STATUS_FILTERS).optional()
})

/** quotes:get・quotes:openPdf・quotes:showPdfInFolderのid */
export const QuoteIdSchema = z.number().int().positive()

/** quotes:saveDraft・quotes:finalizeの{ id? }(新規作成時は省略される) */
export const OptionalQuoteIdSchema = z.number().int().positive().optional()

/** quotes:listのfilter */
export const QuoteListFilterSchema = z.object({
  keyword: z.string().optional(),
  clientId: z.number().int().positive().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  amountMin: z.number().optional(),
  amountMax: z.number().optional(),
  status: z.enum(QUOTE_STATUS_FILTERS).optional()
})
