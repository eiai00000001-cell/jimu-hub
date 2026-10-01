import { useEffect, useState, type ReactElement } from 'react'
import { TopPage } from './pages/TopPage'
import { ClientListPage } from './pages/ClientListPage'
import { ClientFormPage } from './pages/ClientFormPage'
import { ClientDetailPage } from './pages/ClientDetailPage'
import { CompanyProfilePage } from './pages/CompanyProfilePage'
import { DocumentListPage } from './pages/DocumentListPage'
import { QuoteFormPage } from './pages/QuoteFormPage'
import { QuoteDetailPage } from './pages/QuoteDetailPage'
import { InvoiceFormPage } from './pages/InvoiceFormPage'
import { StartupErrorPage } from './pages/StartupErrorPage'
import { InvoiceDetailPage } from './pages/InvoiceDetailPage'
import { ExportDialog } from './components/ExportDialog'
import { ImportDialog } from './components/ImportDialog'
import {
  CLIENT_MESSAGES,
  COMPANY_MESSAGES,
  QUOTE_MESSAGES,
  INVOICE_MESSAGES
} from '@shared/messages/messages'
import type { StartupStatus } from '@shared/ipc/api'

/** 自社情報・振込先設定画面(companyProfile)への遷移元。保存完了後にこの画面へ戻る(詳細設計書4.10章手順6) */
type CompanyProfileReturnTo =
  | { name: 'quoteNew' }
  | { name: 'quoteEdit'; id: number }
  | { name: 'invoiceNew' }
  | { name: 'invoiceEdit'; id: number }

type Route =
  | { name: 'top' }
  | { name: 'clientList'; flashMessage?: string }
  | { name: 'clientNew' }
  | { name: 'clientDetail'; id: number; flashMessage?: string }
  | { name: 'clientEdit'; id: number }
  | { name: 'companyProfile'; returnTo?: CompanyProfileReturnTo }
  | { name: 'documentList' }
  | { name: 'quoteNew'; flashMessage?: string }
  | { name: 'quoteEdit'; id: number; flashMessage?: string }
  | { name: 'quoteDetail'; id: number; flashMessage?: string }
  | { name: 'invoiceNew'; flashMessage?: string }
  | { name: 'invoiceEdit'; id: number; flashMessage?: string }
  | { name: 'invoiceDetail'; id: number; flashMessage?: string }

type DataDialog = 'none' | 'export' | 'import'

/**
 * ルーティング(画面遷移)を担うアプリのルートコンポーネント。
 * 参照元: 基本設計書4.8章(画面遷移図)
 */
export function App(): ReactElement {
  const [startupStatus, setStartupStatus] = useState<StartupStatus | null>(null)
  const [route, setRoute] = useState<Route>({ name: 'top' })
  const [dialog, setDialog] = useState<DataDialog>('none')
  const [homeRefreshKey, setHomeRefreshKey] = useState(0)

  useEffect(() => {
    window.jimuhubApi.getStartupStatus().then(setStartupStatus)
  }, [])

  if (startupStatus === null) {
    return <div className="startup-error" />
  }

  if (!startupStatus.ok) {
    return <StartupErrorPage message={startupStatus.message} />
  }

  return (
    <>
      {renderRoute()}
      {/*
        データ管理ダイアログ(エクスポート/復元)は、画面遷移・再取得の影響を受けないよう
        ルーティングされるページの外側(兄弟要素)として重ねて表示する。
        こうすることで、復元成功時に裏側のホーム画面を再取得しても、
        ダイアログ自身の完了メッセージ表示が消えてしまわない。
      */}
      {dialog === 'export' ? <ExportDialog onClose={() => setDialog('none')} /> : null}
      {dialog === 'import' ? (
        <ImportDialog
          onClose={() => setDialog('none')}
          // 復元成功時は詳細設計書4.3章のとおり画面の表示を最新化する
          onImported={() => setHomeRefreshKey((key) => key + 1)}
        />
      ) : null}
    </>
  )

  function renderRoute(): ReactElement {
    switch (route.name) {
      case 'top':
        return (
          <TopPage
            key={homeRefreshKey}
            onNavigateClients={() => setRoute({ name: 'clientList' })}
            onNavigateDocuments={() => setRoute({ name: 'documentList' })}
            onOpenExportDialog={() => setDialog('export')}
            onOpenImportDialog={() => setDialog('import')}
            onNavigateCompanyProfile={() => setRoute({ name: 'companyProfile' })}
          />
        )
      case 'clientList':
        return (
          <ClientListPage
            flashMessage={route.flashMessage}
            onNavigateHome={() => setRoute({ name: 'top' })}
            onNavigateDocuments={() => setRoute({ name: 'documentList' })}
            onNewClient={() => setRoute({ name: 'clientNew' })}
            onSelectClient={(id) => setRoute({ name: 'clientDetail', id })}
          />
        )
      case 'clientNew':
        return (
          <ClientFormPage
            mode="new"
            onCreated={() =>
              setRoute({ name: 'clientList', flashMessage: CLIENT_MESSAGES.createSuccess })
            }
            onUpdated={() => {}}
            onCancel={() => setRoute({ name: 'clientList' })}
          />
        )
      case 'clientDetail':
        return (
          <ClientDetailPage
            key={route.id}
            clientId={route.id}
            flashMessage={route.flashMessage}
            onNavigateHome={() => setRoute({ name: 'top' })}
            onBackToList={() => setRoute({ name: 'clientList' })}
            onEdit={(id) => setRoute({ name: 'clientEdit', id })}
            onDeactivated={(id) =>
              setRoute({
                name: 'clientDetail',
                id,
                flashMessage: CLIENT_MESSAGES.deactivateSuccess
              })
            }
          />
        )
      case 'clientEdit':
        return (
          <ClientFormPage
            mode="edit"
            clientId={route.id}
            onCreated={() => {}}
            onUpdated={(id) =>
              setRoute({ name: 'clientDetail', id, flashMessage: CLIENT_MESSAGES.updateSuccess })
            }
            onCancel={() => setRoute({ name: 'clientDetail', id: route.id })}
          />
        )
      case 'companyProfile': {
        const returnTo = route.returnTo
        return (
          <CompanyProfilePage
            onNavigateHome={() => setRoute({ name: 'top' })}
            onNavigateClients={() => setRoute({ name: 'clientList' })}
            onNavigateDocuments={() => setRoute({ name: 'documentList' })}
            onSaved={
              returnTo
                ? () => setRoute({ ...returnTo, flashMessage: COMPANY_MESSAGES.saveSuccess })
                : undefined
            }
          />
        )
      }
      case 'documentList':
        return (
          <DocumentListPage
            onNavigateHome={() => setRoute({ name: 'top' })}
            onNavigateClients={() => setRoute({ name: 'clientList' })}
            onNewQuote={() => setRoute({ name: 'quoteNew' })}
            onSelectQuote={(id) => setRoute({ name: 'quoteDetail', id })}
            onNewInvoice={() => setRoute({ name: 'invoiceNew' })}
            onSelectInvoice={(id) => setRoute({ name: 'invoiceDetail', id })}
          />
        )
      case 'quoteNew':
        return (
          <QuoteFormPage
            mode="new"
            flashMessage={route.flashMessage}
            onSavedDraft={(id) =>
              setRoute({ name: 'quoteDetail', id, flashMessage: QUOTE_MESSAGES.draftSaveSuccess })
            }
            onFinalized={(id) =>
              setRoute({ name: 'quoteDetail', id, flashMessage: QUOTE_MESSAGES.finalizeSuccess })
            }
            onCancel={() => setRoute({ name: 'documentList' })}
            onNavigateCompanyProfile={() =>
              setRoute({ name: 'companyProfile', returnTo: { name: 'quoteNew' } })
            }
          />
        )
      case 'quoteEdit':
        return (
          <QuoteFormPage
            mode="edit"
            quoteId={route.id}
            flashMessage={route.flashMessage}
            onSavedDraft={(id) =>
              setRoute({ name: 'quoteDetail', id, flashMessage: QUOTE_MESSAGES.draftSaveSuccess })
            }
            onFinalized={(id) =>
              setRoute({ name: 'quoteDetail', id, flashMessage: QUOTE_MESSAGES.finalizeSuccess })
            }
            onCancel={() => setRoute({ name: 'quoteDetail', id: route.id })}
            onNavigateCompanyProfile={() =>
              setRoute({ name: 'companyProfile', returnTo: { name: 'quoteEdit', id: route.id } })
            }
          />
        )
      case 'quoteDetail':
        return (
          <QuoteDetailPage
            key={route.id}
            quoteId={route.id}
            flashMessage={route.flashMessage}
            onNavigateHome={() => setRoute({ name: 'top' })}
            onNavigateClients={() => setRoute({ name: 'clientList' })}
            onBackToList={() => setRoute({ name: 'documentList' })}
            onEdit={(id) => setRoute({ name: 'quoteEdit', id })}
            onConvertedToInvoice={(invoiceId) =>
              setRoute({
                name: 'invoiceDetail',
                id: invoiceId,
                flashMessage: INVOICE_MESSAGES.convertSuccess
              })
            }
          />
        )
      case 'invoiceNew':
        return (
          <InvoiceFormPage
            mode="new"
            flashMessage={route.flashMessage}
            onSavedDraft={(id) =>
              setRoute({
                name: 'invoiceDetail',
                id,
                flashMessage: INVOICE_MESSAGES.draftSaveSuccess
              })
            }
            onFinalized={(id) =>
              setRoute({
                name: 'invoiceDetail',
                id,
                flashMessage: INVOICE_MESSAGES.finalizeSuccess
              })
            }
            onCancel={() => setRoute({ name: 'documentList' })}
            onNavigateCompanyProfile={() =>
              setRoute({ name: 'companyProfile', returnTo: { name: 'invoiceNew' } })
            }
          />
        )
      case 'invoiceEdit':
        return (
          <InvoiceFormPage
            mode="edit"
            invoiceId={route.id}
            flashMessage={route.flashMessage}
            onSavedDraft={(id) =>
              setRoute({
                name: 'invoiceDetail',
                id,
                flashMessage: INVOICE_MESSAGES.draftSaveSuccess
              })
            }
            onFinalized={(id) =>
              setRoute({
                name: 'invoiceDetail',
                id,
                flashMessage: INVOICE_MESSAGES.finalizeSuccess
              })
            }
            onCancel={() => setRoute({ name: 'invoiceDetail', id: route.id })}
            onOpenSourceQuote={(quoteId) => setRoute({ name: 'quoteDetail', id: quoteId })}
            onNavigateCompanyProfile={() =>
              setRoute({ name: 'companyProfile', returnTo: { name: 'invoiceEdit', id: route.id } })
            }
          />
        )
      case 'invoiceDetail':
        return (
          <InvoiceDetailPage
            key={route.id}
            invoiceId={route.id}
            flashMessage={route.flashMessage}
            onNavigateHome={() => setRoute({ name: 'top' })}
            onNavigateClients={() => setRoute({ name: 'clientList' })}
            onBackToList={() => setRoute({ name: 'documentList' })}
            onEdit={(id) => setRoute({ name: 'invoiceEdit', id })}
            onOpenQuote={(quoteId) => setRoute({ name: 'quoteDetail', id: quoteId })}
          />
        )
      default:
        return (
          <TopPage
            onNavigateClients={() => setRoute({ name: 'clientList' })}
            onNavigateDocuments={() => setRoute({ name: 'documentList' })}
            onOpenExportDialog={() => setDialog('export')}
            onOpenImportDialog={() => setDialog('import')}
            onNavigateCompanyProfile={() => setRoute({ name: 'companyProfile' })}
          />
        )
    }
  }
}
