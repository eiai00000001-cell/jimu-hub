import type { ReactElement, ReactNode } from 'react'
import { Sidebar, type SidebarKey } from './Sidebar'

interface AppShellProps {
  screenName: string
  activeMenu: SidebarKey
  pageTitle: string
  pageTitleExtra?: ReactNode
  headerActions?: ReactNode
  onNavigateHome: () => void
  onNavigateClients: () => void
  onComingSoon: (label: string) => void
  children: ReactNode
}

/**
 * タイトルバー+サイドバー+コンテンツ領域からなる、macOSデスクトップアプリ風の共通レイアウト。
 * データ管理ダイアログ(エクスポート/復元)はページの遷移・再表示に影響されないよう、
 * App(ルート)側でこのコンポーネントの外側に重ねて表示する(App.tsx参照)。
 * 参照元: デザインガイド5.2章(画面名の表記・ヘッダー整列)
 */
export function AppShell({
  screenName,
  activeMenu,
  pageTitle,
  pageTitleExtra,
  headerActions,
  onNavigateHome,
  onNavigateClients,
  onComingSoon,
  children
}: AppShellProps): ReactElement {
  return (
    <div className="window">
      <div className="titlebar">
        <div className="titlebar-title">事務HUB - {screenName}</div>
      </div>
      <div className="app-body">
        <Sidebar
          active={activeMenu}
          onNavigateHome={onNavigateHome}
          onNavigateClients={onNavigateClients}
          onComingSoon={onComingSoon}
        />
        <div className="main">
          <div className="page-header">
            <div className="page-title-group">
              <h1 className="page-title">{pageTitle}</h1>
              {pageTitleExtra}
            </div>
            {headerActions}
          </div>
          <div className="page-content">{children}</div>
        </div>
      </div>
    </div>
  )
}
