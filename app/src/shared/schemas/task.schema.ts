import { z } from 'zod'
import { TASK_MESSAGES, VALIDATION_MESSAGES } from '../messages/messages'
import { isValidIsoDate } from './date.schema'

/**
 * タスクの入力バリデーションスキーマ(Renderer・Mainで共有)。
 * 空のメモ・期限日はnull(未設定)に正規化する。
 * 参照元: 詳細設計書 3.28章・4.34章(`taskInputSchema`)
 */
export const TaskInputSchema = z.object({
  name: z.string().trim().min(1, TASK_MESSAGES.nameRequired).max(100, TASK_MESSAGES.nameTooLong),
  memo: z
    .string()
    .max(1000, TASK_MESSAGES.memoTooLong)
    .nullish()
    .transform((value) => (value === undefined || value === null || value === '' ? null : value)),
  dueDate: z
    .string()
    .trim()
    .refine((value) => value === '' || isValidIsoDate(value), VALIDATION_MESSAGES.dateInvalid)
    .nullish()
    .transform((value) => (value === undefined || value === null || value === '' ? null : value)),
  projectId: z
    .number()
    .int()
    .positive()
    .nullish()
    .transform((value) => value ?? null)
})
/** 画面・IPCから渡す入力(メモ・期限日・案件は省略可) */
export type TaskInput = z.input<typeof TaskInputSchema>
/** 検証・正規化後の入力 */
export type ParsedTaskInput = z.output<typeof TaskInputSchema>

export const TaskIdSchema = z.number().int().positive()
