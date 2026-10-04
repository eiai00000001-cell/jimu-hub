import { describe, expect, it } from 'vitest'
import { computeRecordHash } from './record-hash'

const record = {
  id: 1,
  recordDate: '2026-09-28',
  kind: 'expense' as const,
  amount: 6600,
  withholdingTaxAmount: 0,
  accountId: 1,
  description: 'x',
  clientId: null,
  paymentMethod: null,
  taxCategory: null,
  taxAmount: 0,
  invoiceId: null,
  status: 'active' as const,
  isDeleted: false
}

describe('computeRecordHash(詳細設計書4.22章)', () => {
  it('64桁の16進数を返し、同じ入力では同じ値になる', () => {
    const h = computeRecordHash(record, [])
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(computeRecordHash({ ...record }, [])).toBe(h)
  })
  it('項目が変わるとハッシュも変わる', () => {
    const h = computeRecordHash(record, [])
    expect(computeRecordHash({ ...record, amount: 6601 }, [])).not.toBe(h)
    expect(computeRecordHash({ ...record, isDeleted: true }, [])).not.toBe(h)
    expect(computeRecordHash({ ...record, status: 'cancelled' }, [])).not.toBe(h)
  })
  it('領収書はid順に並べて含め、外した状態の違いも反映する', () => {
    const a = { id: 1, sha256: 'a', removedAt: null }
    const b = { id: 2, sha256: 'b', removedAt: null }
    expect(computeRecordHash(record, [b, a])).toBe(computeRecordHash(record, [a, b]))
    expect(computeRecordHash(record, [a])).not.toBe(computeRecordHash(record, []))
    expect(computeRecordHash(record, [{ ...a, removedAt: 'x' }])).not.toBe(
      computeRecordHash(record, [a])
    )
  })
})
