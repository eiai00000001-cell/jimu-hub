import type { JimuhubApi } from '@shared/ipc/api'

declare global {
  interface Window {
    jimuhubApi: JimuhubApi
  }
}

export {}
