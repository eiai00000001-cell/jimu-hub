import { z } from 'zod'

/**
 * エクスポート/復元ファイル(JSON)の構造。
 * 参照元: 詳細設計書 4.2章(エクスポート)・4.3章(復元)
 */

/**
 * エクスポートファイルの最新スキーマバージョン(DBのschema_versionと同一の値)。
 * 1: 取引先のみ / 2: フリガナ・自社情報・見積書・請求書を追加 / 3: pdfHashMismatchを追加(ZIP形式) /
 * 4: 勘定科目・入出金経費の記録・領収書・履歴を追加(領収書ファイルはZIPの`documents/receipts/`に同梱)
 */
export const CURRENT_SCHEMA_VERSION = 4

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

/**
 * 取引先以外のテーブル行(自社情報・見積書・請求書・各明細行)。列は`backup-tables.ts`の定義で検証・変換する。
 * schemaVersion1(取引先のみ)のファイルには存在しないため、いずれも省略可能(省略時は空/なし)。
 */
export const BackupRowSchema = z.record(z.string(), z.unknown())
export type BackupRow = z.infer<typeof BackupRowSchema>

export const BackupFileSchema = z.object({
  schemaVersion: z.number().int(),
  appVersion: z.string(),
  exportedAt: z.string(),
  data: z.object({
    clients: z.array(BackupClientRecordSchema),
    companyProfile: BackupRowSchema.nullable().default(null),
    quotes: z.array(BackupRowSchema).default([]),
    quoteLineItems: z.array(BackupRowSchema).default([]),
    invoices: z.array(BackupRowSchema).default([]),
    invoiceLineItems: z.array(BackupRowSchema).default([]),
    accounts: z.array(BackupRowSchema).default([]),
    cashRecords: z.array(BackupRowSchema).default([]),
    receipts: z.array(BackupRowSchema).default([]),
    cashRecordHistory: z.array(BackupRowSchema).default([])
  })
})
/** 検証・正規化後のバックアップ構造(省略可能なテーブルは既定値で補われている) */
export type BackupFile = z.output<typeof BackupFileSchema>
