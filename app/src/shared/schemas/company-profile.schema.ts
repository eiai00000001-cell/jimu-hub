import { z } from 'zod'
import { ACCOUNT_TYPES } from '../types/company-profile'
import { VALIDATION_MESSAGES } from '../messages/messages'

/**
 * 自社情報・振込先の入力バリデーションスキーマ。
 * 参照元: 詳細設計書 3.9章(自社情報・振込先設定画面)の入力項目定義表。
 */

const optionalText = (label: string, max: number): z.ZodString =>
  z.string().max(max, VALIDATION_MESSAGES.maxLength(label, max))

export const CompanyProfileInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, VALIDATION_MESSAGES.companyNameRequired)
    .max(100, VALIDATION_MESSAGES.maxLength('氏名・屋号', 100)),
  address: z
    .string()
    .trim()
    .min(1, VALIDATION_MESSAGES.companyAddressRequired)
    .max(200, VALIDATION_MESSAGES.maxLength('住所', 200)),
  invoiceRegistrationNumber: optionalText('インボイス登録番号', 14).default(''),
  bankName: optionalText('振込先銀行名', 50).default(''),
  bankBranch: optionalText('振込先支店名', 50).default(''),
  // 未選択は空文字で表す('普通'/'当座'のいずれでもない場合はDB上NULLとして保存する)
  accountType: z.enum(['', ...ACCOUNT_TYPES]).default(''),
  accountNumber: optionalText('口座番号', 10).default(''),
  accountHolder: optionalText('口座名義', 100).default('')
})

export type CompanyProfileInput = z.infer<typeof CompanyProfileInputSchema>
