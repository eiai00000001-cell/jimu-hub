import { describe, expect, it } from 'vitest'
import { LocalTodayProvider } from './today-provider'

/** 「今日」はパソコンのローカルの日付(UTCではない)。詳細設計書4.37章手順3 */
describe('LocalTodayProvider', () => {
  it('ローカルの日付をYYYY-MM-DDで返す(年・月・日をゼロ埋め)', () => {
    expect(new LocalTodayProvider(() => new Date(2026, 0, 5, 12, 0, 0)).today()).toBe('2026-01-05')
    expect(new LocalTodayProvider(() => new Date(2026, 11, 31, 12, 0, 0)).today()).toBe(
      '2026-12-31'
    )
  })

  it('日付をまたぐ直前・直後で日付が切り替わる(深夜0時前後)', () => {
    let current = new Date(2026, 9, 14, 23, 59, 59, 999)
    const provider = new LocalTodayProvider(() => current)
    expect(provider.today()).toBe('2026-10-14')
    current = new Date(2026, 9, 15, 0, 0, 0, 0)
    expect(provider.today()).toBe('2026-10-15')
  })

  it('UTCの日付ではなく、ローカル時刻の年月日を使う', () => {
    // ローカル0時30分は、UTCに換算すると別の日になる場合があるが、ローカルの日付を返す
    const date = new Date(2026, 9, 15, 0, 30, 0)
    expect(new LocalTodayProvider(() => date).today()).toBe(
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    )
    expect(new LocalTodayProvider(() => date).today()).toBe('2026-10-15')
  })

  it('既定では現在時刻を使う', () => {
    expect(new LocalTodayProvider().today()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
