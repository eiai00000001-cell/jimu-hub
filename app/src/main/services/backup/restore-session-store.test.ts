import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BackupFileChangedError } from './errors'
import { RESTORE_SESSION_TTL_MS, RestoreSessionStore } from './restore-session-store'

describe('RestoreSessionStore(F-33)', () => {
  let dir: string
  let file: string
  let now: number
  let store: RestoreSessionStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'session-store-test-'))
    file = join(dir, 'b.zip')
    writeFileSync(file, 'abc')
    now = 1_000_000
    store = new RestoreSessionStore(() => now)
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('登録した識別子からファイルのパスを取り出せる', () => {
    const token = store.register(file)
    expect(store.resolve(token)).toBe(file)
  })

  it('未登録・破棄済みの識別子は無効', () => {
    expect(() => store.resolve('unknown')).toThrow(BackupFileChangedError)
    const token = store.register(file)
    store.discard(token)
    expect(() => store.resolve(token)).toThrow(BackupFileChangedError)
  })

  it('有効期間(30分)を過ぎた識別子は無効', () => {
    const token = store.register(file)
    now += RESTORE_SESSION_TTL_MS
    expect(store.resolve(token)).toBe(file)
    now += 1
    expect(() => store.resolve(token)).toThrow(BackupFileChangedError)
  })

  it('ファイルのサイズが変わった場合は無効', () => {
    const token = store.register(file)
    writeFileSync(file, 'abcd')
    expect(() => store.resolve(token)).toThrow(BackupFileChangedError)
  })

  it('ファイルの更新日時が変わった場合は無効', () => {
    const token = store.register(file)
    utimesSync(file, new Date(2000, 0, 1), new Date(2000, 0, 1))
    expect(() => store.resolve(token)).toThrow(BackupFileChangedError)
  })

  it('ファイルが無くなった場合は無効', () => {
    const token = store.register(file)
    rmSync(file)
    expect(() => store.resolve(token)).toThrow(BackupFileChangedError)
  })

  it('期限切れの識別子は、次の登録時に掃除される', () => {
    const old = store.register(file)
    now += RESTORE_SESSION_TTL_MS + 1
    store.register(file)
    expect(() => store.resolve(old)).toThrow(BackupFileChangedError)
  })
})
