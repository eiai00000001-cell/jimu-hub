import { sweepWorkRoot } from './test-support/work-dir.mjs'

// 開始前と終了後に .e2e-work/unit/ を掃除する(詳細設計書4.41)。
// E2E_KEEP_WORK=1 の場合は、デバッグ用に終了後の掃除を省略する(次回の開始前に消える)。
export default function setup(): () => void {
  sweepWorkRoot('unit')
  return () => {
    if (process.env.E2E_KEEP_WORK !== '1') sweepWorkRoot('unit')
  }
}
