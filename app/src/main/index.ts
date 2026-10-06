import { app, BrowserWindow, session } from 'electron'
import { dirname, join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { ClientRepository } from './repositories/client.repository'
import { ClientService } from './services/client.service'
import { BackupService } from './services/backup.service'
import { BackupStagingArea } from './services/backup/staging-area'
import { MigrationService } from './services/migration.service'
import { CompanyProfileRepository } from './repositories/company-profile.repository'
import { CompanyService } from './services/company.service'
import { DocumentNumberSequenceRepository } from './repositories/document-number-sequence.repository'
import { QuoteRepository } from './repositories/quote.repository'
import { InvoiceRepository } from './repositories/invoice.repository'
import { InvoiceService } from './services/invoice.service'
import { NumberingService } from './services/numbering.service'
import { cleanupLeftoverPdfTempFiles } from './services/pdf/temp-files'
import { PdfService } from './services/pdf.service'
import { QuoteService } from './services/quote.service'
import { AccountsIpcHandler } from './ipc/accounts.ipc-handler'
import { AccountService } from './services/account.service'
import { AccountRepository } from './repositories/account.repository'
import { ReportsIpcHandler } from './ipc/reports.ipc-handler'
import { SummaryRepository } from './repositories/summary.repository'
import { CashRecordRepository } from './repositories/cash-record.repository'
import { CsvExportService } from './services/csv-export.service'
import { SummaryService } from './services/summary.service'
import { ReceiptsIpcHandler } from './ipc/receipts.ipc-handler'
import { RecordsIpcHandler } from './ipc/records.ipc-handler'
import { createRecordServices } from './services/record-services'
import { ClientIpcHandler } from './ipc/client.ipc-handler'
import { DataIpcHandler } from './ipc/data.ipc-handler'
import { AppIpcHandler } from './ipc/app.ipc-handler'
import { CompanyIpcHandler } from './ipc/company.ipc-handler'
import { QuotesIpcHandler } from './ipc/quotes.ipc-handler'
import { InvoicesIpcHandler } from './ipc/invoices.ipc-handler'
import { StartupRecoveryService } from './services/startup-recovery.service'
import { initializeStartup } from './startup'
import { applyWindowSecurity, denyAllPermissionRequests, readDevOnlyEnv } from './app-security'

/**
 * データの保存場所。
 * 通常は `~/Library/Application Support/事務HUB` (基本設計書3章)。
 * E2Eテスト・見るだけ実行時のみ、環境変数 `JIMUHUB_DATA_DIR` でテスト専用ディレクトリに切り替える。
 * 配布版(パッケージ済み)では環境変数を無視する(セキュリティチェック結果報告書 v0.0 SEC-01)。
 */
const devDataDir = readDevOnlyEnv('JIMUHUB_DATA_DIR', app.isPackaged)
const userDataDir = devDataDir ?? app.getPath('userData')
mkdirSync(userDataDir, { recursive: true })
if (devDataDir) {
  app.setPath('userData', userDataDir)
}

const dbFilePath = join(userDataDir, 'data.sqlite')
const backupsDir = join(userDataDir, 'backups')
const documentsDir = join(userDataDir, 'documents')

function createMainWindow(): BrowserWindow {
  const shouldShow = process.env.JIMUHUB_WINDOW_SHOW !== '0'

  const mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    show: shouldShow,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Electron公式が推奨する多層防御の観点でsandboxを有効化する(レビュー結果報告書 v0.0 No.4)。
      // preload(src/preload/index.ts)は`electron`パッケージのみに依存しNode.js組み込みモジュールへの
      // 直接依存が無いため、sandbox: trueでもcontextBridge経由のAPI呼び出しは問題なく動作する
      // (E2Eテスト e2e/tests/*.spec.ts で動作確認済み)。
      sandbox: true
    }
  })

  applyWindowSecurity(mainWindow.webContents)

  // 開発サーバーのURL(electron-vite devが設定)は未パッケージ時のみ使用する(SEC-01)
  const rendererUrl = readDevOnlyEnv('ELECTRON_RENDERER_URL', app.isPackaged)
  if (rendererUrl) {
    mainWindow.loadURL(rendererUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

app.whenReady().then(() => {
  denyAllPermissionRequests(session.defaultSession)

  // 異常終了で残ったPDF生成用の一時HTML(書類の内容を含む)を削除する(SEC-11)
  cleanupLeftoverPdfTempFiles()

  // 異常終了で残ったバックアップ・復元用の一時フォルダ(データの一部を含む)を削除する(F-32。詳細設計書4.1章手順0-2)
  new BackupStagingArea(join(dirname(dbFilePath), 'tmp')).removeLeftovers()

  // BUG-01修正: データベース接続の初期化(コンストラクタ時点の例外を含む)は
  // initializeStartup()内でtry/catchされ、例外を外へ投げない(startup.ts参照)。
  // これにより、データベースファイル破損時もここで処理が中断されず、必ずcreateMainWindow()まで到達する。
  const { status: startupStatus, database } = initializeStartup(dbFilePath)

  new AppIpcHandler(startupStatus).registerHandlers()

  if (!database) {
    // データベースを開けない場合は、起動エラー画面から復元(F-03と同一のimportData)できるようにする(F-09)
    new DataIpcHandler(
      new StartupRecoveryService({
        dbFilePath,
        backupsDir,
        documentsDir,
        appVersion: app.getVersion()
      })
    ).registerHandlers()
  }

  if (database) {
    const clientRepository = new ClientRepository(database)
    const clientService = new ClientService(clientRepository)
    const backupService = new BackupService({
      database,
      clientRepository,
      migrationService: new MigrationService(),
      dbFilePath,
      backupsDir,
      documentsDir,
      appVersion: app.getVersion()
    })

    const companyProfileRepository = new CompanyProfileRepository(database)
    const companyService = new CompanyService(companyProfileRepository)

    const quoteRepository = new QuoteRepository(database)
    const numberingService = new NumberingService(new DocumentNumberSequenceRepository(database))
    const pdfService = new PdfService({ documentsDir })
    const quoteService = new QuoteService({
      database,
      repository: quoteRepository,
      companyProfileRepository,
      numberingService,
      pdfService
    })

    const recordServices = createRecordServices(database, documentsDir)
    const invoiceService = new InvoiceService({
      database,
      repository: new InvoiceRepository(database),
      quoteRepository,
      companyProfileRepository,
      numberingService,
      pdfService,
      paymentRecorder: recordServices.cashRecordService
    })

    new ClientIpcHandler(clientService).registerHandlers()
    new ReportsIpcHandler(
      new SummaryService(new SummaryRepository(database)),
      new CsvExportService(new CashRecordRepository(database))
    ).registerHandlers()
    new ReceiptsIpcHandler(
      recordServices.receiptService,
      recordServices.receiptRepository,
      documentsDir
    ).registerHandlers()
    new RecordsIpcHandler(
      recordServices.cashRecordService,
      recordServices.historyService
    ).registerHandlers()
    new AccountsIpcHandler(new AccountService(new AccountRepository(database))).registerHandlers()
    new DataIpcHandler(backupService).registerHandlers()
    new CompanyIpcHandler(companyService).registerHandlers()
    new QuotesIpcHandler(quoteService, invoiceService, documentsDir).registerHandlers()
    new InvoicesIpcHandler(invoiceService, documentsDir).registerHandlers()
  }

  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
