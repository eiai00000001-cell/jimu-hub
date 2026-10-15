// 残骸の確認(npm run check:work)。詳細設計書4.41。削除はしない。
// 残骸が無ければ終了コード0、あれば内容を表示して終了コード1。
import { reportLeftovers } from './work-dir.mjs'

const MB = 1024 * 1024
const fmt = (b) => `${(b / MB).toFixed(1)}MB`

const { work, tmp } = reportLeftovers()
let leftover = false
for (const [label, r] of [
  ['.e2e-work/ の中身', work],
  ['OS一時領域の jimuhub-*(削除はしません)', tmp]
]) {
  if (r.count === 0) continue
  leftover = true
  console.log(`${label}: ${r.count}件、${fmt(r.bytes)}(実使用量)`)
  for (const name of r.names) console.log(`  - ${name}`)
}
if (leftover) process.exit(1)
console.log('残骸はありません。')
