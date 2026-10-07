import { BACKUP_MESSAGES } from '@shared/messages/messages'
import {
  BackupDiskShortError,
  BackupFileChangedError,
  BackupSizeLimitError,
  BackupVersionTooNewError
} from './errors'

/** 復元ファイルの確認・展開で起きたエラーを、利用者へ表示する文言へ変換する(詳細設計書8章) */
export function toRestoreErrorMessage(error: unknown): string {
  if (error instanceof BackupSizeLimitError) return BACKUP_MESSAGES.importTooLarge
  if (error instanceof BackupDiskShortError) return BACKUP_MESSAGES.importDiskShort
  if (error instanceof BackupVersionTooNewError) return BACKUP_MESSAGES.importVersionTooNew
  if (error instanceof BackupFileChangedError) return BACKUP_MESSAGES.importFileChanged
  return BACKUP_MESSAGES.importParseFailure
}
