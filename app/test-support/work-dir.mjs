// テスト・確認作業の作業フォルダ(リポジトリ直下の .e2e-work/)の共通ヘルパー。
// 詳細設計書 4.41。削除は .e2e-work/ の厳密な内側に限る。
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const WORK_ROOT_NAME = '.e2e-work'
export const KINDS = ['e2e', 'unit', 'tools']
// 残骸の確認から除外する(R-56。インストール済みアプリ・E2Eヘルパー・証跡出力が使用)
const TMP_EXCLUDES = ['jimuhub-pdf-tmp', 'jimuhub-pdf-tools', 'jimuhub-evidence-run']

function assertKind(kind) {
  if (!KINDS.includes(kind)) throw new Error(`不正な作業フォルダの種別です: ${String(kind)}`)
}

function sanitizeLabel(label) {
  const cleaned = String(label ?? '').replace(/[^A-Za-z0-9-]/g, '-')
  return cleaned.length > 0 ? cleaned : 'work'
}

function isStrictlyInside(parent, child) {
  const rel = relative(parent, child)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/** du相当の実使用量(ブロック数×512)。sparseファイルの論理サイズは含めない */
function sizeOf(path) {
  const st = lstatSync(path)
  if (!st.isDirectory()) return st.blocks * 512
  let total = 0
  for (const name of readdirSync(path)) total += sizeOf(join(path, name))
  return total
}

function listEntries(dir, filter = () => true) {
  if (!existsSync(dir)) return { count: 0, bytes: 0, names: [] }
  const names = readdirSync(dir).filter(filter).sort()
  const bytes = names.reduce((sum, n) => sum + sizeOf(join(dir, n)), 0)
  return { count: names.length, bytes, names }
}

/**
 * 指定した作業ルート(名前が .e2e-work で、親に .git がある場所)に束縛したヘルパー群を作る。
 * 既定のエクスポートは、リポジトリ直下の .e2e-work/ に束縛したもの。
 */
export function createWorkTools(root) {
  /** createWorkDir で作成し、まだ削除していない作業フォルダ */
  const created = new Set()

  function assertRoot() {
    if (basename(root) !== WORK_ROOT_NAME) {
      throw new Error('作業ルートの名前が .e2e-work ではありません')
    }
    if (!existsSync(join(dirname(root), '.git'))) {
      throw new Error('作業ルートの親にGitのルートが見つかりません')
    }
  }

  function createWorkDir(kind, label) {
    assertKind(kind)
    assertRoot()
    const sub = join(root, kind)
    mkdirSync(sub, { recursive: true, mode: 0o700 })
    const dir = mkdtempSync(join(sub, `${sanitizeLabel(label)}-`))
    created.add(dir)
    return dir
  }

  function removeWorkDir(dir) {
    assertRoot()
    if (!existsSync(dir)) return
    if (!existsSync(root)) throw new Error('作業ルートが存在しないため削除しません')
    if (!isStrictlyInside(realpathSync(root), realpathSync(dir))) {
      throw new Error('作業ルートの外側は削除できません')
    }
    rmSync(dir, { recursive: true, force: true })
    created.delete(dir)
  }

  /** このプロセスで作成して未削除の作業フォルダをすべて削除する(削除し忘れの保険) */
  function removeCreatedWorkDirs() {
    for (const dir of [...created]) removeWorkDir(dir)
  }

  function sweepWorkRoot(kind) {
    assertRoot()
    const kinds = kind === undefined ? KINDS : [kind]
    kinds.forEach(assertKind)
    for (const k of kinds) {
      const sub = join(root, k)
      if (!existsSync(sub)) continue
      if (!lstatSync(sub).isDirectory()) continue // シンボリックリンク等はたどらない
      for (const name of readdirSync(sub)) {
        rmSync(join(sub, name), { recursive: true, force: true })
      }
    }
  }

  /** 各種別のサブフォルダの中にある作業フォルダ(<種別>/<名前>)を数える。空のサブフォルダは数えない */
  function listWorkEntries() {
    const names = []
    let bytes = 0
    for (const k of KINDS) {
      const sub = join(root, k)
      if (!existsSync(sub) || !lstatSync(sub).isDirectory()) continue
      for (const name of readdirSync(sub).sort()) {
        names.push(`${k}/${name}`)
        bytes += sizeOf(join(sub, name))
      }
    }
    return { count: names.length, bytes, names }
  }

  function reportLeftovers(tmpRoot = tmpdir()) {
    return {
      work: listWorkEntries(),
      tmp: listEntries(tmpRoot, (n) => n.startsWith('jimuhub-') && !TMP_EXCLUDES.includes(n))
    }
  }

  return {
    root,
    createWorkDir,
    removeWorkDir,
    removeCreatedWorkDirs,
    sweepWorkRoot,
    reportLeftovers
  }
}

/** .e2e-work/ の絶対パス。ヘルパー自身の位置から求め、上書きはできない */
export function workRoot() {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  return join(repoRoot, WORK_ROOT_NAME)
}

const tools = createWorkTools(workRoot())
export const createWorkDir = tools.createWorkDir
export const removeWorkDir = tools.removeWorkDir
export const removeCreatedWorkDirs = tools.removeCreatedWorkDirs
export const sweepWorkRoot = tools.sweepWorkRoot
export const reportLeftovers = tools.reportLeftovers

/** 単体テスト用。テストごとに作業フォルダを作り、終了時に必ず削除する。パス取得関数を返す */
export function useWorkDir(label, hooks) {
  const { beforeEach, afterEach } = hooks
  let current = null
  beforeEach(() => {
    current = createWorkDir('unit', label)
  })
  afterEach(() => {
    const dir = current
    current = null
    if (dir) removeWorkDir(dir)
  })
  return () => {
    if (!current) throw new Error('作業フォルダはテストの実行中のみ取得できます')
    return current
  }
}
