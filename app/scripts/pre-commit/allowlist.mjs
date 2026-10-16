// 許可リストの読み込み・検証・照合(詳細設計書 4.40)。理由のない例外は作れない。
import { readFileSync } from 'node:fs'
import { RULE_IDS } from './rules.mjs'

/** 許可リスト自体の異常(終了コード2) */
export class AllowlistError extends Error {}

function globToRegExp(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*'
        i += 1
      } else re += '[^/]*'
    } else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

/** 配列を検証して、照合用の形に変換する。ルールID `*` は全ルールを表す */
export function parseAllowlist(data) {
  if (!Array.isArray(data)) throw new AllowlistError('許可リストは配列で記述してください')
  return data.map((e, i) => {
    const where = `許可リストの${i + 1}件目`
    if (e === null || typeof e !== 'object')
      throw new AllowlistError(`${where}がオブジェクトではありません`)
    if (typeof e.reason !== 'string' || e.reason.trim() === '') {
      throw new AllowlistError(`${where}に理由(reason)がありません`)
    }
    if (typeof e.rule !== 'string' || (e.rule !== '*' && !RULE_IDS.includes(e.rule))) {
      throw new AllowlistError(`${where}のルール(rule)が不明です`)
    }
    if (typeof e.pathGlob !== 'string' || e.pathGlob.trim() === '') {
      throw new AllowlistError(`${where}の対象のパス(pathGlob)がありません`)
    }
    let pattern = null
    if (e.pattern !== undefined) {
      if (typeof e.pattern !== 'string')
        throw new AllowlistError(`${where}のpatternが文字列ではありません`)
      try {
        pattern = new RegExp(e.pattern)
      } catch {
        throw new AllowlistError(`${where}のpatternが正規表現として不正です`)
      }
    }
    return { rule: e.rule, pathRe: globToRegExp(e.pathGlob), pattern }
  })
}

export function loadAllowlist(filePath) {
  let data
  try {
    data = JSON.parse(readFileSync(filePath, 'utf8'))
  } catch (e) {
    throw new AllowlistError(`許可リストを読み込めません: ${e.message}`)
  }
  return parseAllowlist(data)
}

/** ルールID・パス・パターン(省略時は不問)のすべてに当てはまる検出のみ許可する */
export function isAllowed(entries, ruleId, path, text) {
  return entries.some(
    (e) =>
      (e.rule === '*' || e.rule === ruleId) &&
      e.pathRe.test(path) &&
      (e.pattern === null || e.pattern.test(text))
  )
}
