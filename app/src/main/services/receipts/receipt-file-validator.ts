import { extname } from 'node:path'
import { RECEIPT_LIMITS } from '@shared/constants/receipt'
import { RECEIPT_MESSAGES } from '@shared/messages/messages'
import type { ReceiptMimeType } from '@shared/types/receipt'

/** 領収書の検証エラー(メッセージは画面にそのまま表示する) */
export class ReceiptValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReceiptValidationError'
  }
}

export interface ValidatedReceipt {
  mimeType: ReceiptMimeType
  extension: 'pdf' | 'jpg' | 'png'
}

const SIGNATURES: Array<{
  ext: ValidatedReceipt['extension']
  mime: ReceiptMimeType
  bytes: number[]
}> = [
  { ext: 'pdf', mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  { ext: 'jpg', mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { ext: 'png', mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }
]

/**
 * 領収書ファイルの検証(拡張子・容量・マジックナンバー)。選択時と保存直前の2回行う。
 * 参照元: 詳細設計書4.22章(`ReceiptFileValidator.validate`)
 */
export function validateReceiptFile(buffer: Buffer, fileName: string): ValidatedReceipt {
  const rawExt = extname(fileName).slice(1).toLowerCase()
  const normalized = rawExt === 'jpeg' ? 'jpg' : rawExt
  if (!(RECEIPT_LIMITS.allowedExtensions as readonly string[]).includes(rawExt)) {
    throw new ReceiptValidationError(RECEIPT_MESSAGES.typeInvalid)
  }
  if (buffer.length === 0) {
    throw new ReceiptValidationError(RECEIPT_MESSAGES.typeInvalid)
  }
  if (buffer.length > RECEIPT_LIMITS.maxFileBytes) {
    throw new ReceiptValidationError(RECEIPT_MESSAGES.tooLarge)
  }
  const detected = SIGNATURES.find((s) => s.bytes.every((b, i) => buffer[i] === b))
  if (!detected || detected.ext !== normalized) {
    throw new ReceiptValidationError(RECEIPT_MESSAGES.typeInvalid)
  }
  return { mimeType: detected.mime, extension: detected.ext }
}
