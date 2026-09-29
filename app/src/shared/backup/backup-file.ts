import { z } from 'zod'

/**
 * エクスポート/復元ファイル(JSON)の構造。
 * 参照元: 詳細設計書 4.2章(エクスポート)・4.3章(復元)
 */

export const CURRENT_SCHEMA_VERSION = 1

export const BackupClientRecordSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  // schemaVersion1のエクスポートファイル(furiganaを持たない)との後方互換のため、
  // 省略可能(未指定時はnull)とする(T-26でclientsにfurigana列を追加)
  furigana: z.string().nullable().optional(),
  honorific: z.string(),
  contactPerson: z.string().nullable(),
  postalCode: z.string().nullable(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  invoiceRegistrationNumber: z.string().nullable(),
  memo: z.string().nullable(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type BackupClientRecord = z.infer<typeof BackupClientRecordSchema>

export const BackupFileSchema = z.object({
  schemaVersion: z.number().int(),
  appVersion: z.string(),
  exportedAt: z.string(),
  data: z.object({
    clients: z.array(BackupClientRecordSchema)
  })
})
export type BackupFile = z.infer<typeof BackupFileSchema>
