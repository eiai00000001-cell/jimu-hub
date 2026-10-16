#!/usr/bin/env node
/**
 * 【tester作成】配布版(.app)の確認シナリオ(TC-70〜72・TC-127・TC-153)を実行する補助ツール。
 * 現行コードから`electron-builder --mac --dir --arm64`で.appを作業フォルダ(.e2e-work/tools/)へ作り、
 * JIMUHUB_PACKAGED_APPを指定してPlaywrightを実行し、終了時(失敗時も)に作業フォルダをremoveWorkDirで削除する(詳細設計書4.41)。
 * 使い方(リポジトリ直下から): JIMUHUB_EVIDENCE_DIR=<出力先> node docs/07_test/tools/run-packaged.mjs
 */
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createWorkDir, removeWorkDir } from '../../../app/test-support/work-dir.mjs'

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'app')
const work = createWorkDir('tools', 'pkg-build')
let code = 1
try {
  const b = spawnSync('npx', ['electron-builder', '--mac', '--dir', '--arm64', `--config.directories.output=${work}`], { cwd: app, stdio: 'inherit' })
  if (b.status !== 0) throw new Error('electron-builderが失敗しました')
  const appPath = join(work, 'mac-arm64', '事務HUB.app')
  const t = spawnSync('npx', ['playwright', 'test', '--config=e2e/scenarios/playwright.config.ts', 'packaged-app', 'i3-packaged', 'i4-packaged'], {
    cwd: app, stdio: 'inherit', env: { ...process.env, JIMUHUB_PACKAGED_APP: appPath }
  })
  code = t.status ?? 1
} finally {
  removeWorkDir(work)
}
process.exit(code)
