import { useContext, useState, type ReactElement, type ReactNode } from 'react'
import { Sidebar, type SidebarKey } from './Sidebar'
import { Message } from '../components/Message'
import { NavigationContext } from './NavigationContext'

interface AppShellProps {
  screenName: string
  activeMenu: SidebarKey
  pageTitle: string
  pageTitleExtra?: ReactNode
  headerActions?: ReactNode
  /** サイドバーの遷移先。未指定の場合はNavigationContext(App側)の既定の遷移を使う */
  onNavigateHome?: () => void
  onNavigateClients?: () => void
  onNavigateDocuments?: () => void
  onNavigateCash?: () => void
  /** 「準備中」メニュー押下時の処理。未指定の場合はAppShellが案内メッセージを表示する */
  onComingSoon?: (label: string) => void
  /** 入力中の画面などで、サイドバーによる遷移の前に確認する場合に指定する(falseを返すと遷移しない) */
  confirmLeave?: () => boolean
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
  onNavigateDocuments,
  onNavigateCash,
  onComingSoon,
  confirmLeave,
  children
}: AppShellProps): ReactElement {
  const navigation = useContext(NavigationContext)
  const [comingSoonLabel, setComingSoonLabel] = useState<string | null>(null)
  const guarded = (action: () => void) => (): void => {
    if (confirmLeave && !confirmLeave()) {
      return
    }
    action()
  }
  return (
    <div className="window">
      <div className="titlebar">
        <div className="titlebar-title">事務HUB - {screenName}</div>
      </div>
      <div className="app-body">
        <Sidebar
          active={activeMenu}
          onNavigateHome={guarded(onNavigateHome ?? navigation.goHome)}
          onNavigateClients={guarded(onNavigateClients ?? navigation.goClients)}
          onNavigateDocuments={guarded(onNavigateDocuments ?? navigation.goDocuments)}
          onNavigateCash={guarded(onNavigateCash ?? navigation.goCash)}
          onComingSoon={onComingSoon ?? setComingSoonLabel}
        />
        <div className="main">
          <div className="page-header">
            <div className="page-title-group">
              <h1 className="page-title">{pageTitle}</h1>
              {pageTitleExtra}
            </div>
            {headerActions}
          </div>
          <div className="page-content">
            {!onComingSoon && comingSoonLabel ? (
              <Message variant="warning">
                「{comingSoonLabel}」は以降のイテレーションで実装予定です。
              </Message>
            ) : null}
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
