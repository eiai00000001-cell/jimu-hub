import { writeFileSync } from 'node:fs'
import { buildCsv, neutralizeFormula } from '@shared/csv/csv-writer'
import { KIND_LABELS, STATUS_LABELS, TAX_CATEGORY_LABELS } from '@shared/constants/cash-record'
import { CSV_MESSAGES } from '@shared/messages/messages'
import type { CashRecordRepository, CsvRecordRow } from '../repositories/cash-record.repository'

export const CSV_HEADERS = [
  '日付',
  '種別',
  '取引先',
  '金額',
  '勘定科目',
  '摘要',
  '税区分',
  '消費税額',
  '領収書ファイル名',
  '請求書番号',
  '状態'
]

/** CSVの書き込み失敗(権限不足・空き容量不足等) */
export class CsvWriteError extends Error {
  constructor() {
    super(CSV_MESSAGES.writeFailure)
    this.name = 'CsvWriteError'
  }
}

/** 期間(`YYYY-MM`)を、記録日の範囲(開始日・終了の翌月1日)へ変換する */
export function monthRange(
  fromMonth: string,
  toMonth: string
): { fromDate: string; toExclusive: string } {
  const [year, month] = toMonth.split('-').map(Number) as [number, number]
  const next = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`
  return { fromDate: `${fromMonth}-01`, toExclusive: `${next}-01` }
}

function toRow(r: CsvRecordRow): string[] {
  return [
    r.recordDate,
    KIND_LABELS[r.kind],
    neutralizeFormula(r.clientName ?? ''),
    String(r.amount),
    neutralizeFormula(r.accountName),
    neutralizeFormula(r.description),
    r.taxCategory ? TAX_CATEGORY_LABELS[r.taxCategory] : '',
    String(r.taxAmount),
    neutralizeFormula(r.receiptNames.join('; ')),
    neutralizeFormula(r.invoiceNumber ?? ''),
    STATUS_LABELS[r.status]
  ]
}

/**
 * 入金・経費を1つのCSVファイルへ出力する。取消済の入金記録を含み、削除済みは含めない。
 * 消費税額は保存された値をそのまま出力する(再計算しない)。
 * 参照元: 詳細設計書4.24章、5章(`CsvExportService`)
 */
export class CsvExportService {
  constructor(private readonly repository: CashRecordRepository) {}

  countTargets(fromMonth: string, toMonth: string): number {
    const { fromDate, toExclusive } = monthRange(fromMonth, toMonth)
    return this.repository.countForCsv(fromDate, toExclusive)
  }

  /** CSV文字列を組み立てる(ファイルへは書かない) */
  build(fromMonth: string, toMonth: string): { content: string; count: number } {
    const { fromDate, toExclusive } = monthRange(fromMonth, toMonth)
    const rows = this.repository.findForCsv(fromDate, toExclusive)
    return { content: buildCsv(CSV_HEADERS, rows.map(toRow)), count: rows.length }
  }

  export(fromMonth: string, toMonth: string, filePath: string): { count: number } {
    const { content, count } = this.build(fromMonth, toMonth)
    try {
      writeFileSync(filePath, content, 'utf8')
    } catch {
      throw new CsvWriteError()
    }
    return { count }
  }
}
