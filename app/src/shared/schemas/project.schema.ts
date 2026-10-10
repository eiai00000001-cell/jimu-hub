import { z } from 'zod'
import { PROJECT_MESSAGES } from '../messages/messages'
import { isValidIsoDate, optionalIsoDate } from './date.schema'
import { PROJECT_LINK_TARGET_TYPES, PROJECT_STATUS_FILTERS } from '../types/project'

/**
 * 案件の入力バリデーションスキーマ(Renderer・Mainで共有)。
 * 参照元: 詳細設計書 3.23章・4.27章(`projectInputSchema`)
 */
export const ProjectInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, PROJECT_MESSAGES.nameRequired)
      .max(100, PROJECT_MESSAGES.nameTooLong),
    clientId: z.number().int().positive().nullable(),
    startDate: optionalIsoDate,
    endDate: optionalIsoDate,
    memo: z.string().max(1000, PROJECT_MESSAGES.memoTooLong)
  })
  .superRefine((value, context) => {
    if (
      value.startDate !== '' &&
      value.endDate !== '' &&
      isValidIsoDate(value.startDate) &&
      isValidIsoDate(value.endDate) &&
      value.endDate < value.startDate
    ) {
      context.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: PROJECT_MESSAGES.periodInvalid
      })
    }
  })
export type ProjectInput = z.infer<typeof ProjectInputSchema>

export const ProjectIdSchema = z.number().int().positive()

/** 案件一覧の検索条件。期間は、両方ある場合に終了日が開始日以降であること */
export const ProjectListFilterSchema = z
  .object({
    keyword: z.string().trim().max(100).optional(),
    clientId: z.number().int().positive().optional(),
    status: z.enum(PROJECT_STATUS_FILTERS).optional(),
    periodFrom: optionalIsoDate.optional(),
    periodTo: optionalIsoDate.optional()
  })
  .superRefine((value, context) => {
    if (value.periodFrom && value.periodTo && value.periodTo < value.periodFrom) {
      context.addIssue({
        code: 'custom',
        path: ['periodTo'],
        message: PROJECT_MESSAGES.periodFilterInvalid
      })
    }
  })
export type ProjectListFilter = z.infer<typeof ProjectListFilterSchema>

export const ProjectLinkChangeSchema = z.object({
  targetType: z.enum(PROJECT_LINK_TARGET_TYPES),
  targetId: z.number().int().positive(),
  projectId: z.number().int().positive().nullable()
})
export type ProjectLinkChange = z.infer<typeof ProjectLinkChangeSchema>

export const ProjectLinkHistoryQuerySchema = z.object({
  targetType: z.enum(PROJECT_LINK_TARGET_TYPES),
  targetId: z.number().int().positive()
})

export const ProjectSelectableQuerySchema = z.object({
  includeId: z.number().int().positive().optional()
})
