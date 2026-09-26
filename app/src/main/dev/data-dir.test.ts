import { describe, expect, it } from 'vitest'
import { resolveUserDataDir } from './data-dir'

describe('resolveUserDataDir', () => {
  it('JIMUHUB_DATA_DIRが設定されている場合はその値を返す', () => {
    expect(resolveUserDataDir({ JIMUHUB_DATA_DIR: '/tmp/jimuhub-test' })).toBe('/tmp/jimuhub-test')
  })

  it('JIMUHUB_DATA_DIRが未設定の場合はmacOS標準の保存先を返す', () => {
    const result = resolveUserDataDir({})
    expect(result).toContain('Library/Application Support/事務HUB')
  })
})
