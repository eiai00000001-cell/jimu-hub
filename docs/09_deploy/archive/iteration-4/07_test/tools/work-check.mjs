#!/usr/bin/env node
/**
 * 【tester作成】テスト作業フォルダと後片付け(詳細設計書4.41章。`npm run check:work`・`npm run clean:work`)の実機確認ツール。
 *
 * 方法: 実物の`app/test-support/`(work-dir.mjs・check-work.mjs・clean-work.mjs)のコピーを、作業フォルダ(.e2e-work/tools/)に作った
 *   一時のGitリポジトリへ置き、実際に`node check-work.mjs`・`node clean-work.mjs`を実行する(実リポジトリの`.e2e-work/`は削除対象にしない)。
 *   一時リポジトリは終了時(失敗時も)にremoveWorkDirで削除する。
 * 使い方: node work-check.mjs  (1件でも期待と異なれば終了コード1)
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createWorkDir, removeWorkDir } from '../../../app/test-support/work-dir.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const support = resolve(here, '..', '..', '..', 'app', 'test-support')
const log = []
const out = (s = '') => {
  log.push(s)
  console.log(s)
}
let failures = 0
const report = (id, label, ok, detail = '') => {
  if (!ok) failures += 1
  out(`${ok ? 'PASS' : 'FAIL'} ${id} ${label}${detail ? `\n       ${detail.replace(/\n/g, '\n       ')}` : ''}`)
}

const base = createWorkDir('tools', 'work-check')
try {
  const fake = join(base, 'fake-repo')
  mkdirSync(join(fake, 'app', 'test-support'), { recursive: true })
  spawnSync('git', ['init', '-q'], { cwd: fake })
  for (const f of ['work-dir.mjs', 'check-work.mjs', 'clean-work.mjs']) {
    cpSync(join(support, f), join(fake, 'app', 'test-support', f))
  }
  const fakeTmp = join(base, 'fake-os-tmp')
  mkdirSync(fakeTmp)
  const run = (script, env = {}) => {
    const r = spawnSync('node', [join(fake, 'app', 'test-support', script)], {
      cwd: fake,
      encoding: 'utf8',
      env: { ...process.env, TMPDIR: fakeTmp, ...env }
    })
    return { code: r.status, text: `${r.stdout}${r.stderr}`.trim() }
  }
  const root = join(fake, '.e2e-work')
  const rel = (t) => t.split(fake).join('<repo>')

  // K-01: .e2e-work/ が無い
  let r = run('check-work.mjs')
  report('K-01', '.e2e-work/ が無い場合は「残骸はありません」で終了コード0', r.code === 0 && r.text.includes('残骸はありません'), `終了コード=${r.code}\n${rel(r.text)}`)
  // K-02: 空の種別フォルダのみ
  for (const k of ['e2e', 'unit', 'tools']) mkdirSync(join(root, k), { recursive: true })
  r = run('check-work.mjs')
  report('K-02', '空の種別フォルダ(e2e・unit・tools)のみなら残骸なし(終了コード0)', r.code === 0, `終了コード=${r.code}`)
  // K-03: 作業フォルダが残っている
  mkdirSync(join(root, 'e2e', 'jimuhub-e2e-sample'))
  writeFileSync(join(root, 'e2e', 'jimuhub-e2e-sample', 'data.bin'), Buffer.alloc(300_000, 1))
  mkdirSync(join(root, 'unit', 'precommit-hook-sample'))
  r = run('check-work.mjs')
  report('K-03', '種別の中に作業フォルダが残っていれば、件数・サイズ・名前を表示して終了コード1', r.code === 1 && r.text.includes('2件') && r.text.includes('e2e/jimuhub-e2e-sample') && r.text.includes('unit/precommit-hook-sample'), `終了コード=${r.code}\n${rel(r.text)}`)
  // K-04: 種別外のフォルダ
  mkdirSync(join(root, 'screens'))
  writeFileSync(join(root, 'screens', 'a.png'), 'x')
  writeFileSync(join(root, 'memo.txt'), 'x')
  r = run('check-work.mjs')
  report('K-04', '.e2e-work/ 直下の種別外のフォルダ・ファイル(screens・memo.txt)も残骸として報告する', r.code === 1 && r.text.includes('screens') && r.text.includes('memo.txt'), `終了コード=${r.code}\n${rel(r.text)}`)
  // K-05: OS一時領域(jimuhub-*)は表示のみ。jimuhub-pdf-tmp・jimuhub-pdf-tools・jimuhub-evidence-runは除外
  mkdirSync(join(fakeTmp, 'jimuhub-leftover'))
  mkdirSync(join(fakeTmp, 'jimuhub-pdf-tmp'))
  mkdirSync(join(fakeTmp, 'jimuhub-pdf-tools'))
  mkdirSync(join(fakeTmp, 'jimuhub-evidence-run'))
  mkdirSync(join(fakeTmp, 'other-folder'))
  r = run('check-work.mjs')
  report('K-05', 'OS一時領域の jimuhub-* は名前を表示するのみ(除外: pdf-tmp・pdf-tools・evidence-run、他の名前は対象外)で、削除はしない', r.code === 1 && r.text.includes('jimuhub-leftover') && !r.text.includes('jimuhub-pdf-tmp') && !r.text.includes('jimuhub-pdf-tools') && !r.text.includes('jimuhub-evidence-run') && !r.text.includes('other-folder') && existsSync(join(fakeTmp, 'jimuhub-leftover')), `終了コード=${r.code}\n${rel(r.text)}`)
  // K-06: clean:work は .e2e-work/ の中身(種別外を含む)のみ削除し、その外側・OS一時領域は削除しない
  writeFileSync(join(fake, 'keep-outside.txt'), 'keep')
  r = run('clean-work.mjs')
  const emptied = existsSync(root) && !existsSync(join(root, 'screens')) && !existsSync(join(root, 'memo.txt')) && !existsSync(join(root, 'e2e', 'jimuhub-e2e-sample')) && !existsSync(join(root, 'unit', 'precommit-hook-sample'))
  report('K-06', 'clean:work は .e2e-work/ の中身(種別外を含む)を削除し、外側のファイルとOS一時領域は削除しない', r.code === 0 && emptied && existsSync(join(fake, 'keep-outside.txt')) && existsSync(join(fakeTmp, 'jimuhub-leftover')), `終了コード=${r.code}\n${rel(r.text)}`)
  {
    // OS一時領域の残骸だけが残っている状態では、check:work は終了コード1のまま(自動では削除しない)
    r = run('check-work.mjs')
    report('K-07', '.e2e-work/ を空にしても、OS一時領域の残骸が残っていれば終了コード1(残骸の削除は人が判断する)', r.code === 1 && !r.text.includes('.e2e-work/ の中身') && r.text.includes('jimuhub-leftover'), `終了コード=${r.code}\n${rel(r.text)}`)
  }
  // K-08: 作業ルートがシンボリックリンクの場合は削除しない
  const outside = join(base, 'outside-target')
  mkdirSync(outside)
  writeFileSync(join(outside, 'sentinel.txt'), 'keep')
  mkdirSync(join(fake, 'second'))
  const fake2 = join(base, 'fake-repo2')
  mkdirSync(join(fake2, 'app', 'test-support'), { recursive: true })
  spawnSync('git', ['init', '-q'], { cwd: fake2 })
  for (const f of ['work-dir.mjs', 'check-work.mjs', 'clean-work.mjs']) cpSync(join(support, f), join(fake2, 'app', 'test-support', f))
  symlinkSync(outside, join(fake2, '.e2e-work'))
  const r8 = spawnSync('node', [join(fake2, 'app', 'test-support', 'clean-work.mjs')], { cwd: fake2, encoding: 'utf8' })
  report('K-08', '.e2e-work が通常のフォルダでない(シンボリックリンク)場合は、何も削除せず異常終了する', r8.status !== 0 && existsSync(join(outside, 'sentinel.txt')), `終了コード=${r8.status}\n${(r8.stderr || '').split('\n').filter((l) => /^Error/.test(l)).join('\n').split(base).join('<work>')}`)
  // K-09: removeWorkDir は .e2e-work の外側を削除しない(実物のヘルパー)
  // 実物のヘルパーの作業ルート(リポジトリ直下の .e2e-work/)の外側に、空のフォルダを1つ作って指定する(空のため、誤って削除されても影響はない)
  const stray = mkdtempSync(join(tmpdir(), 'wc-outside-'))
  let threw = false
  try {
    removeWorkDir(stray)
  } catch {
    threw = true
  }
  const kept = existsSync(stray)
  rmSync(stray, { recursive: true, force: true }) // このツール自身が作った空フォルダの後始末
  report('K-09', 'removeWorkDir は .e2e-work/ の外側を指定されると、削除せずに例外を投げる', threw && kept, `例外=${threw ? 'あり' : 'なし'} 対象は残存=${kept}`)
  // K-10: 作業ルートの親に .git が無い場合は作成・掃除を拒否
  const noGit = join(base, 'no-git')
  mkdirSync(join(noGit, 'app', 'test-support'), { recursive: true })
  for (const f of ['work-dir.mjs', 'check-work.mjs', 'clean-work.mjs']) cpSync(join(support, f), join(noGit, 'app', 'test-support', f))
  mkdirSync(join(noGit, '.e2e-work', 'e2e', 'x'), { recursive: true })
  const r10 = spawnSync('node', [join(noGit, 'app', 'test-support', 'clean-work.mjs')], { cwd: noGit, encoding: 'utf8' })
  report('K-10', '作業ルートの親にGitのルートが無い場合は、掃除を拒否する(削除しない)', r10.status !== 0 && existsSync(join(noGit, '.e2e-work', 'e2e', 'x')), `終了コード=${r10.status}`)
  out('')
  out(failures === 0 ? '結果: すべて期待どおり' : `結果: ${failures}件が期待と異なる`)
  process.exitCode = failures === 0 ? 0 : 1
} finally {
  removeWorkDir(base)
}
