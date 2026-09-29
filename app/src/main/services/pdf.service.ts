import { BrowserWindow } from 'electron'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Quote } from '@shared/types/quote'
import type { CompanyProfile } from '@shared/types/company-profile'
import { buildQuotePdfHtml } from './pdf/quote-pdf-template'
import { escapeHtml, sanitizeFileNamePart } from './pdf/format'

export interface GeneratedPdfInfo {
  pdfPath: string
  pdfHash: string
}

export interface PdfServiceDeps {
  /** PDFファイルの保存先ルート(通常 `~/Library/Application Support/事務HUB/documents`) */
  documentsDir: string
}

/**
 * 見積書・請求書のPDF生成(`webContents.printToPDF()`)・保存・ハッシュ算出を担うApplication Service層。
 * 参照元: 詳細設計書 4.12章手順8〜9、5章(クラス設計 `PdfService`)、基本設計書2.2章★C1・★C3・★C7
 *
 * HTML/CSSは既存のReact画面コンポーネントではなく、PDF専用のテンプレート(`pdf/`配下)を用いる。
 * PDF出力はMainプロセス単独で完結する処理であり、Rendererの対話的なUIコンポーネント一式を
 * Main側で再利用するには追加のビルド設定変更が必要になるため、既に確定済みの方式
 * (Electron標準printToPDFでHTML/CSSをPDF化する。基本設計書2.2章★C1)に対し、
 * テンプレートをMain側に独立して持つ、より単純な構成とした(README「詳細設計書との差異」参照)。
 */
export class PdfService {
  constructor(private readonly deps: PdfServiceDeps) {}

  /** 見積書PDFを生成し、ファイルへ書き込んだ上で保存先パス・SHA-256ハッシュ値を返す */
  async generateQuotePdf(quote: Quote, companyProfile: CompanyProfile): Promise<GeneratedPdfInfo> {
    const html = buildQuotePdfHtml(quote, companyProfile)
    const buffer = await this.renderHtmlToPdf(html, quote.quoteNumber ?? '', quote.clientName)
    return this.writePdfFile(buffer, 'quotes', quote.issueDate, quote.quoteNumber, quote.clientName)
  }

  /** PDFファイルを書き込み、保存先パス・SHA-256ハッシュ値を返す(共通処理。請求書PDFからも利用する想定) */
  private writePdfFile(
    buffer: Buffer,
    kind: 'quotes' | 'invoices',
    issueDate: string,
    documentNumber: string | null,
    clientName: string
  ): GeneratedPdfInfo {
    const year = issueDate.slice(0, 4)
    const fileName = `${sanitizeFileNamePart(documentNumber ?? '未採番')}_${sanitizeFileNamePart(clientName)}.pdf`
    const dir = join(this.deps.documentsDir, kind, year)
    mkdirSync(dir, { recursive: true })
    const pdfPath = join(dir, fileName)
    writeFileSync(pdfPath, buffer)
    const pdfHash = createHash('sha256').update(buffer).digest('hex')
    return { pdfPath, pdfHash }
  }

  /**
   * HTML文字列を、非表示の`BrowserWindow`でレンダリングした上でPDFバッファ化する(基本設計書2.2章★C1)。
   * 書類番号・取引先名は、複数ページにまたがる場合のフッター(`footerTemplate`)に繰り返し表示する
   * (基本設計書4.15章「2ページ目以降にも書類番号・取引先名をヘッダーに繰り返し表示する」の実現方式として、
   * Chromiumの`printToPDF`が対応する`footerTemplate`〔`pageNumber`/`totalPages`プレースホルダ対応〕を用いる。
   * Chromiumは`@page`CSSのマージンボックスによるヘッダー/フッター表示に対応していないための代替実装であり、
   * README「詳細設計書との差異」に記録する)。
   */
  private async renderHtmlToPdf(
    html: string,
    documentNumber: string,
    clientName: string
  ): Promise<Buffer> {
    const tempFilePath = join(tmpdir(), `jimuhub-pdf-${randomBytes(6).toString('hex')}.html`)
    writeFileSync(tempFilePath, html, 'utf-8')

    const window = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, offscreen: true }
    })

    try {
      await window.loadFile(tempFilePath)
      const footerText = `${escapeHtml(documentNumber)} / ${escapeHtml(clientName)}`
      return await window.webContents.printToPDF({
        pageSize: 'A4',
        printBackground: true,
        margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 },
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: `<div style="font-size:8px; width:100%; text-align:center; color:#666666; margin: 0 24px;">${footerText}&nbsp;&nbsp;<span class="pageNumber"></span> / <span class="totalPages"></span> ページ</div>`
      })
    } finally {
      window.destroy()
      rmSync(tempFilePath, { force: true })
    }
  }
}
