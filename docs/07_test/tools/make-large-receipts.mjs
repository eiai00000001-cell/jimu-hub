#!/usr/bin/env node
/**
 * 【tester作成】★F2(1GiB規模のメモリ実測)用の、架空の領収書ファイルを生成する補助ツール。
 *
 * 内容は乱数(圧縮されにくい)。先頭は「%PDF-」(領収書の形式検査を通すため)。1件ずつストリームで書き出す
 * (このツール自体も大きなメモリを使わない)。実データ・個人情報は含まない。
 *
 * 使い方: node make-large-receipts.mjs <出力先フォルダ> <件数> <1件のバイト数> [開始番号]
 *   出力: <出力先>/large_<番号>.pdf と、各ファイルのSHA-256の一覧 <出力先>/sha256.json(ファイル名→ハッシュ。追記される)
 * 出力先は、呼び出し側が .e2e-work/ 配下(例: .e2e-work/tools/ の作業フォルダ)を指定し、利用後に削除すること(詳細設計書4.41)。
 *   このツール自身は作業フォルダを作らない。
 * 領収書の上限は1件10MB(10,485,760バイト)・1記録5件。
 */
import { createHash, randomBytes } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { once } from 'node:events'

const [dirArg, countArg, bytesArg, startArg] = process.argv.slice(2)
if (!dirArg || !countArg || !bytesArg) {
  console.error('usage: make-large-receipts.mjs <out-dir> <count> <bytes-per-file> [start-index]')
  process.exit(2)
}
const dir = resolve(dirArg)
const count = Number(countArg)
const bytes = Number(bytesArg)
const start = Number(startArg ?? 0)
if (bytes > 10 * 1024 * 1024) throw new Error('1件は10MB以下にしてください')
mkdirSync(dir, { recursive: true })
const manifestPath = join(dir, 'sha256.json')
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {}
const CHUNK = 1024 * 1024

for (let i = 0; i < count; i += 1) {
  const name = `large_${String(start + i).padStart(3, '0')}.pdf`
  const hash = createHash('sha256')
  const out = createWriteStream(join(dir, name))
  const head = Buffer.from('%PDF-1.4\n')
  hash.update(head)
  out.write(head)
  let remaining = bytes - head.length
  while (remaining > 0) {
    const chunk = randomBytes(Math.min(CHUNK, remaining))
    hash.update(chunk)
    if (!out.write(chunk)) await once(out, 'drain')
    remaining -= chunk.length
  }
  out.end()
  await once(out, 'finish')
  manifest[name] = hash.digest('hex')
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 1))
console.log(`generated ${count} files (${bytes} bytes each) in ${dir}`)
