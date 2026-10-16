// 作業フォルダの掃除(npm run clean:work)。詳細設計書4.41。
// .e2e-work/ の中身のみを削除する。OS一時領域は対象外。
import { sweepWorkRoot } from './work-dir.mjs'

sweepWorkRoot()
console.log('.e2e-work/ の中身を削除しました。')
