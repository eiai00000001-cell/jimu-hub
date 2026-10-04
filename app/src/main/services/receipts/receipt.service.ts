import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { RECEIPTS_DIR } from '@shared/constants/receipt'
import { RECEIPT_MESSAGES } from '@shared/messages/messages'
import type { PickReceiptsResult, ReceiptMimeType } from '@shared/types/receipt'
import { ReceiptValidationError, validateReceiptFile } from './receipt-file-validator'
import type { ReceiptStagingStore } from './receipt-staging-store'

/** 保存した領収書(`receipts`へINSERTする内容。`filePath`は`documents/`からの相対パス) */
export interface StoredReceiptFile {
  originalName: string
  filePath: string
  mimeType: ReceiptMimeType
  fileSize: number
  sha256: string
}

/**
 * 領収書の検証・コピー保存・SHA-256算出・保存失敗時のファイル削除を担う。
 * 保存先は`documents/receipts/<西暦年>/<UUID>.<拡張子>`で、利用者のファイル名はパスに使わない。
 * 参照元: 詳細設計書4.22章、5章(`ReceiptService`)
 */
export class ReceiptService {
  constructor(
    private readonly documentsDir: string,
    private readonly staging: ReceiptStagingStore
  ) {}

  /** 選択されたファイルを検証し、通ったものを識別子つきで登録する(他のファイルは追加できる) */
  pickAndStage(paths: string[]): PickReceiptsResult {
    const result: PickReceiptsResult = { files: [], errors: [] }
    for (const path of paths) {
      const fileName = basename(path)
      try {
        const buffer = readFileSync(path)
        validateReceiptFile(buffer, fileName)
        const token = this.staging.register({ path, fileName, fileSize: buffer.length })
        result.files.push({ token, fileName, fileSize: buffer.length })
      } catch (error) {
        result.errors.push({
          fileName,
          error:
            error instanceof ReceiptValidationError ? error.message : RECEIPT_MESSAGES.typeInvalid
        })
      }
    }
    return result
  }

  /**
   * 識別子のファイルを、保存の直前にもう一度読み込んで検証し、保存先へコピーする。
   * 1件でも失敗した場合は、書き込み済みのファイルを削除して例外を投げる。
   */
  storeFromTokens(tokens: string[]): StoredReceiptFile[] {
    const stored: StoredReceiptFile[] = []
    try {
      for (const token of tokens) {
        const staged = this.staging.get(token)
        if (!staged) throw new ReceiptValidationError(RECEIPT_MESSAGES.tokenInvalid)
        const buffer = readFileSync(staged.path)
        const { mimeType, extension } = validateReceiptFile(buffer, staged.fileName)
        const relative = `${RECEIPTS_DIR}/${new Date().getFullYear()}/${randomUUID()}.${extension}`
        const absolute = join(this.documentsDir, relative)
        mkdirSync(join(absolute, '..'), { recursive: true, mode: 0o700 })
        writeFileSync(absolute, buffer, { flag: 'wx' })
        stored.push({
          originalName: staged.fileName,
          filePath: relative,
          mimeType,
          fileSize: buffer.length,
          sha256: createHash('sha256').update(buffer).digest('hex')
        })
      }
      return stored
    } catch (error) {
      this.discard(stored)
      if (error instanceof ReceiptValidationError) throw error
      throw new ReceiptValidationError(RECEIPT_MESSAGES.storeFailure)
    }
  }

  /** 保存済みのファイルを削除する(記録の保存に失敗した場合の後始末) */
  discard(files: StoredReceiptFile[]): void {
    for (const file of files) {
      const absolute = join(this.documentsDir, file.filePath)
      if (existsSync(absolute) && statSync(absolute).isFile()) rmSync(absolute, { force: true })
    }
  }

  /** 保存が確定した識別子を破棄する */
  releaseTokens(tokens: string[]): void {
    this.staging.discard(tokens)
  }
}
