import { describe, expect, it } from 'vitest'
import { ReceiptStagingStore, STAGING_TTL_MS } from './receipt-staging-store'

describe('ReceiptStagingStore', () => {
  it('登録した識別子で取得でき、破棄後は取得できない', () => {
    const store = new ReceiptStagingStore()
    const token = store.register({ path: '/x/a.pdf', fileName: 'a.pdf', fileSize: 3 })
    expect(store.get(token)).toEqual({ path: '/x/a.pdf', fileName: 'a.pdf', fileSize: 3 })
    store.discard([token])
    expect(store.get(token)).toBeNull()
    expect(store.get('unknown')).toBeNull()
  })

  it('30分経過すると無効になる', () => {
    let now = 1_000
    const store = new ReceiptStagingStore(() => now)
    const token = store.register({ path: '/x/a.pdf', fileName: 'a.pdf', fileSize: 3 })
    now += STAGING_TTL_MS - 1
    expect(store.get(token)).not.toBeNull()
    now += 1
    expect(store.get(token)).toBeNull()
  })
})
