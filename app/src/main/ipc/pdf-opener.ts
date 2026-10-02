import { existsSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { shell } from 'electron'
import type { OpenPdfResult } from '@shared/ipc/api'
import { BACKUP_MESSAGES } from '@shared/messages/messages'

/**
 * 保存済みPDFを開く・Finderで表示する処理(見積書・請求書IPCハンドラ共通)。
 * `pdf_path`が保存先(documents)配下であり、ファイルが存在する場合のみOS側へ渡す
 * (復元ファイル等で改変された任意のパスを開かせないための多層防御。レビュー指摘I1-03)。
 */
export class PdfOpener {
  constructor(private readonly documentsDir: string) {}

  async open(pdfPath: string | null): Promise<OpenPdfResult> {
    const target = this.resolveTarget(pdfPath)
    if (!target) {
      return { success: false, error: BACKUP_MESSAGES.pdfNotFound }
    }
    const failure = await shell.openPath(target)
    return failure === ''
      ? { success: true }
      : { success: false, error: BACKUP_MESSAGES.pdfNotFound }
  }

  showInFolder(pdfPath: string | null): OpenPdfResult {
    const target = this.resolveTarget(pdfPath)
    if (!target) {
      return { success: false, error: BACKUP_MESSAGES.pdfNotFound }
    }
    shell.showItemInFolder(target)
    return { success: true }
  }

  private resolveTarget(pdfPath: string | null): string | null {
    if (!pdfPath) {
      return null
    }
    const target = resolve(pdfPath)
    const rel = relative(resolve(this.documentsDir), target)
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      return null
    }
    return existsSync(target) ? target : null
  }
}
