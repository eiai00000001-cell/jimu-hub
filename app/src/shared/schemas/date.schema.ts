import { z } from 'zod'
import { VALIDATION_MESSAGES } from '../messages/messages'

/** `YYYY-MM-DD`形式かつ実在する暦日であるかを判定する */
export function isValidIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

/** 必須の日付(`YYYY-MM-DD`)。空文字は「未入力」のメッセージ、形式不正は形式エラーとする */
export const requiredIsoDate = (requiredMessage: string): z.ZodType<string> =>
  z.string().trim().min(1, requiredMessage).refine(isValidIsoDate, VALIDATION_MESSAGES.dateInvalid)

/** 任意の日付。空文字は許容し、値がある場合のみ`YYYY-MM-DD`の実在日を要求する */
export const optionalIsoDate = z
  .string()
  .trim()
  .refine((value) => value === '' || isValidIsoDate(value), VALIDATION_MESSAGES.dateInvalid)
