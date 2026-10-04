/** 領収書の上限値。参照元: 詳細設計書4.22章(`RECEIPT_LIMITS`) */
export const RECEIPT_LIMITS = {
  maxFileBytes: 10 * 1024 * 1024, // 10MB
  maxPerRecord: 5,
  allowedExtensions: ['pdf', 'jpg', 'jpeg', 'png']
} as const

/** 領収書の保存先(`documents/`からの相対)の先頭ディレクトリ */
export const RECEIPTS_DIR = 'receipts'
