import { Database } from './db/db'
import { STARTUP_MESSAGES } from '@shared/messages/messages'
import type { StartupStatus } from '@shared/ipc/api'

export interface StartupResult {
  status: StartupStatus
  /** 初期化に成功した場合のみDatabaseインスタンスを返す。失敗時はnull(呼び出し元はclients:*・data:*のIPCハンドラを登録しない) */
  database: Database | null
}

/**
 * データベース接続の初期化・テーブル作成を行い、起動処理の結果を返す。
 *
 * `new Database(dbFilePath)`のコンストラクタ内(`db.ts`の`openConnection()`が同期的に呼ぶ`pragma()`等)で
 * 例外が発生するケース(データベースファイル破損・読み込み権限なし等)を含めて、この関数の中でtry/catchする。
 * 例外を外へ投げず、常に`StartupResult`を返すことで、呼び出し元(main/index.ts)が
 * データベース接続失敗時にもウィンドウ生成処理まで確実に到達できるようにする
 * (BUG-01修正: 従来は`new Database()`がtry/catchの外側にあり、例外発生時に
 * `app.whenReady().then()`のコールバック全体が中断し、ウィンドウが一度も表示されなかった)。
 *
 * 参照元: 詳細設計書4.1章手順1・2・5、8章(エラーハンドリング設計)
 */
export function initializeStartup(dbFilePath: string): StartupResult {
  try {
    const database = new Database(dbFilePath)
    database.initialize()
    return { status: { ok: true }, database }
  } catch (error) {
    console.error('データベース初期化に失敗しました', error)
    return { status: { ok: false, message: STARTUP_MESSAGES.databaseError }, database: null }
  }
}
