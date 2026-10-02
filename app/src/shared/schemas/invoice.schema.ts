import { z } from 'zod'
import { VALIDATION_MESSAGES } from '../messages/messages'
import { optionalIsoDate, requiredIsoDate } from './date.schema'
import { LineItemInputSchema } from './quote.schema'

/**
 * 請求書の入力バリデーションスキーマ。
 * 参照元: 詳細設計書 4.14章(基本構成は見積書作成画面3.11章に準ずる。差分のみ記載)
 */

const optionalText = (label: string, max: number): z.ZodString =>
  z.string().max(max, VALIDATION_MESSAGES.maxLength(label, max))

/** 見積書の明細行スキーマ(LineItemInputSchema)に「源泉徴収対象」チェックを追加したもの(F-16) */
export const InvoiceLineItemInputSchema = LineItemInputSchema.extend({
  withholdingTarget: z.boolean().default(false)
})
export type InvoiceLineItemInput = z.infer<typeof InvoiceLineItemInputSchema>

/** 入金ステータス変更(F-15)。入金済みの場合は入金日が必須、未収の場合は入金日をクリアする */
export const PaymentStatusInputSchema = z
  .object({
    paymentStatus: z.enum(['unpaid', 'paid']),
    paymentDate: optionalIsoDate.nullable().optional()
  })
  .superRefine((value, ctx) => {
    if (value.paymentStatus === 'paid' && !value.paymentDate) {
      ctx.addIssue({
        code: 'custom',
        path: ['paymentDate'],
        message: VALIDATION_MESSAGES.paymentDateRequired
      })
    }
  })
export type PaymentStatusInput = z.infer<typeof PaymentStatusInputSchema>

export const InvoiceInputSchema = z.object({
  // 未選択は0で表す(取引先idは1始まりの自動採番のため、0は「未選択」を表す番兵値として扱う)
  clientId: z.number().int().min(1, VALIDATION_MESSAGES.quoteClientRequired),
  issueDate: requiredIsoDate(VALIDATION_MESSAGES.issueDateRequired),
  dueDate: optionalIsoDate.default(''),
  remarks: optionalText('備考', 500).default(''),
  lineItems: z.array(InvoiceLineItemInputSchema).min(1, VALIDATION_MESSAGES.lineItemsRequired)
})
export type InvoiceInput = z.infer<typeof InvoiceInputSchema>
