import { existsSync, mkdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createWorkDir,
  createWorkTools,
  removeWorkDir,
  reportLeftovers,
  sweepWorkRoot,
  useWorkDir,
  workRoot
} from './work-dir.mjs'

// 実際の .e2e-work/unit の下に、擬似リポジトリ(.git と .e2e-work を持つ)を作って検証する
const getSandbox = useWorkDir('work-dir-test', { beforeEach, afterEach })

function fakeRepo() {
  const repo = join(getSandbox(), 'repo')
  mkdirSync(join(repo, '.git'), { recursive: true })
  const root = join(repo, '.e2e-work')
  return { repo, root, tools: createWorkTools(root) }
}

describe('workRoot', () => {
  it('リポジトリ直下の .e2e-work を指す', () => {
    const root = workRoot()
    expect(root.endsWith('.e2e-work')).toBe(true)
    expect(existsSync(join(resolve(root, '..'), '.git'))).toBe(true)
  })
})

describe('createWorkDir', () => {
  it('種別のサブフォルダの下に、ラベル付きの作業フォルダを権限700で作る', () => {
    const { root, tools } = fakeRepo()
    const dir = tools.createWorkDir('e2e', 'my-test')
    expect(dir.startsWith(join(root, 'e2e', 'my-test-'))).toBe(true)
    expect(statSync(dir).isDirectory()).toBe(true)
    expect(statSync(dir).mode & 0o777).toBe(0o700)
  })

  it('ラベルの英数字・ハイフン以外を整える(パス区切りを含められない)', () => {
    const { root, tools } = fakeRepo()
    const dir = tools.createWorkDir('unit', '../a b/c')
    expect(resolve(dir, '..')).toBe(join(root, 'unit'))
    expect(dir.slice(join(root, 'unit').length + 1).startsWith('---a-b-c-')).toBe(true)
  })

  it('不正な種別は例外にする', () => {
    const { tools } = fakeRepo()
    expect(() => tools.createWorkDir('other', 'x')).toThrow()
  })

  it('名前が .e2e-work でない、または親に .git が無い場所には作らない', () => {
    const { repo } = fakeRepo()
    expect(() => createWorkTools(join(repo, 'other')).createWorkDir('unit', 'x')).toThrow()
    const noGit = join(getSandbox(), 'nogit')
    mkdirSync(noGit)
    expect(() => createWorkTools(join(noGit, '.e2e-work')).createWorkDir('unit', 'x')).toThrow()
  })
})

describe('removeWorkDir', () => {
  it('作業ルートの内側のフォルダを中身ごと削除する', () => {
    const { tools } = fakeRepo()
    const dir = tools.createWorkDir('unit', 'rm')
    writeFileSync(join(dir, 'a.txt'), 'x')
    tools.removeWorkDir(dir)
    expect(existsSync(dir)).toBe(false)
  })

  it('存在しないパスは何もしない', () => {
    const { root, tools } = fakeRepo()
    tools.createWorkDir('unit', 'x')
    expect(() => tools.removeWorkDir(join(root, 'unit', 'none'))).not.toThrow()
  })

  it('作業ルート自身・外側・兄弟は削除せず例外にする', () => {
    const { repo, root, tools } = fakeRepo()
    tools.createWorkDir('unit', 'x')
    const outside = join(repo, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'keep.txt'), 'x')
    expect(() => tools.removeWorkDir(root)).toThrow()
    expect(() => tools.removeWorkDir(repo)).toThrow()
    expect(() => tools.removeWorkDir(outside)).toThrow()
    expect(existsSync(join(outside, 'keep.txt'))).toBe(true)
  })

  it('作業ルート内のシンボリックリンクが外側を指す場合は削除しない', () => {
    const { repo, tools } = fakeRepo()
    const outside = join(repo, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'keep.txt'), 'x')
    const base = tools.createWorkDir('unit', 'link')
    const link = join(base, 'ln')
    symlinkSync(outside, link)
    expect(() => tools.removeWorkDir(link)).toThrow()
    expect(existsSync(join(outside, 'keep.txt'))).toBe(true)
  })
})

describe('removeCreatedWorkDirs', () => {
  it('作成して未削除の作業フォルダだけをすべて削除する', () => {
    const { root, tools } = fakeRepo()
    const a = tools.createWorkDir('unit', 'a')
    const b = tools.createWorkDir('e2e', 'b')
    const c = tools.createWorkDir('unit', 'c')
    tools.removeWorkDir(c)
    const other = join(root, 'unit', 'not-created')
    mkdirSync(other)
    tools.removeCreatedWorkDirs()
    expect(existsSync(a)).toBe(false)
    expect(existsSync(b)).toBe(false)
    expect(existsSync(other)).toBe(true)
  })
})

describe('sweepWorkRoot', () => {
  it('指定した種別の中身だけを削除し、他の種別は残す', () => {
    const { root, tools } = fakeRepo()
    const u = tools.createWorkDir('unit', 'u')
    const e = tools.createWorkDir('e2e', 'e')
    tools.sweepWorkRoot('unit')
    expect(existsSync(u)).toBe(false)
    expect(existsSync(join(root, 'unit'))).toBe(true)
    expect(existsSync(e)).toBe(true)
  })

  it('省略時は3種別すべての中身を削除する', () => {
    const { tools } = fakeRepo()
    const dirs = ['e2e', 'unit', 'tools'].map((k) => tools.createWorkDir(k, 'x'))
    tools.sweepWorkRoot()
    expect(dirs.some((d) => existsSync(d))).toBe(false)
  })

  it('種別がシンボリックリンクの場合は外側をたどらない', () => {
    const { repo, root, tools } = fakeRepo()
    const outside = join(repo, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'keep.txt'), 'x')
    mkdirSync(root)
    symlinkSync(outside, join(root, 'unit'))
    tools.sweepWorkRoot('unit')
    expect(existsSync(join(outside, 'keep.txt'))).toBe(true)
  })

  it('名前が .e2e-work でない場所は例外にする', () => {
    const { repo } = fakeRepo()
    expect(() => createWorkTools(join(repo, 'other')).sweepWorkRoot()).toThrow()
  })
})

describe('reportLeftovers', () => {
  it('作業ルートの中身と、OS一時領域の jimuhub-* (除外対象を除く)を返し、削除しない', () => {
    const { repo, tools } = fakeRepo()
    const dir = tools.createWorkDir('unit', 'left')
    writeFileSync(join(dir, 'a.txt'), '12345')
    const tmp = join(repo, 'fake-tmp')
    for (const n of ['jimuhub-old', 'jimuhub-pdf-tmp', 'jimuhub-pdf-tools', 'other'])
      mkdirSync(join(tmp, n), { recursive: true })
    const r = tools.reportLeftovers(tmp)
    expect(r.work.count).toBe(1)
    expect(r.work.names).toEqual(['unit'])
    expect(r.work.bytes).toBe(5)
    expect(r.tmp.names).toEqual(['jimuhub-old'])
    expect(existsSync(join(tmp, 'jimuhub-old'))).toBe(true)
  })

  it('何も無ければ件数0を返す', () => {
    const { repo, tools } = fakeRepo()
    const r = tools.reportLeftovers(join(repo, 'no-tmp'))
    expect(r.work.count).toBe(0)
    expect(r.tmp.count).toBe(0)
  })
})

describe('既定のヘルパー(実際の .e2e-work)', () => {
  it('createWorkDir / removeWorkDir / sweepWorkRoot / reportLeftovers が公開されている', () => {
    const dir = createWorkDir('unit', 'default')
    expect(dir.startsWith(join(workRoot(), 'unit'))).toBe(true)
    removeWorkDir(dir)
    expect(existsSync(dir)).toBe(false)
    expect(typeof sweepWorkRoot).toBe('function')
    expect(typeof reportLeftovers).toBe('function')
  })
})

describe('useWorkDir', () => {
  const get = useWorkDir('use-test', { beforeEach, afterEach })
  let first = ''
  it('テスト中は作業フォルダを取得できる', () => {
    first = get()
    expect(existsSync(first)).toBe(true)
  })
  it('前のテストの作業フォルダは削除され、新しいものが作られる', () => {
    expect(existsSync(first)).toBe(false)
    expect(get()).not.toBe(first)
  })
})
