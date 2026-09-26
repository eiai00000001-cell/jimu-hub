import { z } from 'zod'
import { CLIENT_SORT_KEYS, CLIENT_STATUS_FILTERS } from '../types/client'

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
