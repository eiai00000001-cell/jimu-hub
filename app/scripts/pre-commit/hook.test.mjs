// フック(app/.husky/pre-commit)の動作確認。作業フォルダに一時のGitリポジトリを作り、実際にコミットを試す。
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useWorkDir } from '../../test-support/work-dir.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(here, '..', '..')
const repoRoot = resolve(appDir, '..')
const hasGitleaks = spawnSync('gitleaks', ['version']).status === 0

// 検出対象の文字列は連結して組み立てる(テストファイル自身が検出されないようにする)
const U = 'Us' + 'ers'
const FAKE_TOKEN = 'gh' + 'p_' + 'aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bD1fH3jL5'

const getDir = useWorkDir('precommit-hook', { beforeEach, afterEach })

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

/** フック・検査スクリプト・gitleaks設定を、実物のコピーで備えた一時リポジトリを作る */
function setupRepo() {
  const repo = join(getDir(), 'repo')
  mkdirSync(join(repo, 'app', 'scripts', 'pre-commit'), { recursive: true })
  mkdirSync(join(repo, 'app', '.husky'))
  git(repo, 'init', '-q')
  git(repo, 'config', 'user.name', 'tester')
  git(repo, 'config', 'user.email', 'tester' + '@example.com')
  git(repo, 'config', 'core.hooksPath', 'app/.husky')
  cpSync(join(repoRoot, '.gitleaks.toml'), join(repo, '.gitleaks.toml'))
  cpSync(join(appDir, '.husky', 'pre-commit'), join(repo, 'app', '.husky', 'pre-commit'))
  const src = join(here)
  for (const f of readdirSync(src)) {
    if (/\.test\.mjs$/.test(f)) continue
    cpSync(join(src, f), join(repo, 'app', 'scripts', 'pre-commit', f))
  }
  return repo
}

function tryCommit(repo, env = {}) {
  const r = spawnSync('git', ['commit', '-q', '-m', 'test commit'], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, ...env }
  })
  return { code: r.status, text: `${r.stdout}${r.stderr}` }
}

function stage(repo, path, content) {
  writeFileSync(join(repo, path), content)
  git(repo, 'add', path)
}

describe.skipIf(!hasGitleaks)('pre-commit フック(一時リポジトリでの実コミット)', () => {
  it('問題のない変更はコミットできる', () => {
    const repo = setupRepo()
    stage(repo, 'a.md', '問題のない内容\n')
    expect(tryCommit(repo).code).toBe(0)
  })

  it('秘密情報(アクセストークン)を含む変更は、値を表示せずコミットを止める', () => {
    const repo = setupRepo()
    stage(repo, 'conf.txt', `token=${FAKE_TOKEN}\n`)
    const r = tryCommit(repo)
    expect(r.code).not.toBe(0)
    expect(r.text).toContain('leaks found')
    expect(r.text).not.toContain(FAKE_TOKEN)
    // コミットが作られていない
    expect(spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: repo }).status).not.toBe(0)
  })

  it('個人の絶対パスを含む変更は、コミットを止める', () => {
    const repo = setupRepo()
    stage(repo, 'a.md', `/${U}/alice/Projects\n`)
    const r = tryCommit(repo)
    expect(r.code).toBe(1)
    expect(r.text).toContain('[pre-commit] personal-path a.md:1')
  })

  it('メールアドレスを含む変更・docs/へのZIPの追加は、コミットを止める', () => {
    const repo = setupRepo()
    stage(repo, 'a.md', 'bob' + '@mail-sample.jp\n')
    expect(tryCommit(repo).text).toContain('[pre-commit] email')
    git(repo, 'reset', '-q')
    mkdirSync(join(repo, 'docs'))
    stage(repo, 'docs/x.zip', 'dummy')
    expect(tryCommit(repo).text).toContain('[pre-commit] docs-zip')
  })

  it('コミットメッセージは検査の対象外(メッセージに検出対象を含んでもコミットできる)', () => {
    const repo = setupRepo()
    stage(repo, 'a.md', 'ok\n')
    const r = spawnSync(
      'git',
      ['commit', '-q', '-m', `msg /${U}/alice ${FAKE_TOKEN} bob` + '@mail-sample.jp'],
      { cwd: repo, encoding: 'utf8' }
    )
    expect(r.status).toBe(0)
  })
})

describe('pre-commit フック(gitleaks未導入)', () => {
  it('導入手順を案内し、終了コード1でコミットを止める', () => {
    const empty = join(getDir(), 'empty-path')
    mkdirSync(empty)
    const r = spawnSync('/bin/sh', [join(appDir, '.husky', 'pre-commit')], {
      cwd: getDir(),
      encoding: 'utf8',
      env: { PATH: empty }
    })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('gitleaksが見つかりません')
    expect(r.stderr).toContain('brew install gitleaks')
  })
})
