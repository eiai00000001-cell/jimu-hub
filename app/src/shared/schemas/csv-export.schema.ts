import { z } from 'zod'
import { CSV_MESSAGES } from '../messages/messages'

/** `YYYY-MM`形式かつ実在する年月か */
export function isValidMonth(value: string): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(value)
  if (!m) return false
  const month = Number(m[2])
  return month >= 1 && month <= 12
}

const month = z.string().refine(isValidMonth, CSV_MESSAGES.monthInvalid)

/** csv:exportの入力。終了年月は開始年月以降(詳細設計書4.24章) */
export const CsvExportInputSchema = z
  .object({ fromMonth: month, toMonth: month })
  .superRefine((value, ctx) => {
    if (value.toMonth < value.fromMonth) {
      ctx.addIssue({ code: 'custom', path: ['toMonth'], message: CSV_MESSAGES.monthRangeInvalid })
    }
  })
export type CsvExportInput = z.infer<typeof CsvExportInputSchema>
