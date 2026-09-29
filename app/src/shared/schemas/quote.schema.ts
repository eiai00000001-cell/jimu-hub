import { z } from 'zod'
import { VALIDATION_MESSAGES } from '../messages/messages'

/**
 * 見積書の入力バリデーションスキーマ。
 * 参照元: 詳細設計書 3.11章(見積書作成画面)の入力項目定義表。
 * 請求書作成画面(F-13)も明細行部分は共通で利用する(詳細設計書4.14章)。
 */

const optionalText = (label: string, max: number): z.ZodString =>
  z.string().max(max, VALIDATION_MESSAGES.maxLength(label, max))

function hasAtMostTwoDecimalPlaces(value: number): boolean {
  const scaled = value * 100
  return Math.abs(scaled - Math.round(scaled)) < 1e-9
}

export const LineItemInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, VALIDATION_MESSAGES.lineItemNameRequired)
    .max(100, VALIDATION_MESSAGES.maxLength('品名', 100)),
  quantity: z
    .number()
    .positive(VALIDATION_MESSAGES.lineItemQuantityInvalid)
    .refine(hasAtMostTwoDecimalPlaces, VALIDATION_MESSAGES.lineItemQuantityInvalid)
    .default(1),
  unit: optionalText('単位', 10).default(''),
  unitPrice: z.number().int().min(0, VALIDATION_MESSAGES.lineItemUnitPriceInvalid).default(0),
  taxRate: z.union([z.literal(10), z.literal(8)]).default(10)
})
export type LineItemInput = z.infer<typeof LineItemInputSchema>

export const QuoteInputSchema = z.object({
  // 未選択は0で表す(取引先idは1始まりの自動採番のため、0は「未選択」を表す番兵値として扱う)
  clientId: z.number().int().min(1, VALIDATION_MESSAGES.quoteClientRequired),
  issueDate: z.string().trim().min(1, VALIDATION_MESSAGES.issueDateRequired),
  validUntil: z.string().trim().default(''),
  remarks: optionalText('備考', 500).default(''),
  lineItems: z.array(LineItemInputSchema).min(1, VALIDATION_MESSAGES.lineItemsRequired)
})
export type QuoteInput = z.infer<typeof QuoteInputSchema>
