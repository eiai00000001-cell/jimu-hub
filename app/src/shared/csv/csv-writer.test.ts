import { describe, expect, it } from 'vitest'
import { buildCsv, escapeCsvField, neutralizeFormula } from './csv-writer'

describe('escapeCsvField(詳細設計書4.24章)', () => {
  it('通常の値はそのまま、カンマ・二重引用符・改行(CR/LF)を含む値は二重引用符で囲み、内部の二重引用符は2つ重ねる', () => {
    expect(escapeCsvField('abc')).toBe('abc')
    expect(escapeCsvField('')).toBe('')
    expect(escapeCsvField('a,b')).toBe('"a,b"')
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""')
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"')
    expect(escapeCsvField('line1\rline2')).toBe('"line1\rline2"')
  })
})

describe('neutralizeFormula(数式インジェクション対策)', () => {
  it("=・+・-・@・タブ・CRで始まる場合は先頭に「'」を付ける", () => {
    for (const v of ['=1+1', '+81', '-5', '@SUM(A1)', '\tx', '\rx']) {
      expect(neutralizeFormula(v)).toBe(`'${v}`)
    }
  })
  it('それ以外・空文字は変更しない', () => {
    for (const v of ['', 'abc', '通信費', '1=1', ' =x', "'=x"]) {
      expect(neutralizeFormula(v)).toBe(v)
    }
  })
})

describe('buildCsv', () => {
  it('先頭にBOM、ヘッダー行、各行の区切りはCRLF、最終行の末尾にもCRLFを付ける', () => {
    const csv = buildCsv(
      ['日付', '摘要'],
      [
        ['2026-09-01', 'a,b'],
        ['2026-09-02', '=cmd']
      ]
    )
    expect(csv).toBe('﻿日付,摘要\r\n2026-09-01,"a,b"\r\n2026-09-02,=cmd\r\n')
  })
  it('0行でもヘッダー行を出力する', () => {
    expect(buildCsv(['a', 'b'], [])).toBe('﻿a,b\r\n')
  })
})
