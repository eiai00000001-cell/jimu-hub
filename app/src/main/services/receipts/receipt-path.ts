import { existsSync } from 'node:fs'
import { extname, isAbsolute, relative, resolve } from 'node:path'
import { RECEIPT_LIMITS, RECEIPTS_DIR } from '@shared/constants/receipt'

/**
 * `receipts.file_path`(`documents/`からの相対)を絶対パスへ解決し、安全であれば返す。
 * 解決後のパスが`documents/receipts/`配下であること、拡張子が許可したもの、ファイルが存在することを確認する。
 * 満たさない場合はnull(SEC-10と同じ多層防御。領収書を開く・照合・プレビューで共通に使う)。
 * 参照元: 詳細設計書4.22章(`resolveReceiptPath`)
 */
export function resolveReceiptPath(documentsDir: string, filePath: string): string | null {
  if (!filePath) return null
  const target = resolve(documentsDir, filePath)
  const rel = relative(resolve(documentsDir, RECEIPTS_DIR), target)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null
  const ext = extname(target).slice(1).toLowerCase()
  if (!(RECEIPT_LIMITS.allowedExtensions as readonly string[]).includes(ext)) return null
  return existsSync(target) ? target : null
}
