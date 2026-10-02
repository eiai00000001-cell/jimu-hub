import { describe, expect, it } from 'vitest'
import { toErrorMessage } from './error-message'

describe('toErrorMessage', () => {
  it('IPCの接頭辞と例外クラス名を取り除き、文言だけを返す(I1-07)', () => {
    const error = new Error(
      "Error invoking remote method 'quotes:finalize': PdfSaveError: PDFの保存に失敗しました"
    )
    expect(toErrorMessage(error, '代替')).toBe('PDFの保存に失敗しました')
  })

  it('例外クラス名のみの接頭辞も取り除く', () => {
    expect(toErrorMessage(new Error('Error: 対象の見積書が見つかりません'), '代替')).toBe(
      '対象の見積書が見つかりません'
    )
  })

  it('接頭辞のないメッセージはそのまま返す', () => {
    expect(toErrorMessage(new Error('対象の請求書が見つかりません'), '代替')).toBe(
      '対象の請求書が見つかりません'
    )
  })

  it('Error以外・空メッセージの場合は代替文言を返す', () => {
    expect(toErrorMessage('x', '代替')).toBe('代替')
    expect(toErrorMessage(new Error(''), '代替')).toBe('代替')
  })
})
