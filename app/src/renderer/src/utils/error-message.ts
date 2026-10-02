const IPC_PREFIX = /^Error invoking remote method '[^']*':\s*/
const ERROR_CLASS_PREFIX = /^[A-Za-z]*Error:\s*/

/**
 * IPC経由で届いた例外から、利用者向けの文言だけを取り出す。
 * Electronは`Error invoking remote method '<channel>': <ClassName>: <message>`の形で例外を渡すため、
 * 技術的な接頭辞(チャンネル名・例外クラス名)を取り除く。取り出せない場合は`fallback`を返す。
 */
export function toErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) {
    return fallback
  }
  const message = error.message.replace(IPC_PREFIX, '').replace(ERROR_CLASS_PREFIX, '').trim()
  return message === '' ? fallback : message
}
