import { shell } from 'electron'
import type { OpenPdfResult } from '@shared/ipc/api'
import { RECEIPT_MESSAGES } from '@shared/messages/messages'
import { resolveReceiptPath } from '../services/receipts/receipt-path'

/**
 * 保存済みの領収書を開く・Finderで表示する。
 * ファイルが`documents/receipts/`配下で、拡張子が許可したもので、存在する場合のみOSへ渡す(SEC-10と同じ考え方)。
 * 参照元: 詳細設計書4.22章(`ReceiptOpener`)
 */
export class ReceiptOpener {
  constructor(private readonly documentsDir: string) {}

  async open(filePath: string | null): Promise<OpenPdfResult> {
    const target = filePath ? resolveReceiptPath(this.documentsDir, filePath) : null
    if (!target) return { success: false, error: RECEIPT_MESSAGES.notFound }
    const failure = await shell.openPath(target)
    return failure === '' ? { success: true } : { success: false, error: RECEIPT_MESSAGES.notFound }
  }

  showInFolder(filePath: string | null): OpenPdfResult {
    const target = filePath ? resolveReceiptPath(this.documentsDir, filePath) : null
    if (!target) return { success: false, error: RECEIPT_MESSAGES.notFound }
    shell.showItemInFolder(target)
    return { success: true }
  }
}
