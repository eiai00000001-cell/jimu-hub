import { sweepWorkRoot } from '../test-support/work-dir.mjs'

// E2Eの開始前に .e2e-work/e2e/ を掃除する(詳細設計書4.41)
export default function globalSetup(): void {
  sweepWorkRoot('e2e')
}
