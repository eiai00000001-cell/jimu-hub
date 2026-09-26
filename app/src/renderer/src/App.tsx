import { useEffect, useState, type ReactElement } from 'react'
import { TopPage } from './pages/TopPage'
import { ClientListPage } from './pages/ClientListPage'
import { ClientFormPage } from './pages/ClientFormPage'
import { ClientDetailPage } from './pages/ClientDetailPage'
import { ExportDialog } from './components/ExportDialog'
import { ImportDialog } from './components/ImportDialog'
import { CLIENT_MESSAGES } from '@shared/messages/messages'
import type { StartupStatus } from '@shared/ipc/api'

type Route =
  | { name: 'top' }
  | { name: 'clientList'; flashMessage?: string }
  | { name: 'clientNew' }
  | { name: 'clientDetail'; id: number; flashMessage?: string }
  | { name: 'clientEdit'; id: number }

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
    return <div className="startup-error">{startupStatus.message}</div>
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
            onOpenExportDialog={() => setDialog('export')}
            onOpenImportDialog={() => setDialog('import')}
          />
        )
      case 'clientList':
        return (
          <ClientListPage
            flashMessage={route.flashMessage}
            onNavigateHome={() => setRoute({ name: 'top' })}
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
      default:
        return (
          <TopPage
            onNavigateClients={() => setRoute({ name: 'clientList' })}
            onOpenExportDialog={() => setDialog('export')}
            onOpenImportDialog={() => setDialog('import')}
          />
        )
    }
  }
}
