#!/usr/bin/env node
/**
 * 【tester作成】pre-commit(秘密情報と独自ルールの検査。詳細設計書4.40章)の実機確認ツール。
 *
 * 目的: 実際のフック(app/.husky/pre-commit)・検査スクリプト・.gitleaks.tomlのコピーを備えた一時のGitリポジトリを
 *   作業フォルダ(.e2e-work/tools/)に作り、実際に`git commit`を試して、止まる・通るの結果を確認する。
 *   実リポジトリの履歴・設定(core.hooksPath等)・ステージには一切触れない(一時リポジトリの中だけで操作する)。
 *   検出対象の文字列(架空の秘密情報・個人パス・メールアドレス)は、すべて連結して組み立てる(このファイル自身が検出されないようにする)。
 * 使い方: node precommit-check.mjs [--scan <フォルダ>]
 *   引数なし: 判定表(全ケース)を実行し、結果を標準出力へ出す。1件でも期待と異なれば終了コード1。
 *   --scan <フォルダ>: フォルダ内のテキストファイルを、一時リポジトリへdocs/配下の追加として入れ、フックで検査する(証跡の走査用)。
 * 作業フォルダは終了時(失敗時も)に削除する(詳細設計書4.41)。
 */
import { execFileSync, spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createWorkDir, removeWorkDir } from '../../../app/test-support/work-dir.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..', '..')
const appDir = join(repoRoot, 'app')
const hookDir = join(appDir, 'scripts', 'pre-commit')

// ---- 架空の検出対象(連結して組み立てる) ----
const U = 'Us' + 'ers'
const H = 'ho' + 'me'
const MAIL = (local, domain) => local + '@' + domain
const GH_TOKEN = 'gh' + 'p_' + 'aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bD1fH3jL5'
const SLACK = 'xo' + 'xb-' + '1234567890' + '-' + '1234567890123' + '-' + 'aBcDeFgHiJkLmNoPqRsTuVwX'
const PEM_HEAD = '-----BEGIN ' + 'RSA PRIVATE ' + 'KEY-----'
const PEM_FOOT = '-----END ' + 'RSA PRIVATE ' + 'KEY-----'
const PEM_BODY = [
  'MIIEowIBAAKCAQEAu1SU1LfVLPHCozMxH2Mo4lgOEePzNm0tRgeLezV6ffAt0gun',
  'VTLw7onLRnrq0/IzW7yWR7QkrmBL7jTKEn5u+qKhbwKfBstIs+bMY2Zkp18gnTxK',
  'LxoS+tdh1QbS+3TQ0Bp8r1xgsqQY2T0xLfSG1oBzpT4VoIsaJbmZ0Pz8eTn4Xcgh'
].join('\n')

const log = []
const out = (s = '') => {
  log.push(s)
  console.log(s)
}

// 色付けの制御文字と、gitleaksの時刻つきの情報行(INF)は、記録から除く
const clean = (text) =>
  text
    .replace(/\u001b\[[0-9;]*m/g, '')
    .split('\n')
    .filter((l) => l.trim() !== '' && !/\bINF\b/.test(l))
    .join('\n')
    .replace(/^\d{1,2}:\d{2}[AP]M /gm, '')

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

function setupRepo(dir, name) {
  const repo = join(dir, name)
  mkdirSync(join(repo, 'app', 'scripts', 'pre-commit'), { recursive: true })
  mkdirSync(join(repo, 'app', '.husky'))
  git(repo, 'init', '-q')
  git(repo, 'config', 'user.name', 'tester')
  git(repo, 'config', 'user.email', MAIL('tester', 'example.com'))
  git(repo, 'config', 'core.hooksPath', 'app/.husky') // 一時リポジトリの設定のみ
  cpSync(join(repoRoot, '.gitleaks.toml'), join(repo, '.gitleaks.toml'))
  cpSync(join(appDir, '.husky', 'pre-commit'), join(repo, 'app', '.husky', 'pre-commit'))
  for (const f of readdirSync(hookDir)) {
    if (/\.test\.mjs$/.test(f)) continue
    cpSync(join(hookDir, f), join(repo, 'app', 'scripts', 'pre-commit', f))
  }
  return repo
}

function stage(repo, path, content) {
  const full = join(repo, path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
  git(repo, 'add', '-f', path)
}

function tryCommit(repo, env = {}) {
  const r = spawnSync('git', ['commit', '-q', '-m', 'test commit'], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, ...env }
  })
  return { code: r.status, text: `${r.stdout}${r.stderr}` }
}

function hasHead(repo) {
  return spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: repo }).status === 0
}

let failures = 0
function report(id, label, ok, detail = '') {
  if (!ok) failures += 1
  out(`${ok ? 'PASS' : 'FAIL'} ${id} ${label}${detail ? `\n       ${detail.replace(/\n/g, '\n       ')}` : ''}`)
}

/** ステージして1回コミットを試す。blocked期待ならコミットされないこと、通る期待ならコミットされることを確認する */
function expectCommit(dir, id, label, files, { blocked, expectText, forbidText, code }) {
  const repo = setupRepo(dir, id.toLowerCase().replace(/[^a-z0-9]+/g, '-'))
  for (const [p, c] of Object.entries(files)) stage(repo, p, c)
  const r = tryCommit(repo)
  const committed = hasHead(repo)
  let ok = blocked ? r.code !== 0 && !committed : r.code === 0 && committed
  if (ok && code !== undefined) ok = r.code === code
  if (ok && expectText) ok = r.text.includes(expectText)
  if (ok && forbidText) ok = !r.text.includes(forbidText)
  const shown = clean(r.text).split('\n').slice(0, 6).join('\n')
  report(id, label, ok, `終了コード=${r.code} コミット作成=${committed ? 'あり' : 'なし'}${shown ? '\n' + shown : ''}`)
}

function scanMode(dir, target) {
  const repo = setupRepo(dir, 'scan')
  let count = 0
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(txt|md|json|log|csv|sh|mjs|ts)$/i.test(name)) {
        const rel = join('docs', '07_test', 'evidence', relative(target, p))
        mkdirSync(dirname(join(repo, rel)), { recursive: true })
        cpSync(p, join(repo, rel))
        git(repo, 'add', '-f', rel)
        count += 1
      }
    }
  }
  walk(target)
  const r = tryCommit(repo)
  out(`走査したテキストファイル: ${count}件`)
  out(`フックの結果: 終了コード=${r.code}(0=検出0件)`)
  if (r.code !== 0) out(clean(r.text).split('\n').slice(0, 40).join('\n'))
  return r.code === 0 ? 0 : 1
}

const argv = process.argv.slice(2)
const dir = createWorkDir('tools', 'precommit-check')
try {
  if (!spawnSync('gitleaks', ['version']).stdout) throw new Error('gitleaksが見つかりません')
  const realBefore = {
    hooksPath: spawnSync('git', ['config', 'core.hooksPath'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim(),
    head: git(repoRoot, 'rev-parse', 'HEAD').trim(),
    staged: git(repoRoot, 'diff', '--cached', '--name-only').trim()
  }
  if (argv[0] === '--scan') {
    process.exitCode = scanMode(dir, resolve(argv[1]))
  } else {
    out(`gitleaks: ${spawnSync('gitleaks', ['version'], { encoding: 'utf8' }).stdout.trim()}`)
    out('一時リポジトリ(作業フォルダ .e2e-work/tools/ 配下)で、実際にコミットを試した結果')
    out('')
    // ---- A: 通るもの ----
    expectCommit(dir, 'A-01', '問題のない変更はコミットできる', { 'a.md': '問題のない内容\n' }, { blocked: false })
    expectCommit(dir, 'A-02', 'プレースホルダのパス・許可ドメインのメール・SSH接続先・拡張子付きの名前・一時フォルダの文言は通る', {
      'a.md': [
        `/${U}/<ユーザー名>/Projects`,
        `/${U}/$USER/Projects`,
        `/${H}/{user}/work`,
        `~/Projects`,
        MAIL('a', 'example.com'),
        MAIL('b', 'sub.example.com'),
        MAIL('c', 'EXAMPLE.COM'),
        MAIL('12345+name', 'users.noreply.github.com'),
        'git' + '@github.com:owner/repo.git',
        'icon' + '@2x.png',
        'pkg' + '@1.2.3',
        'OSの一時フォルダ(jimuhub-pdf-tmp)に作ります',
        '<userData>/tmp/ と 事務HUB/tmp/ の配下'
      ].join('\n') + '\n'
    }, { blocked: false })
    // ---- B: gitleaks ----
    expectCommit(dir, 'B-01', 'アクセストークン形式の秘密情報は止まり、値は表示されない', { 'conf.txt': `token=${GH_TOKEN}\n` }, { blocked: true, expectText: 'leaks found', forbidText: GH_TOKEN })
    expectCommit(dir, 'B-02', 'Slackトークン形式の秘密情報は止まる', { 'conf2.txt': `SLACK=${SLACK}\n` }, { blocked: true, expectText: 'leaks found', forbidText: SLACK })
    expectCommit(dir, 'B-03', '秘密鍵の形式は止まる', { 'key.pem': `${PEM_HEAD}\n${PEM_BODY}\n${PEM_FOOT}\n` }, { blocked: true, expectText: 'leaks found' })
    // ---- C: 個人の絶対パス ----
    for (const [i, [label, text]] of [
      ['macOSのホーム配下', `/${U}/alice/Projects/x`],
      ['行末(後ろに「/」がない)', `cd /${U}/alice`],
      ['引用符で囲まれたパス', `"/${U}/alice"`],
      ['括弧・セミコロンの直前', `(/${U}/alice);`],
      ['Linuxのホーム配下', `/${H}/bob/proj`],
      ['Windowsのユーザーフォルダ', `C:\\${U}\\carol\\Documents`],
      ['日本語のユーザー名', `/${U}/山田/Desktop`],
      ['file:// の形', `file:///${U}/alice/x.pdf`]
    ].entries()) {
      expectCommit(dir, `C-0${i + 1}`, `個人の絶対パスは止まる: ${label}`, { 'a.md': text + '\n' }, { blocked: true, code: 1, expectText: '[pre-commit] personal-path a.md:1' })
    }
    expectCommit(dir, 'C-09', '表示の伏せ字: ユーザー名は先頭1文字のみ表示される', { 'a.md': `/${U}/alice/x\n` }, { blocked: true, expectText: `/${U}/a***`, forbidText: 'alice' })
    // ---- D: 一時フォルダ ----
    for (const [i, [label, text]] of [
      ['/var/folders', '/va' + 'r/folders/ab/cdefgh/T/x.png'],
      ['/private/var/folders', '/private/va' + 'r/folders/ab/cdefgh/T/'],
      ['/private/tmp', '/private/t' + 'mp/work/x'],
      ['ルート直下のtmp(行頭)', '/t' + 'mp/work/x'],
      ['ルート直下のtmp(=の直後)', 'DIR=/t' + 'mp/work/x'],
      ['ルート直下のtmp(引用符の直後)', 'cd "/t' + 'mp/work"']
    ].entries()) {
      expectCommit(dir, `D-0${i + 1}`, `一時フォルダのパスは止まる: ${label}`, { 'a.md': text + '\n' }, { blocked: true, code: 1, expectText: '[pre-commit] temp-path a.md:1' })
    }
    // ---- E: メールアドレス ----
    for (const [i, [label, text]] of [
      ['一般のドメイン', MAIL('bob', 'mail-sample.jp')],
      ['example.comに似た別ドメイン(example.com.xxx)', MAIL('bob', 'example.com.sample.jp')],
      ['example.comで終わる別ドメイン(notexample.com)', MAIL('bob', 'notexample.com')],
      ['大文字小文字を含む一般のドメイン', MAIL('Bob.Smith', 'Mail-Sample.Co.JP')]
    ].entries()) {
      expectCommit(dir, `E-0${i + 1}`, `許可外のメールアドレスは止まる: ${label}`, { 'a.md': text + '\n' }, { blocked: true, code: 1, expectText: '[pre-commit] email a.md:1' })
    }
    expectCommit(dir, 'E-05', '表示の伏せ字: メールアドレスはローカル部の先頭1文字のみ表示される', { 'a.md': MAIL('bob', 'mail-sample.jp') + '\n' }, { blocked: true, expectText: '@mail-sample.jp', forbidText: 'bob@' })
    // ---- F: docs/ のZIP ----
    expectCommit(dir, 'F-01', 'docs/ へのZIPの追加は止まる', { 'docs/backup.zip': 'dummy' }, { blocked: true, code: 1, expectText: '[pre-commit] docs-zip docs/backup.zip' })
    expectCommit(dir, 'F-02', '大文字の拡張子・深い階層でも止まる', { 'docs/a/b/EVIDENCE.ZIP': 'dummy' }, { blocked: true, code: 1, expectText: '[pre-commit] docs-zip' })
    expectCommit(dir, 'F-03', 'docs/ 以外のZIP・docs/ の他のファイルは通る', { 'other/backup.zip': 'dummy', 'docs/readme.md': 'ok\n' }, { blocked: false })
    // ---- G: 差分の扱い ----
    {
      const repo = setupRepo(dir, 'g-01')
      // 過去の履歴に違反を含む行を、検査を迂回せずに作る(一時リポジトリ内でのみ --no-verify を使う)
      stage(repo, 'old.md', `/${U}/alice/old\n行2\n`)
      spawnSync('git', ['commit', '-q', '--no-verify', '-m', 'seed'], { cwd: repo })
      writeFileSync(join(repo, 'old.md'), `/${U}/alice/old\n行2を変更\n`)
      git(repo, 'add', 'old.md')
      const r = tryCommit(repo)
      report('G-01', '追加・変更した行だけを検査し、過去の履歴や変更していない行は対象外', r.code === 0, `終了コード=${r.code}`)
      writeFileSync(join(repo, 'old.md'), `/${U}/alice/old\n行2を変更\n/${U}/alice/new\n`)
      git(repo, 'add', 'old.md')
      const r2 = tryCommit(repo)
      report('G-02', '新たに追加した違反の行は止まり、行番号が正しい', r2.code === 1 && r2.text.includes('old.md:3'), `終了コード=${r2.code}\n${clean(r2.text).split('\n')[0]}`)
    }
    {
      const repo = setupRepo(dir, 'g-03')
      const bin = Buffer.concat([Buffer.from([0, 1, 2, 0]), Buffer.from(`/${U}/alice/`), Buffer.from([0, 0, 0])])
      writeFileSync(join(repo, 'data.bin'), bin)
      git(repo, 'add', 'data.bin')
      const r = tryCommit(repo)
      report('G-03', 'バイナリファイルは検査の対象外', r.code === 0, `終了コード=${r.code}`)
    }
    {
      const repo = setupRepo(dir, 'g-04')
      stage(repo, 'a.md', 'ok\n')
      const r = spawnSync('git', ['commit', '-q', '-m', `msg /${U}/alice ${GH_TOKEN} ${MAIL('bob', 'mail-sample.jp')}`], { cwd: repo, encoding: 'utf8' })
      report('G-04', 'コミットメッセージは検査の対象外', r.status === 0, `終了コード=${r.status}`)
    }
    // ---- H: 許可リスト ----
    const allowCase = (id, label, content, expectCode, expectText) => {
      const repo = setupRepo(dir, id.toLowerCase())
      writeFileSync(join(repo, 'app', 'scripts', 'pre-commit', 'allowlist.json'), JSON.stringify(content))
      stage(repo, 'a.md', 'ok\n')
      // フック単体の終了コード(gitはフックの失敗をすべてコミット失敗として扱うため、フックを直接実行して確認する)
      const h = spawnSync('/bin/sh', ['app/.husky/pre-commit'], { cwd: repo, encoding: 'utf8' })
      const r = tryCommit(repo)
      const ok = h.status === expectCode && r.code !== 0 && !hasHead(repo) && (!expectText || `${h.stdout}${h.stderr}`.includes(expectText))
      report(id, label, ok, `フックの終了コード=${h.status} コミット=${hasHead(repo) ? 'あり' : 'なし'}\n${clean(`${h.stdout}${h.stderr}`).split('\n').slice(0, 3).join('\n')}`)
    }
    allowCase('H-01', '許可リストの理由(reason)が空の場合はスクリプトの異常として終了コード2で止まる', [{ id: 'X-1', rule: 'email', pathGlob: 'a.md', reason: '' }], 2, 'スクリプトの異常')
    allowCase('H-02', '許可リストの rule が未知の値の場合は終了コード2', [{ id: 'X-2', rule: 'unknown-rule', pathGlob: 'a.md', reason: '理由' }], 2, 'スクリプトの異常')
    allowCase('H-03', '許可リストの pathGlob が空の場合は終了コード2', [{ id: 'X-3', rule: 'email', pathGlob: '', reason: '理由' }], 2, 'スクリプトの異常')
    allowCase('H-04', '許可リストがJSONとして不正な場合は終了コード2', 'not-an-array', 2, 'スクリプトの異常')
    {
      const repo = setupRepo(dir, 'h-05')
      writeFileSync(join(repo, 'app', 'scripts', 'pre-commit', 'allowlist.json'), JSON.stringify([{ id: 'X-5', rule: 'email', pathGlob: 'allowed/**', reason: '架空の例外(確認用)' }]))
      stage(repo, 'allowed/a.md', MAIL('bob', 'mail-sample.jp') + '\n')
      const r = tryCommit(repo)
      report('H-05', '理由つきの許可リストに該当する検出は通る', r.code === 0, `終了コード=${r.code}`)
      stage(repo, 'other/b.md', MAIL('bob', 'mail-sample.jp') + '\n')
      const r2 = tryCommit(repo)
      report('H-06', '許可リストのパスに該当しない検出は引き続き止まる', r2.code === 1 && r2.text.includes('other/b.md:1'), `終了コード=${r2.code}`)
    }
    // ---- I: gitleaks 未導入 ----
    {
      const empty = join(dir, 'empty-path')
      mkdirSync(empty)
      const r = spawnSync('/bin/sh', [join(appDir, '.husky', 'pre-commit')], { cwd: dir, encoding: 'utf8', env: { PATH: empty } })
      report('I-01', 'gitleaksが無い環境では、導入手順を案内して終了コード1で止まる', r.status === 1 && r.stderr.includes('gitleaksが見つかりません') && r.stderr.includes('brew install gitleaks'), `終了コード=${r.status}\n${clean(r.stderr)}`)
    }
    // ---- J: 実リポジトリへの非影響 ----
    const realAfter = {
      hooksPath: spawnSync('git', ['config', 'core.hooksPath'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim(),
      head: git(repoRoot, 'rev-parse', 'HEAD').trim(),
      staged: git(repoRoot, 'diff', '--cached', '--name-only').trim()
    }
    report('J-01', '実リポジトリの core.hooksPath・HEAD・ステージは確認の前後で変わらない', JSON.stringify(realBefore) === JSON.stringify(realAfter), `core.hooksPath=${realAfter.hooksPath} HEAD=${realAfter.head.slice(0, 7)} ステージ済み=${realAfter.staged ? realAfter.staged.split('\n').length + '件' : 'なし'}`)
    out('')
    out(failures === 0 ? '結果: すべて期待どおり' : `結果: ${failures}件が期待と異なる`)
    process.exitCode = failures === 0 ? 0 : 1
  }
} finally {
  removeWorkDir(dir)
}
void existsSync
void readFileSync
