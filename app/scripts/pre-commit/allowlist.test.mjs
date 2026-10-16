import { describe, expect, it } from 'vitest'
import { AllowlistError, isAllowed, loadAllowlist, parseAllowlist } from './allowlist.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const base = { id: 'A-1', rule: 'email', pathGlob: 'docs/**', reason: '公開情報のため' }

describe('parseAllowlist(形式の検証)', () => {
  it('正しい要素を受け付ける', () => {
    expect(parseAllowlist([base, { ...base, rule: '*', pattern: '^x' }])).toHaveLength(2)
  })
  it('配列以外・要素がオブジェクトでない場合は異常', () => {
    expect(() => parseAllowlist({})).toThrow(AllowlistError)
    expect(() => parseAllowlist(['x'])).toThrow(AllowlistError)
  })
  it('理由が無い・空白のみの場合は異常(理由のない例外を作れない)', () => {
    const noReason = { ...base }
    delete noReason.reason
    expect(() => parseAllowlist([noReason])).toThrow(AllowlistError)
    expect(() => parseAllowlist([{ ...base, reason: '' }])).toThrow(AllowlistError)
    expect(() => parseAllowlist([{ ...base, reason: '  ' }])).toThrow(AllowlistError)
  })
  it('未知のルール・パスが空・patternが不正な場合は異常', () => {
    expect(() => parseAllowlist([{ ...base, rule: 'unknown' }])).toThrow(AllowlistError)
    expect(() => parseAllowlist([{ ...base, pathGlob: '' }])).toThrow(AllowlistError)
    expect(() => parseAllowlist([{ ...base, pattern: '(' }])).toThrow(AllowlistError)
    expect(() => parseAllowlist([{ ...base, pattern: 1 }])).toThrow(AllowlistError)
  })
})

describe('isAllowed(照合)', () => {
  it('ルール・パス・パターンのすべてに当てはまる場合のみ許可する', () => {
    const al = parseAllowlist([{ ...base, pattern: '^ok@' }])
    expect(isAllowed(al, 'email', 'docs/a/b.md', 'ok@x.jp')).toBe(true)
    expect(isAllowed(al, 'email', 'docs/a/b.md', 'ng@x.jp')).toBe(false)
    expect(isAllowed(al, 'email', 'app/a.md', 'ok@x.jp')).toBe(false)
    expect(isAllowed(al, 'temp-path', 'docs/a.md', 'ok@x.jp')).toBe(false)
  })
  it('patternを省略した場合は文字列を問わない。ルール * は全ルール', () => {
    const al = parseAllowlist([{ ...base, rule: '*' }])
    expect(isAllowed(al, 'docs-zip', 'docs/x.zip', 'anything')).toBe(true)
  })
  it('globの * は区切りを越えず、** は越える', () => {
    const al = parseAllowlist([{ ...base, pathGlob: 'app/*.json' }])
    expect(isAllowed(al, 'email', 'app/package-lock.json', 't')).toBe(true)
    expect(isAllowed(al, 'email', 'app/sub/package-lock.json', 't')).toBe(false)
    expect(isAllowed(al, 'email', 'app/package-lockXjson', 't')).toBe(false)
  })
})

describe('同梱の allowlist.json', () => {
  it('形式が正しく、初期の2件(ロックファイルのemail・検査ルール自身の全ルール)を含む', () => {
    const al = loadAllowlist(join(dirname(fileURLToPath(import.meta.url)), 'allowlist.json'))
    expect(al).toHaveLength(2)
    expect(isAllowed(al, 'email', 'app/package-lock.json', 'x')).toBe(true)
    expect(isAllowed(al, 'personal-path', 'app/scripts/pre-commit/rules.test.mjs', 'x')).toBe(true)
    expect(isAllowed(al, 'personal-path', 'docs/a.md', 'x')).toBe(false)
  })
  it('存在しない・JSONでないファイルは異常', () => {
    expect(() => loadAllowlist('/nonexistent/allowlist.json')).toThrow(AllowlistError)
  })
})
