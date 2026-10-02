import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { Database } from '../db/db'
import { DocumentNumberSequenceRepository } from './document-number-sequence.repository'

describe('DocumentNumberSequenceRepository', () => {
  let db: Database
  let repository: DocumentNumberSequenceRepository

  beforeEach(() => {
    db = new Database(':memory:')
    db.initialize()
    repository = new DocumentNumberSequenceRepository(db)
  })

  afterEach(() => {
    db.close()
  })

  it('初回はその年・書類種別の1を返す', () => {
    expect(repository.nextNumber('quote', 2026)).toBe(1)
  })

  it('同じ年・書類種別で連続して呼び出すとインクリメントされる', () => {
    expect(repository.nextNumber('quote', 2026)).toBe(1)
    expect(repository.nextNumber('quote', 2026)).toBe(2)
    expect(repository.nextNumber('quote', 2026)).toBe(3)
  })

  it('見積書と請求書は別系列で採番される', () => {
    expect(repository.nextNumber('quote', 2026)).toBe(1)
    expect(repository.nextNumber('invoice', 2026)).toBe(1)
    expect(repository.nextNumber('quote', 2026)).toBe(2)
  })

  it('年が変わると1からリセットされる(暦年ごと)', () => {
    expect(repository.nextNumber('quote', 2026)).toBe(1)
    expect(repository.nextNumber('quote', 2026)).toBe(2)
    expect(repository.nextNumber('quote', 2027)).toBe(1)
  })
})
