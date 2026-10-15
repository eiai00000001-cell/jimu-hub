import { sweepWorkRoot } from '../test-support/work-dir.mjs'

// E2Eの終了後に .e2e-work/e2e/ を掃除する。
// E2E_KEEP_WORK=1 の場合は、デバッグ用に掃除を省略する(次回の開始前に消える)。
export default function globalTeardown(): void {
  if (process.env.E2E_KEEP_WORK !== '1') sweepWorkRoot('e2e')
}
