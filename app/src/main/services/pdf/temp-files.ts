import { mkdirSync, lstatSync, readdirSync, rmSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** PDF生成用の一時HTMLを置く専用フォルダ名(OSの一時フォルダ直下)。本アプリ以外のファイルは置かない */
export const PDF_TEMP_DIR_NAME = 'jimuhub-pdf-tmp'

const TEMP_FILE_PATTERN = /^render-[0-9a-f]{12}\.html$/

export function pdfTempDir(baseDir: string = tmpdir()): string {
  return join(baseDir, PDF_TEMP_DIR_NAME)
}

/** 専用フォルダを(利用者本人のみアクセス可で)作成し、新しい一時HTMLのパスを返す */
export function newPdfTempFilePath(baseDir: string = tmpdir()): string {
  const dir = pdfTempDir(baseDir)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return join(dir, `render-${randomBytes(6).toString('hex')}.html`)
}

/**
 * 異常終了などで残った一時HTMLを削除する(SEC-11)。
 * 削除対象は専用フォルダ直下の、本アプリの命名規則(`render-<12桁16進>.html`)に一致する通常ファイルのみ。
 * それ以外のファイル・フォルダ、および専用フォルダの外には一切触れない。
 * @returns 削除した件数
 */
export function cleanupLeftoverPdfTempFiles(baseDir: string = tmpdir()): number {
  const dir = pdfTempDir(baseDir)
  let removed = 0
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return 0
  }
  for (const name of names) {
    if (!TEMP_FILE_PATTERN.test(name)) {
      continue
    }
    const target = join(dir, name)
    try {
      if (lstatSync(target).isFile()) {
        rmSync(target, { force: true })
        removed++
      }
    } catch {
      // 削除できないファイルは無視する(起動を妨げない)
    }
  }
  return removed
}
