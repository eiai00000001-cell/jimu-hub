import { CURRENT_SCHEMA_VERSION, type BackupFile } from '@shared/backup/backup-file'

/**
 * エクスポートデータのスキーマバージョン差異を吸収するApplication Service層。
 * 参照元: 詳細設計書 4.3章手順4、5章(クラス設計 `MigrationService`)
 *
 * 現時点ではスキーマバージョンは1のみ存在するため、変換処理は恒等関数(そのまま返す)である。
 * 将来バージョンが増えた際は、fromVersionに応じた変換をここに追加する(例: 1→2の項目追加等)。
 */
export class MigrationService {
  migrate(data: BackupFile, fromVersion: number): BackupFile {
    if (fromVersion === CURRENT_SCHEMA_VERSION) {
      return data
    }
    // 将来的にfromVersion < CURRENT_SCHEMA_VERSIONの変換ステップをここに追加する。
    return data
  }
}
