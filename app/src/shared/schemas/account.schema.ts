import { z } from 'zod'
import { ACCOUNT_MESSAGES } from '../messages/messages'

/**
 * 勘定科目の入力バリデーションスキーマ。
 * 参照元: 詳細設計書 3.21章・4.17章(`accountInputSchema`)
 */
export const AccountNameSchema = z
  .string()
  .trim()
  .min(1, ACCOUNT_MESSAGES.nameRequired)
  .max(30, ACCOUNT_MESSAGES.nameTooLong)

export const AccountInputSchema = z.object({
  name: AccountNameSchema,
  kind: z.enum(['expense', 'income'])
})

export type AccountInput = z.infer<typeof AccountInputSchema>

export const AccountIdSchema = z.number().int().positive()

export const AccountListFilterSchema = z.object({
  kind: z.enum(['expense', 'income']).optional(),
  includeInactive: z.boolean().optional()
})
