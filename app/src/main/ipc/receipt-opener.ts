import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { BrowserWindow, dialog, shell } from 'electron'
import type { OpenPdfResult } from '@shared/ipc/api'
import { RECEIPT_MESSAGES } from '@shared/messages/messages'
import { validateReceiptFile } from '../services/receipts/receipt-file-validator'
import { resolveReceiptPath } from '../services/receipts/receipt-path'

/** 警告を示して、続行するか(true)中止するか(false)を利用者に確認する */
export type ConfirmOpen = (message: string) => Promise<boolean>

const confirmWithDialog: ConfirmOpen = async (message) => {
  const options = {
    type: 'warning' as const,
    message,
    buttons: ['続行', '中止'],
    defaultId: 1,
    cancelId: 1
  }
  const focused = BrowserWindow.getFocusedWindow()
  const { response } = focused
    ? await dialog.showMessageBox(focused, options)
    : await dialog.showMessageBox(options)
  return response === 0
}

/**
 * 保存済みの領収書を開く・Finderで表示する。
 * ファイルが`documents/receipts/`配下で、拡張子が許可したもので、存在する場合のみOSへ渡す(SEC-10と同じ考え方)。
 * 開く前にSHA-256と中身(マジックナンバー)を照合し、改変が疑われる場合は警告の確認(続行/中止)を挟む。
 * 照合に通らなくても、利用者が続行を選べば開ける。
 * 参照元: 詳細設計書4.22章(`ReceiptOpener`)
 */
export class ReceiptOpener {
  constructor(
    private readonly documentsDir: string,
    private readonly confirmOpen: ConfirmOpen = confirmWithDialog
  ) {}

  async open(filePath: string | null, sha256: string | null): Promise<OpenPdfResult> {
    const target = filePath ? resolveReceiptPath(this.documentsDir, filePath) : null
    if (!target) return { success: false, error: RECEIPT_MESSAGES.notFound }
    if (!this.isIntact(target, sha256)) {
      // 中止は利用者の意思による正常な操作のため、エラーとしては扱わない
      if (!(await this.confirmOpen(RECEIPT_MESSAGES.openMismatchConfirm))) return { success: true }
    }
    const failure = await shell.openPath(target)
    return failure === '' ? { success: true } : { success: false, error: RECEIPT_MESSAGES.notFound }
  }

  showInFolder(filePath: string | null): OpenPdfResult {
    const target = filePath ? resolveReceiptPath(this.documentsDir, filePath) : null
    if (!target) return { success: false, error: RECEIPT_MESSAGES.notFound }
    shell.showItemInFolder(target)
    return { success: true }
  }

  private isIntact(absolutePath: string, sha256: string | null): boolean {
    try {
      const buffer = readFileSync(absolutePath)
      if (sha256 === null || createHash('sha256').update(buffer).digest('hex') !== sha256) {
        return false
      }
      validateReceiptFile(buffer, absolutePath)
      return true
    } catch {
      return false
    }
  }
}
