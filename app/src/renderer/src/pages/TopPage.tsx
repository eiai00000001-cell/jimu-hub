import { useEffect, useState, type ReactElement } from 'react'
import { AppShell } from '../layout/AppShell'
import { Button } from '../components/Button'

interface TopPageProps {
  onNavigateClients: () => void
  onNavigateDocuments: () => void
  onOpenExportDialog: () => void
  onOpenImportDialog: () => void
  onNavigateCompanyProfile: () => void
}

/**
 * トップ画面(ダッシュボード)[F-01]
 * 参照元: 基本設計書4.1章、詳細設計書3.1章・4.1章
 *
 * 請求書件数・未収の請求書件数は、請求書機能(T-20)実装後に追加する。
 */
export function TopPage({
  onNavigateClients,
  onNavigateDocuments,
  onOpenExportDialog,
  onOpenImportDialog,
  onNavigateCompanyProfile
}: TopPageProps): ReactElement {
  const [activeClientCount, setActiveClientCount] = useState<number | null>(null)
  const [quoteCount, setQuoteCount] = useState<number | null>(null)
  const [comingSoonLabel, setComingSoonLabel] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.jimuhubApi.listClients({ statusFilter: 'active' }).then((clients) => {
      if (!cancelled) {
        setActiveClientCount(clients.length)
      }
    })
    window.jimuhubApi.listQuotes().then((quotes) => {
      if (!cancelled) {
        setQuoteCount(quotes.length)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <AppShell
      screenName="ホーム"
      activeMenu="home"
      pageTitle="ホーム"
      headerActions={
        <div className="data-menu">
          <span className="data-menu-label">データ管理</span>
          <Button onClick={onOpenExportDialog}>データをエクスポート</Button>
          <Button onClick={onOpenImportDialog}>データを復元</Button>
          <Button onClick={onNavigateCompanyProfile}>自社情報・振込先の設定</Button>
        </div>
      }
      onNavigateHome={() => {}}
      onNavigateClients={onNavigateClients}
      onNavigateDocuments={onNavigateDocuments}
      onComingSoon={(label) => setComingSoonLabel(label)}
    >
      <div className="summary-row">
        <div className="summary-card">
          <div className="summary-value">
            {activeClientCount === null ? '-' : `${activeClientCount}件`}
          </div>
          <div className="summary-label">取引先登録件数(利用中)</div>
        </div>
        <div className="summary-card">
          <div className="summary-value">{quoteCount === null ? '-' : `${quoteCount}件`}</div>
          <div className="summary-label">見積書件数</div>
        </div>
      </div>
      <p className="section-note">
        左のサイドメニューから機能を選択してください。「準備中」の項目は、以降のイテレーションで順次利用可能になります。
      </p>
      {comingSoonLabel ? (
        <p className="section-note">「{comingSoonLabel}」は以降のイテレーションで実装予定です。</p>
      ) : null}
    </AppShell>
  )
}
