import { describe, expect, it } from 'vitest'
import { CsvExportInputSchema, isValidMonth } from './csv-export.schema'

const msg = (v: unknown): string | undefined => {
  const r = CsvExportInputSchema.safeParse(v)
  return r.success ? undefined : r.error.issues[0]?.message
}

describe('CsvExportInputSchema(詳細設計書3.20・4.24章)', () => {
  it('正しい期間を受け付ける(同月も可)', () => {
    expect(msg({ fromMonth: '2026-01', toMonth: '2026-12' })).toBeUndefined()
    expect(msg({ fromMonth: '2026-05', toMonth: '2026-05' })).toBeUndefined()
  })
  it('未入力・形式不正・実在しない月はmonthInvalid', () => {
    for (const bad of ['', '2026-13', '2026-00', '2026/01', '26-01', 'abc']) {
      expect(msg({ fromMonth: bad, toMonth: '2026-12' })).toBe('年月を正しく入力してください')
    }
    expect(isValidMonth('2026-12')).toBe(true)
  })
  it('終了年月が開始年月より前はcsvMonthRangeInvalid', () => {
    expect(msg({ fromMonth: '2026-12', toMonth: '2026-01' })).toBe(
      '終了年月は、開始年月以降を指定してください'
    )
  })
})
