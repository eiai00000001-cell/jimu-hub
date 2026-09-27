import { describe, expect, it, vi } from 'vitest'
import { applyWindowSecurity, denyAllPermissionRequests, readDevOnlyEnv } from './app-security'

describe('readDevOnlyEnv', () => {
  it('未パッケージ(開発・E2Eテスト)の場合は環境変数の値を返す', () => {
    expect(readDevOnlyEnv('JIMUHUB_DATA_DIR', false, { JIMUHUB_DATA_DIR: '/tmp/x' })).toBe('/tmp/x')
  })

  it('パッケージ済み(配布版)の場合は環境変数が設定されていても無視する', () => {
    expect(readDevOnlyEnv('JIMUHUB_DATA_DIR', true, { JIMUHUB_DATA_DIR: '/tmp/x' })).toBeUndefined()
  })

  it('未設定・空文字の場合はundefinedを返す', () => {
    expect(readDevOnlyEnv('JIMUHUB_DATA_DIR', false, {})).toBeUndefined()
    expect(readDevOnlyEnv('JIMUHUB_DATA_DIR', false, { JIMUHUB_DATA_DIR: '' })).toBeUndefined()
  })
})

type NavigateListener = (event: { preventDefault: () => void }, url: string) => void

function createFakeWebContents(currentUrl: string) {
  const listeners = new Map<string, NavigateListener>()
  let windowOpenHandler: (() => { action: string }) | undefined
  return {
    getURL: () => currentUrl,
    on: vi.fn((name: string, listener: NavigateListener) => {
      listeners.set(name, listener)
    }),
    setWindowOpenHandler: vi.fn((handler: () => { action: string }) => {
      windowOpenHandler = handler
    }),
    emitWillNavigate(url: string) {
      const event = { preventDefault: vi.fn() }
      listeners.get('will-navigate')?.(event, url)
      return event
    },
    openWindow() {
      return windowOpenHandler?.()
    }
  }
}

describe('applyWindowSecurity', () => {
  it('新しいウィンドウの作成要求(window.open等)をすべて拒否する', () => {
    const webContents = createFakeWebContents('file:///app/index.html')
    applyWindowSecurity(webContents as never)

    expect(webContents.openWindow()).toEqual({ action: 'deny' })
  })

  it('現在の画面と異なるURLへの遷移を中止する', () => {
    const webContents = createFakeWebContents('file:///app/index.html')
    applyWindowSecurity(webContents as never)

    const event = webContents.emitWillNavigate('https://example.com/')

    expect(event.preventDefault).toHaveBeenCalled()
  })

  it('現在の画面と同じURL(再読み込み)は中止しない', () => {
    const webContents = createFakeWebContents('file:///app/index.html')
    applyWindowSecurity(webContents as never)

    const event = webContents.emitWillNavigate('file:///app/index.html')

    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})

describe('denyAllPermissionRequests', () => {
  it('カメラ・通知等の権限要求をすべて拒否する', () => {
    let handler:
      ((wc: unknown, permission: string, callback: (granted: boolean) => void) => void) | undefined
    const session = {
      setPermissionRequestHandler: vi.fn((h: typeof handler) => {
        handler = h
      })
    }
    denyAllPermissionRequests(session as never)

    const callback = vi.fn()
    handler?.({}, 'media', callback)

    expect(callback).toHaveBeenCalledWith(false)
  })
})
