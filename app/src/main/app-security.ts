import type { Session, WebContents } from 'electron'

/**
 * 開発時・E2Eテスト時にのみ有効とする環境変数を読み取る。
 * 配布版(パッケージ済み)では、環境変数を設定して起動されても値を無視し、
 * データ保存先・読み込む画面・ファイル入出力先が外部から差し替えられないようにする
 * (セキュリティチェック結果報告書 v0.0 SEC-01)。
 */
export function readDevOnlyEnv(
  name: string,
  isPackaged: boolean,
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  if (isPackaged) {
    return undefined
  }
  const value = env[name]
  return value ? value : undefined
}

/**
 * ウィンドウ内の画面遷移・新規ウィンドウ作成を制限する。
 * 本アプリは外部サイトへのリンクや画面遷移を持たないため、現在の画面以外への遷移と
 * 新規ウィンドウの作成はすべて拒否する(セキュリティチェック結果報告書 v0.0 SEC-02)。
 */
export function applyWindowSecurity(webContents: WebContents): void {
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  webContents.on('will-navigate', (event, url) => {
    if (url !== webContents.getURL()) {
      event.preventDefault()
    }
  })
}

/**
 * カメラ・マイク・通知・位置情報等の権限要求をすべて拒否する。
 * 本アプリはこれらの権限を必要としない(セキュリティチェック結果報告書 v0.0 SEC-02)。
 */
export function denyAllPermissionRequests(session: Session): void {
  session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
}
