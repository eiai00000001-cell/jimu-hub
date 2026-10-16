import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useWorkDir } from '../../test-support/work-dir.mjs'
import { formatViolation, run } from './run.mjs'

// 検出対象の文字列は連結して組み立てる
const U = 'Us' + 'ers'
const getDir = useWorkDir('precommit-run', { beforeEach, afterEach })

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}
function setup() {
  const repo = join(getDir(), 'repo')
  mkdirSync(repo)
  git(repo, 'init', '-q')
  git(repo, 'config', 'user.name', 'tester')
  git(repo, 'config', 'user.email', 'tester' + '@example.com')
  return repo
}
function stage(repo, path, content) {
  const full = join(repo, path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
  git(repo, 'add', path)
}
function allowlistFile(content) {
  const p = join(getDir(), 'allowlist.json')
  writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content))
  return p
}
function exec(repo, allowlist = []) {
  const out = []
  const code = run({ cwd: repo, allowlistPath: allowlistFile(allowlist), out: (s) => out.push(s) })
  return { code, out }
}

describe('run(実際のGitリポジトリでの検査)', () => {
  it('違反がなければ終了コード0', () => {
    const repo = setup()
    stage(repo, 'a.md', '問題のない内容\n')
    expect(exec(repo).code).toBe(0)
  })

  it('個人の絶対パスを含む追加行は終了コード1で、場所とルールを表示する(値は伏せる)', () => {
    const repo = setup()
    stage(repo, 'docs/a.md', `ok\n/${U}/alice/Projects\n`)
    const { code, out } = exec(repo)
    expect(code).toBe(1)
    expect(out[0]).toContain('[pre-commit] personal-path docs/a.md:2')
    expect(out.join('\n')).not.toContain('alice')
    expect(out.at(-1)).toContain('allowlist.json')
  })

  it('メールアドレス・一時フォルダ・docs/へのZIPも検出する', () => {
    const repo = setup()
    stage(repo, 'a.md', 'x: bob' + '@mail-sample.jp\n/var' + '/folders/ab/T/x\n')
    stage(repo, 'docs/evidence.zip', 'dummy')
    const text = exec(repo).out.join('\n')
    expect(text).toContain('email a.md:1')
    expect(text).toContain('temp-path a.md:2')
    expect(text).toContain('docs-zip docs/evidence.zip ')
    expect(text).not.toContain('bob')
  })

  it('既存の内容や削除行には触れず、追加・変更された行だけを検査する', () => {
    const repo = setup()
    stage(repo, 'a.md', `/${U}/alice/x\n`)
    git(repo, 'commit', '-q', '-m', 'init', '--no-verify')
    // 既存行を残したまま別の行を追加する
    writeFileSync(join(repo, 'a.md'), `/${U}/alice/x\nclean\n`)
    git(repo, 'add', 'a.md')
    expect(exec(repo).code).toBe(0)
    // 該当行を削除しても違反にならない
    writeFileSync(join(repo, 'a.md'), 'clean\n')
    git(repo, 'add', 'a.md')
    expect(exec(repo).code).toBe(0)
  })

  it('許可リストに当てはまる検出は許可される', () => {
    const repo = setup()
    stage(repo, 'docs/a.md', `/${U}/alice/x\n`)
    const al = [{ id: 'A-1', rule: 'personal-path', pathGlob: 'docs/**', reason: 'テスト用' }]
    expect(exec(repo, al).code).toBe(0)
  })

  it('許可リストの形式不正(理由なし・JSON不正)は終了コード2', () => {
    const repo = setup()
    stage(repo, 'a.md', 'x\n')
    const noReason = [{ id: 'A-1', rule: 'email', pathGlob: '**' }]
    const r1 = exec(repo, noReason)
    expect(r1.code).toBe(2)
    expect(r1.out[0]).toContain('スクリプトの異常')
    expect(exec(repo, '{ not json').code).toBe(2)
  })

  it('ステージ済みの変更が無い場合は終了コード0', () => {
    expect(exec(setup()).code).toBe(0)
  })
})

describe('formatViolation', () => {
  it('表示する文字列は先頭60文字までにする', () => {
    const rule = { id: 'email', description: '説明' }
    const s = formatViolation({ rule, path: 'a', no: 3, shown: 'x'.repeat(100) })
    expect(s).toBe('[pre-commit] email a:3 説明: ' + 'x'.repeat(60))
  })
})
