// pre-commit 独自ルール検査の入口(詳細設計書 4.40)。
// 終了コード: 0=違反なし、1=違反あり、2=スクリプト自体の異常(許可リストの形式不正等)
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AllowlistError, isAllowed, loadAllowlist } from './allowlist.mjs'
import { RULES } from './rules.mjs'
import { getStagedAddedLines, getStagedPaths } from './staged-diff.mjs'

const DEFAULT_ALLOWLIST = join(dirname(fileURLToPath(import.meta.url)), 'allowlist.json')
const MAX_SHOWN = 60

/** 差分(ファイルごとの追加行)とパス一覧を検査し、許可リストで除外した違反を返す */
export function findViolations({ files, paths, allowlist }) {
  const violations = []
  for (const file of files) {
    for (const line of file.lines) {
      for (const rule of RULES) {
        if (!rule.findInLine) continue
        for (const hit of rule.findInLine(line.text)) {
          if (isAllowed(allowlist, rule.id, file.path, hit.text)) continue
          violations.push({ rule, path: file.path, no: line.no, shown: hit.shown })
        }
      }
    }
  }
  for (const path of paths) {
    for (const rule of RULES) {
      if (!rule.findInFile) continue
      for (const hit of rule.findInFile(path)) {
        if (isAllowed(allowlist, rule.id, path, hit.text)) continue
        violations.push({ rule, path, no: null, shown: hit.shown })
      }
    }
  }
  return violations
}

export function formatViolation(v) {
  const where = v.no === null ? v.path : `${v.path}:${v.no}`
  return `[pre-commit] ${v.rule.id} ${where} ${v.rule.description}: ${v.shown.slice(0, MAX_SHOWN)}`
}

/** @returns {number} 終了コード */
export function run({ cwd, allowlistPath = DEFAULT_ALLOWLIST, out = (s) => console.log(s) } = {}) {
  let violations
  try {
    const allowlist = loadAllowlist(allowlistPath)
    violations = findViolations({
      files: getStagedAddedLines(cwd),
      paths: getStagedPaths(cwd),
      allowlist
    })
  } catch (e) {
    out(`[pre-commit] スクリプトの異常: ${e instanceof AllowlistError ? e.message : String(e)}`)
    return 2
  }
  if (violations.length === 0) return 0
  for (const v of violations) out(formatViolation(v))
  out(
    '例外にする場合は許可リスト(app/scripts/pre-commit/allowlist.json)へ理由を付けて追記してください'
  )
  return 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  process.exit(run({ cwd: root }))
}
