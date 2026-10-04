/**
 * CSV出力の純粋関数。参照元: 詳細設計書4.24章(`escapeCsvField`・`neutralizeFormula`)
 */

/** 項目に、カンマ・二重引用符・改行(CR・LF)が含まれる場合は、二重引用符で囲み、内部の二重引用符は2つ重ねる */
export function escapeCsvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/**
 * 表計算ソフトで式として解釈されることを防ぐため、`=`・`+`・`-`・`@`・タブ・CRで始まる文字列の先頭に`'`を付ける。
 * 文字列の項目にのみ適用する(日付・金額・消費税額には適用しない)。
 */
export function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
}

const BOM = '﻿'

/** BOM付き・CRLF区切り(最終行にもCRLF)のCSV文字列を組み立てる。各項目は呼び出し側で式の無効化を済ませておくこと */
export function buildCsv(headers: string[], rows: string[][]): string {
  return (
    BOM + [headers, ...rows].map((row) => row.map(escapeCsvField).join(',')).join('\r\n') + '\r\n'
  )
}
