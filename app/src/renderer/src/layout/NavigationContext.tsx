import { createContext } from 'react'

/** サイドバーの遷移先。各ページが個別に指定しない場合の既定(App側が提供する) */
export interface NavigationActions {
  goHome: () => void
  goClients: () => void
  goDocuments: () => void
}

const noop = (): void => {}

export const NavigationContext = createContext<NavigationActions>({
  goHome: noop,
  goClients: noop,
  goDocuments: noop
})
