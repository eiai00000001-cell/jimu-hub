import { z } from 'zod'
import { RECEIPT_MESSAGES, RECORD_MESSAGES } from '../messages/messages'
import { RECEIPT_LIMITS } from '../constants/receipt'
import { VALIDATION_MESSAGES } from '../messages/messages'
import {
  HISTORY_OPERATIONS,
  PAYMENT_METHODS,
  RECORD_AMOUNT_MAX,
  RECORD_DATE_MAX,
  RECORD_DATE_MIN,
  RECORD_DESCRIPTION_MAX,
  RECORD_KINDS,
  RECORD_REASON_MAX,
  TAX_CATEGORIES
} from '../constants/cash-record'
import { isValidIsoDate } from './date.schema'

/**
 * 入出金・経費の入力・検索条件のZodスキーマ。
 * 参照元: 詳細設計書3.15〜3.18章、4.18・4.19章(`cashRecordInputSchema`)
 */
const recordDate = z
  .string()
  .trim()
  .min(1, RECORD_MESSAGES.dateRequired)
  .refine(isValidIsoDate, VALIDATION_MESSAGES.dateInvalid)
  .refine((v) => v >= RECORD_DATE_MIN && v <= RECORD_DATE_MAX, RECORD_MESSAGES.dateOutOfRange)

const optionalDate = z
  .string()
  .trim()
  .refine((v) => v === '' || isValidIsoDate(v), VALIDATION_MESSAGES.dateInvalid)
  .optional()

export const CashRecordInputSchema = z.object({
  kind: z.enum(RECORD_KINDS),
  recordDate,
  amount: z
    .number(RECORD_MESSAGES.amountInvalid)
    .int(RECORD_MESSAGES.amountInvalid)
    .min(1, RECORD_MESSAGES.amountInvalid)
    .max(RECORD_AMOUNT_MAX, RECORD_MESSAGES.amountInvalid),
  accountId: z
    .number(RECORD_MESSAGES.accountRequired)
    .int(RECORD_MESSAGES.accountRequired)
    .positive(RECORD_MESSAGES.accountRequired),
  description: z
    .string()
    .trim()
    .min(1, RECORD_MESSAGES.descriptionRequired)
    .max(RECORD_DESCRIPTION_MAX, RECORD_MESSAGES.descriptionTooLong),
  clientId: z.number().int().positive().nullable(),
  paymentMethod: z.enum(PAYMENT_METHODS).nullable(),
  taxCategory: z.enum(TAX_CATEGORIES).nullable()
})
export type CashRecordInput = z.infer<typeof CashRecordInputSchema>

const receiptTokens = z
  .array(z.string().min(1))
  .max(RECEIPT_LIMITS.maxPerRecord, RECEIPT_MESSAGES.countExceeded)
  .refine((tokens) => new Set(tokens).size === tokens.length, RECEIPT_MESSAGES.tokenDuplicated)

/** records:createの入力(領収書の識別子の配列を含む。`receipts:pick`が返したもの) */
export const CashRecordCreateSchema = CashRecordInputSchema.extend({
  receiptTokens: receiptTokens.default([]),
  /** 紐づける案件(任意。登録時のみ。更新では扱わない。詳細設計書3.26章・4.30章) */
  projectId: z.number().int().positive().nullable().optional()
})
export type CashRecordCreateInput = z.input<typeof CashRecordCreateSchema>

const reason = z.string().trim().max(RECORD_REASON_MAX, RECORD_MESSAGES.reasonTooLong).optional()

export const RecordIdSchema = z.number().int().positive()

/** records:updateの入力(領収書の追加・外す指定を含む) */
export const CashRecordUpdateSchema = CashRecordInputSchema.extend({
  id: RecordIdSchema,
  reason,
  addReceiptTokens: receiptTokens.default([]),
  removeReceiptIds: z.array(z.number().int().positive()).default([])
})
export type CashRecordUpdateInput = z.input<typeof CashRecordUpdateSchema>

export const CashRecordDeleteSchema = z.object({ id: RecordIdSchema, reason })
export type CashRecordDeleteInput = z.infer<typeof CashRecordDeleteSchema>

/** 日付範囲・金額範囲の逆転は、Mainでも拒否する(詳細設計書4.19章手順1) */
export const RecordListFilterSchema = z
  .object({
    dateFrom: optionalDate,
    dateTo: optionalDate,
    amountMin: z.number().int().min(0).optional(),
    amountMax: z.number().int().min(0).optional(),
    clientId: z.number().int().positive().optional(),
    accountId: z.number().int().positive().optional(),
    kind: z.enum(RECORD_KINDS).optional(),
    page: z.number().int().min(1).optional()
  })
  .superRefine((value, ctx) => {
    if (value.dateFrom && value.dateTo && value.dateTo < value.dateFrom) {
      ctx.addIssue({ code: 'custom', message: RECORD_MESSAGES.dateRangeInvalid })
    }
    if (
      value.amountMin !== undefined &&
      value.amountMax !== undefined &&
      value.amountMax < value.amountMin
    ) {
      ctx.addIssue({ code: 'custom', message: VALIDATION_MESSAGES.amountRangeInvalid })
    }
  })

export const HistoryListFilterSchema = z
  .object({
    operation: z.enum(HISTORY_OPERATIONS).optional(),
    dateFrom: optionalDate,
    dateTo: optionalDate,
    page: z.number().int().min(1).optional()
  })
  .superRefine((value, ctx) => {
    if (value.dateFrom && value.dateTo && value.dateTo < value.dateFrom) {
      ctx.addIssue({ code: 'custom', message: RECORD_MESSAGES.dateRangeInvalid })
    }
  })
