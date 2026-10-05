import { z } from 'zod'

/** summary:getの入力。年は2000〜2099の整数、月は1〜12の整数またはnull(年全体) */
export const SummaryInputSchema = z.object({
  year: z.number().int().min(2000).max(2099),
  month: z.number().int().min(1).max(12).nullable()
})
export type SummaryInput = z.infer<typeof SummaryInputSchema>
