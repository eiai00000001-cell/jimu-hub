import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

/**
 * テスト結果報告書のエビデンス保存先(`docs/07_test/evidence/<name>`)への絶対パスを、
 * 実行環境のローカル絶対パスをソースコードに直書きせずに解決するためのヘルパー。
 */
export function evidenceDir(name: string): string {
  return join(__dirname, '..', '..', '..', 'docs', '07_test', 'evidence', name)
}
