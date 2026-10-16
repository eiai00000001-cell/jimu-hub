// ステージ済みの差分の解析(詳細設計書 4.40)。
// Gitの `diff --cached --unified=0` の出力から、ファイルごとの「追加された行(行番号付き)」を取り出す。
import { execFileSync } from 'node:child_process'

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

function unquote(path) {
  if (!path.startsWith('"')) return path
  // core.quotepath 無効でも、特殊文字を含むパスは引用符付きで出力される
  return path
    .slice(1, -1)
    .replace(/\\(["\\])/g, '$1')
    .replace(/\\t/g, '\t')
}

function parseNewPath(rest) {
  const p = unquote(rest.replace(/\t.*$/, ''))
  if (p === '/dev/null') return null
  return p.startsWith('b/') ? p.slice(2) : p
}

/**
 * @param {string} text git diff の出力
 * @returns {{ path: string, lines: { no: number, text: string }[] }[]}
 */
export function parseStagedDiff(text) {
  const files = []
  let current = null
  let isBinary = false
  let newNo = 0
  let oldLeft = 0
  let newLeft = 0
  for (const raw of text.split('\n')) {
    if (oldLeft > 0 || newLeft > 0) {
      // ハンクの本体: 件数で数え、行の内容が +++ 等で始まっても誤認しない
      if (raw.startsWith('+')) {
        newLeft -= 1
        if (current && !isBinary) current.lines.push({ no: newNo, text: raw.slice(1) })
        newNo += 1
      } else if (raw.startsWith('-')) {
        oldLeft -= 1
      }
      continue
    }
    if (raw.startsWith('diff --git ')) {
      current = null
      isBinary = false
      continue
    }
    if (raw.startsWith('Binary files ') || raw.startsWith('GIT binary patch')) {
      isBinary = true
      continue
    }
    if (raw.startsWith('+++ ')) {
      const path = parseNewPath(raw.slice(4))
      current = path ? { path, lines: [] } : null
      if (current) files.push(current)
      continue
    }
    const m = HUNK.exec(raw)
    if (m) {
      oldLeft = m[2] === undefined ? 1 : Number(m[2])
      newLeft = m[4] === undefined ? 1 : Number(m[4])
      newNo = Number(m[3])
    }
  }
  return files.filter((f) => f.lines.length > 0)
}

const GIT_DIFF_ARGS = ['diff', '--cached', '--no-color', '--no-ext-diff', '--diff-filter=ACMR']

function git(cwd, args) {
  return execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024
  })
}

/** ステージ済みの追加・変更行を返す(バイナリ・削除行・変更のない行は含まない) */
export function getStagedAddedLines(cwd) {
  return parseStagedDiff(git(cwd, [...GIT_DIFF_ARGS, '--unified=0']))
}

/** ステージ済みで、追加・コピー・名称変更・変更されたファイルのパス */
export function getStagedPaths(cwd) {
  return git(cwd, [...GIT_DIFF_ARGS, '--name-only', '-z'])
    .split('\0')
    .filter(Boolean)
}
