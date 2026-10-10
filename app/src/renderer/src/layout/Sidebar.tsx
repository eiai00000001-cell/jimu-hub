import type { ReactElement } from 'react'
import { Badge } from '../components/Badge'

export type SidebarKey = 'home' | 'clients' | 'projects' | 'documents' | 'cash'

const COMING_SOON_ITEMS = ['タスク・期限'] as const

interface SidebarProps {
  active: SidebarKey
  onNavigateHome: () => void
  onNavigateClients: () => void
  onNavigateProjects: () => void
  onNavigateDocuments: () => void
  onNavigateCash: () => void
  onComingSoon: (label: string) => void
}

/**
 * 画面左側のサイドメニュー。全画面で常時表示する(デザインガイド5.2章)。
 * 参照元: 基本設計書4.1章、詳細設計書3.1章
 */
export function Sidebar({
  active,
  onNavigateHome,
  onNavigateClients,
  onNavigateProjects,
  onNavigateDocuments,
  onNavigateCash,
  onComingSoon
}: SidebarProps): ReactElement {
  return (
    <div className="sidebar">
      <div className="sidebar-header">事務HUB</div>
      <ul className="sidebar-nav">
        <li>
          <button
            className={`sidebar-item${active === 'home' ? ' active' : ''}`}
            onClick={onNavigateHome}
          >
            <span>ホーム</span>
          </button>
        </li>
        <li>
          <button
            className={`sidebar-item${active === 'clients' ? ' active' : ''}`}
            onClick={onNavigateClients}
          >
            <span>取引先管理</span>
          </button>
        </li>
        <li>
          <button
            className={`sidebar-item${active === 'projects' ? ' active' : ''}`}
            onClick={onNavigateProjects}
          >
            <span>案件管理</span>
          </button>
        </li>
        <li>
          <button
            className={`sidebar-item${active === 'documents' ? ' active' : ''}`}
            onClick={onNavigateDocuments}
          >
            <span>見積書・請求書</span>
          </button>
        </li>
        <li>
          <button
            className={`sidebar-item${active === 'cash' ? ' active' : ''}`}
            onClick={onNavigateCash}
          >
            <span>入出金・経費</span>
          </button>
        </li>
        {COMING_SOON_ITEMS.map((label) => (
          <li key={label}>
            <button className="sidebar-item disabled" onClick={() => onComingSoon(label)}>
              <span>{label}</span>
              <Badge variant="soon" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
