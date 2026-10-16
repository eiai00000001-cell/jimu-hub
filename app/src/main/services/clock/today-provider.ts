/** 期限超過の判定の基準となる「今日」(`YYYY-MM-DD`)を返す。テストで差し替えられる */
export interface TodayProvider {
  today(): string
}

/**
 * パソコンのローカルの日付を返す(UTCの日付ではない)。
 * 参照元: 詳細設計書4.37章手順3、5章(`TodayProvider`)
 */
export class LocalTodayProvider implements TodayProvider {
  constructor(private readonly now: () => Date = () => new Date()) {}

  today(): string {
    const date = this.now()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${date.getFullYear()}-${month}-${day}`
  }
}
