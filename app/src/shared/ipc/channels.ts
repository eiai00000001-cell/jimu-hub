/**
 * IPCチャンネル名の一元管理。
 * 参照元: 詳細設計書 7章(API/インターフェース設計)
 *
 * `appStartupStatus`のみ、7章のAPI一覧表には明示されていない追加チャンネルである。
 * 詳細設計書4.1章手順5・8章(起動時のデータベース接続失敗時のエラー表示)を実現するために必要な、
 * 起動処理の結果をRendererへ伝える最小限のチャンネルとして追加した(README「詳細設計書との差異」参照)。
 */
export const IPC_CHANNELS = {
  clientsList: 'clients:list',
  clientsGet: 'clients:get',
  clientsCreate: 'clients:create',
  clientsUpdate: 'clients:update',
  clientsDeactivate: 'clients:deactivate',
  dataExport: 'data:export',
  dataImport: 'data:import',
  appStartupStatus: 'app:startup-status',
  companyGet: 'company:get',
  companySave: 'company:save',
  quotesList: 'quotes:list',
  quotesGet: 'quotes:get',
  quotesSaveDraft: 'quotes:saveDraft',
  quotesFinalize: 'quotes:finalize',
  quotesOpenPdf: 'quotes:openPdf',
  quotesShowPdfInFolder: 'quotes:showPdfInFolder',
  invoicesList: 'invoices:list',
  invoicesGet: 'invoices:get',
  invoicesSaveDraft: 'invoices:saveDraft',
  invoicesFinalize: 'invoices:finalize',
  invoicesOpenPdf: 'invoices:openPdf',
  invoicesShowPdfInFolder: 'invoices:showPdfInFolder'
} as const
