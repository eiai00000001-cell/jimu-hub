import { describe, expect, it } from 'vitest'
import { validateReceiptFile, ReceiptValidationError } from './receipt-file-validator'

const pdf = Buffer.from('%PDF-1.4 dummy')
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])

describe('validateReceiptFile(詳細設計書4.22章)', () => {
  it('拡張子とマジックナンバーが一致するPDF・JPEG・PNGを受け付け、jpegはjpgへ正規化する', () => {
    expect(validateReceiptFile(pdf, 'a.pdf')).toEqual({
      mimeType: 'application/pdf',
      extension: 'pdf'
    })
    expect(validateReceiptFile(jpeg, 'A.JPG')).toEqual({ mimeType: 'image/jpeg', extension: 'jpg' })
    expect(validateReceiptFile(jpeg, 'a.jpeg')).toEqual({
      mimeType: 'image/jpeg',
      extension: 'jpg'
    })
    expect(validateReceiptFile(png, 'a.png')).toEqual({ mimeType: 'image/png', extension: 'png' })
  })

  it('対応外の拡張子・内容との不一致・0バイトはtypeInvalid', () => {
    for (const [buf, name] of [
      [pdf, 'a.txt'],
      [pdf, 'noext'],
      [jpeg, 'a.png'],
      [png, 'a.pdf'],
      [Buffer.from('plain text'), 'a.pdf'],
      [Buffer.alloc(0), 'a.pdf']
    ] as const) {
      expect(() => validateReceiptFile(buf, name)).toThrow(
        new ReceiptValidationError('領収書として添付できるのは、PDF・JPEG・PNGのファイルです')
      )
    }
  })

  it('10MBを超えるとtooLarge、ちょうど10MBは許可する', () => {
    const limit = 10 * 1024 * 1024
    const ok = Buffer.concat([pdf, Buffer.alloc(limit - pdf.length)])
    expect(ok.length).toBe(limit)
    expect(() => validateReceiptFile(ok, 'a.pdf')).not.toThrow()
    expect(() => validateReceiptFile(Buffer.concat([ok, Buffer.alloc(1)]), 'a.pdf')).toThrow(
      '領収書は1ファイル10MBまでです'
    )
  })
})
