import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { ReceiptPreviewResult } from '@shared/types/receipt'
import type { ReceiptRepository } from '../../repositories/receipt.repository'
import { validateReceiptFile } from './receipt-file-validator'
import { resolveReceiptPath } from './receipt-path'

/** 画像の生成(Electronの`nativeImage`)を差し替え可能にするためのインターフェース */
export interface ImageProcessor {
  /** 画像として読み込めない場合はnull。読み込めた場合は、幅を指定した縮小画像のdata URLを返す関数を持つ */
  load(buffer: Buffer): { thumbnailDataUrl(width: number): string } | null
}

const THUMBNAIL_WIDTH = 120

/**
 * 領収書のサムネイル・拡大表示用の画像(data URL)を生成する。
 * 保存先・拡張子・存在の確認とSHA-256の照合に通ったバッファのみから生成し、
 * 照合後にファイルを読み直さない。ファイルのパス・ハッシュ値は応答に含めない。
 * 参照元: 詳細設計書4.22章「領収書のアプリ内表示」(`ReceiptPreviewService`)
 */
export class ReceiptPreviewService {
  constructor(
    private readonly documentsDir: string,
    private readonly receipts: ReceiptRepository,
    private readonly images: ImageProcessor
  ) {}

  getThumbnail(id: number): ReceiptPreviewResult {
    return this.build(id, 'thumbnail')
  }

  getPreview(id: number): ReceiptPreviewResult {
    return this.build(id, 'preview')
  }

  private build(id: number, mode: 'thumbnail' | 'preview'): ReceiptPreviewResult {
    const receipt = this.receipts.findById(id)
    if (!receipt) return { success: false, state: 'missing' }
    const absolute = resolveReceiptPath(this.documentsDir, receipt.filePath)
    if (!absolute) return { success: false, state: 'missing' }

    let buffer: Buffer
    try {
      buffer = readFileSync(absolute)
    } catch {
      return { success: false, state: 'missing' }
    }
    if (createHash('sha256').update(buffer).digest('hex') !== receipt.sha256) {
      return { success: false, state: 'mismatch' }
    }

    let mimeType: 'application/pdf' | 'image/jpeg' | 'image/png'
    try {
      mimeType = validateReceiptFile(buffer, absolute).mimeType
    } catch {
      return { success: false, state: 'unreadable' }
    }
    if (mimeType === 'application/pdf') return { success: true, state: 'ok', kind: 'pdf' }

    const image = this.images.load(buffer)
    if (!image) return { success: false, state: 'unreadable' }
    const dataUrl =
      mode === 'thumbnail'
        ? image.thumbnailDataUrl(THUMBNAIL_WIDTH)
        : `data:${mimeType};base64,${buffer.toString('base64')}`
    return { success: true, state: 'ok', kind: 'image', mimeType, dataUrl }
  }
}
