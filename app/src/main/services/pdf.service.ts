import { BrowserWindow } from 'electron'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { Quote } from '@shared/types/quote'
import type { Invoice } from '@shared/types/invoice'
import type { CompanyProfile } from '@shared/types/company-profile'
import { buildQuotePdfHtml } from './pdf/quote-pdf-template'
import { buildInvoicePdfHtml } from './pdf/invoice-pdf-template'
import { escapeHtml, sanitizeFileNamePart } from './pdf/format'
import { newPdfTempFilePath } from './pdf/temp-files'

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

  /** 請求書PDFを生成し、ファイルへ書き込んだ上で保存先パス・SHA-256ハッシュ値を返す */
  async generateInvoicePdf(
    invoice: Invoice,
    companyProfile: CompanyProfile
  ): Promise<GeneratedPdfInfo> {
    const html = buildInvoicePdfHtml(invoice, companyProfile)
    const buffer = await this.renderHtmlToPdf(html, invoice.invoiceNumber ?? '', invoice.clientName)
    return this.writePdfFile(
      buffer,
      'invoices',
      invoice.issueDate,
      invoice.invoiceNumber,
      invoice.clientName
    )
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
    // 書類の内容を含む一時HTML。作成から削除までをtry/finallyで囲み、途中で例外が起きても必ず削除する
    // (異常終了で残った分は起動時に`cleanupLeftoverPdfTempFiles`が削除する。SEC-11)
    const tempFilePath = newPdfTempFilePath()
    let window: BrowserWindow | undefined
    try {
      writeFileSync(tempFilePath, html, 'utf-8')
      window = new BrowserWindow({
        show: false,
        webPreferences: { sandbox: true, contextIsolation: true, offscreen: true }
      })
      await window.loadFile(tempFilePath)
      const footerText = `${escapeHtml(documentNumber)} / ${escapeHtml(clientName)}`
      // ChromiumのprintToPDFヘッダー/フッターテンプレートは既定でセリフ体(明朝系)のフォントが
      // 適用されるため、本文と同じゴシック体(ヒラギノ角ゴ等)を明示的に指定する(ユーザー指摘によりT-20で修正)。
      const footerFontFamily =
        '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Helvetica Neue", Arial, sans-serif'
      return await window.webContents.printToPDF({
        pageSize: 'A4',
        printBackground: true,
        margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 },
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: `<div style="font-family: ${footerFontFamily}; font-size:8px; width:100%; text-align:center; color:#666666; margin: 0 24px;">${footerText}&nbsp;&nbsp;<span class="pageNumber"></span> / <span class="totalPages"></span> ページ</div>`
      })
    } finally {
      window?.destroy()
      rmSync(tempFilePath, { force: true })
    }
  }
}
