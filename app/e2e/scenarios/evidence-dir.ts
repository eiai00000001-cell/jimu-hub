import { appendFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

/** 公式エビデンス保存先のルート(`docs/07_test/evidence`)。シナリオの実行出力をここへ直接書いてはならない */
const OFFICIAL_EVIDENCE_ROOT = resolve(__dirname, '..', '..', '..', 'docs', '07_test', 'evidence')

/**
 * シナリオ実行時の出力先(スクリーンショット・テキストログ)を返す。
 *
 * 運用ルール(テスト仕様書 7章):
 * - 出力先は環境変数 `JIMUHUB_EVIDENCE_DIR` で指定する。未指定の場合はOSの一時ディレクトリ配下
 *   (`<tmpdir>/jimuhub-evidence-run`)に出力する。
 * - 公式エビデンス保存先(`docs/07_test/evidence/`配下)は、既存のエビデンス(イテレーション0分を含む)の
 *   上書きを防ぐため、シナリオの出力先に指定できない(指定するとエラー)。
 * - 合格を確認した成果物のみ、`e2e/scenarios/tools/promote-evidence.sh`で
 *   `docs/07_test/evidence/iteration-<N>/`へコピーする(既存ファイルは上書きしない)。
 */
export function evidenceRunDir(): string {
  const dir = resolve(process.env.JIMUHUB_EVIDENCE_DIR ?? join(tmpdir(), 'jimuhub-evidence-run'))
  const rel = relative(OFFICIAL_EVIDENCE_ROOT, dir)
  if (rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep))) {
    throw new Error(
      `JIMUHUB_EVIDENCE_DIR に公式エビデンス保存先(docs/07_test/evidence)配下は指定できません: ${dir}`
    )
  }
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * 互換用: シナリオ名単位のサブフォルダを返す(旧シナリオが使用)。出力先は`evidenceRunDir()`配下に限る。
 */
export function evidenceDir(name: string): string {
  const dir = join(evidenceRunDir(), name)
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * 連番の採番。フォローアップ再実施で既存エビデンスと連番が重ならないよう、環境変数
 * `JIMUHUB_EVIDENCE_SEQ_BASE`(例: `docs/07_test/evidence/iteration-1`)に既に存在するファイルも
 * 採番済みとして扱い、その次の連番から始める。
 */
function nextSeq(tc: string): number {
  const dirs = [evidenceRunDir()]
  const base = process.env.JIMUHUB_EVIDENCE_SEQ_BASE
  if (base) {
    try {
      dirs.push(resolve(base))
    } catch {
      /* 指定が不正な場合は無視する */
    }
  }
  const used = dirs
    .flatMap((d) => {
      try {
        return readdirSync(d)
      } catch {
        return []
      }
    })
    .map((f) => new RegExp(`^${tc}_(\\d+)\\.`).exec(f))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]))
  return (used.length === 0 ? 0 : Math.max(...used)) + 1
}

/** `<TC-ID>_<連番>.png` の名前でスクリーンショットを保存し、説明を`_index.txt`へ追記する */
export async function shot(page: Page, tc: string, description: string): Promise<string> {
  const seq = String(nextSeq(tc)).padStart(2, '0')
  const file = `${tc}_${seq}.png`
  // 非表示ウィンドウでは、まれにスクリーンショットの取得が応答しないことがあるため、短い待機時間で再試行する
  for (let attempt = 1; ; attempt++) {
    try {
      await page.screenshot({ path: join(evidenceRunDir(), file), timeout: 8000 })
      break
    } catch (error) {
      if (attempt >= 3) throw error
      await page.waitForTimeout(500)
    }
  }
  appendIndex(file, description)
  return file
}

/** `<TC-ID>_<連番>.txt` の名前でテキスト(実行ログ・アサーション結果)を保存する */
export function noteEvidence(tc: string, description: string, text: string): string {
  const seq = String(nextSeq(tc)).padStart(2, '0')
  const file = `${tc}_${seq}.txt`
  writeFileSync(join(evidenceRunDir(), file), text.endsWith('\n') ? text : `${text}\n`)
  appendIndex(file, description)
  return file
}

/** `<TC-ID>_<連番>.<拡張子>` の保存パスを発行する(他のツールが出力するファイル用)。説明を`_index.txt`へ追記する */
export function evidenceFilePath(tc: string, description: string, ext: string): string {
  const seq = String(nextSeq(tc)).padStart(2, '0')
  const file = `${tc}_${seq}.${ext}`
  appendIndex(file, description)
  return join(evidenceRunDir(), file)
}

function appendIndex(file: string, description: string): void {
  appendFileSync(join(evidenceRunDir(), '_index.txt'), `${file}\t${description}\n`)
}
