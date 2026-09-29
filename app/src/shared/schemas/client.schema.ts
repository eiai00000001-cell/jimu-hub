import { z } from 'zod'
import { HONORIFICS } from '../types/client'
import { VALIDATION_MESSAGES } from '../messages/messages'
import { convertHiraganaToKatakana, isValidFurigana } from '../text/furigana'

/**
 * 取引先の入力バリデーションスキーマ。
 * 参照元: 詳細設計書 3.3章(取引先登録画面)の入力項目定義表。
 * 登録画面(F-04)・編集画面(F-07)の双方から共通で利用する(詳細設計書3.5章)。
 */

const POSTAL_CODE_PATTERN = /^[0-9-]*$/
const PHONE_PATTERN = /^[0-9\-()]*$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/

const optionalText = (label: string, max: number): z.ZodString =>
  z.string().max(max, VALIDATION_MESSAGES.maxLength(label, max))

export const ClientInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, VALIDATION_MESSAGES.nameRequired)
    .max(100, VALIDATION_MESSAGES.maxLength('取引先名称', 100)),
  // ひらがな入力は全角カタカナへ自動変換した上で、全角カタカナのみを許容する
  // (コーディング規約.md 7.2章。詳細設計書v1.3からの追加制約)
  furigana: z
    .string()
    .trim()
    .transform(convertHiraganaToKatakana)
    .pipe(
      z
        .string()
        .max(100, VALIDATION_MESSAGES.maxLength('フリガナ', 100))
        .refine(isValidFurigana, VALIDATION_MESSAGES.furiganaFormat)
    )
    .default(''),
  honorific: z.enum(HONORIFICS).default('(なし)'),
  contactPerson: optionalText('担当者名', 50).default(''),
  postalCode: optionalText('郵便番号', 8)
    .regex(POSTAL_CODE_PATTERN, VALIDATION_MESSAGES.postalCodeFormat)
    .default(''),
  address: optionalText('住所', 200).default(''),
  phone: optionalText('電話番号', 20)
    .regex(PHONE_PATTERN, VALIDATION_MESSAGES.phoneFormat)
    .default(''),
  email: optionalText('メールアドレス', 254)
    .refine((value) => value === '' || EMAIL_PATTERN.test(value), {
      message: VALIDATION_MESSAGES.emailFormat
    })
    .default(''),
  invoiceRegistrationNumber: optionalText('インボイス登録番号', 14).default(''),
  memo: optionalText('メモ', 2000).default('')
})

export type ClientInput = z.infer<typeof ClientInputSchema>
