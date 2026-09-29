import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { Database } from '../db/db'
import { DocumentNumberSequenceRepository } from '../repositories/document-number-sequence.repository'
import { NumberingService } from './numbering.service'

describe('NumberingService', () => {
  let db: Database
  let service: NumberingService

  beforeEach(() => {
    db = new Database(':memory:')
    db.initialize()
    service = new NumberingService(new DocumentNumberSequenceRepository(db))
  })

  afterEach(() => {
    db.close()
  })

  it('西暦4桁+ハイフン+連番3桁の形式で発番する(基本設計書2.2章★C4)', () => {
    expect(service.issueNumber('quote', 2026)).toBe('2026-001')
  })

  it('連続発番すると連番部分がインクリメントされる', () => {
    expect(service.issueNumber('quote', 2026)).toBe('2026-001')
    expect(service.issueNumber('quote', 2026)).toBe('2026-002')
  })

  it('連番が2桁以下でも3桁ゼロ埋めで表示する', () => {
    for (let i = 0; i < 9; i++) {
      service.issueNumber('quote', 2026)
    }
    expect(service.issueNumber('quote', 2026)).toBe('2026-010')
  })

  it('見積書・請求書は別系列で採番される', () => {
    expect(service.issueNumber('quote', 2026)).toBe('2026-001')
    expect(service.issueNumber('invoice', 2026)).toBe('2026-001')
  })
})
