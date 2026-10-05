/** 領収書(Rendererへ返す形。ファイルのパス・ハッシュ値は含めない。詳細設計書4.22章) */
export type ReceiptMimeType = 'application/pdf' | 'image/jpeg' | 'image/png'

/** 照合結果: 一致(ok)・ハッシュ不一致(mismatch)・ファイル欠落/保存先不正(missing) */
export type ReceiptCheckState = 'ok' | 'mismatch' | 'missing'

export interface ReceiptView {
  id: number
  originalName: string
  mimeType: ReceiptMimeType
  fileSize: number
  /** 記録から外した領収書か(ファイルは残る。基本設計書8.1章★E13) */
  removed: boolean
  /** 詳細画面の表示時の照合結果(`records:get`のみ) */
  state: ReceiptCheckState
}

export interface PickedReceipt {
  token: string
  fileName: string
  fileSize: number
}

export interface PickReceiptsResult {
  files: PickedReceipt[]
  errors: Array<{ fileName: string; error: string }>
}

export type ReceiptPreviewResult =
  | {
      success: true
      state: 'ok'
      kind: 'image'
      mimeType: 'image/jpeg' | 'image/png'
      dataUrl: string
    }
  | { success: true; state: 'ok'; kind: 'pdf' }
  | { success: false; state: 'mismatch' | 'missing' | 'unreadable' }
