/// <reference types="node" />
import '@testing-library/jest-dom/vitest'
import { afterAll, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { createWorkDir, removeCreatedWorkDirs } from './test-support/work-dir.mjs'

// アプリ本体が os.tmpdir() に作るフォルダも、実際のOS一時領域ではなく作業フォルダに作らせる
// (詳細設計書4.41)。テストファイルの終了時に、未削除の作業フォルダをすべて削除する。
const originalTmpdir = process.env.TMPDIR
process.env.TMPDIR = createWorkDir('unit', 'tmpdir')

afterEach(() => {
  cleanup()
})

afterAll(() => {
  if (originalTmpdir === undefined) delete process.env.TMPDIR
  else process.env.TMPDIR = originalTmpdir
  removeCreatedWorkDirs()
})
