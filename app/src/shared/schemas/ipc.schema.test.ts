import { describe, expect, it } from 'vitest'
import { ClientIdSchema, ClientListFilterSchema } from './ipc.schema'

describe('ClientIdSchema', () => {
  it('正の整数を受け入れる', () => {
    expect(ClientIdSchema.safeParse(1).success).toBe(true)
  })

  it('0以下・小数・文字列・undefinedは拒否する', () => {
    expect(ClientIdSchema.safeParse(0).success).toBe(false)
    expect(ClientIdSchema.safeParse(-1).success).toBe(false)
    expect(ClientIdSchema.safeParse(1.5).success).toBe(false)
    expect(ClientIdSchema.safeParse('1').success).toBe(false)
    expect(ClientIdSchema.safeParse(undefined).success).toBe(false)
  })
})

describe('ClientListFilterSchema', () => {
  it('空オブジェクト(全項目省略)を受け入れる', () => {
    expect(ClientListFilterSchema.safeParse({}).success).toBe(true)
  })

  it('正しいsort・statusFilterの組み合わせを受け入れる', () => {
    const result = ClientListFilterSchema.safeParse({
      keyword: 'アルファ',
      sort: 'created_at_desc',
      statusFilter: 'all'
    })
    expect(result.success).toBe(true)
  })

  it('sort=furigana_asc(既定値)を受け入れる', () => {
    expect(ClientListFilterSchema.safeParse({ sort: 'furigana_asc' }).success).toBe(true)
  })

  it('列挙値以外のsortは拒否する', () => {
    expect(ClientListFilterSchema.safeParse({ sort: 'unknown_sort' }).success).toBe(false)
  })

  it('列挙値以外のstatusFilterは拒否する', () => {
    expect(ClientListFilterSchema.safeParse({ statusFilter: 'unknown_status' }).success).toBe(false)
  })
})
