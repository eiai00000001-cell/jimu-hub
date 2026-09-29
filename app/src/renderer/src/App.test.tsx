// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from './App'
import type { Client } from '@shared/types/client'

const sampleClient: Client = {
  id: 1,
  name: 'アルファ商事株式会社',
  furigana: 'アルファショウジカブシキガイシャ',
  honorific: '御中',
  contactPerson: null,
  postalCode: null,
  address: null,
  phone: null,
  email: null,
  invoiceRegistrationNumber: null,
  memo: null,
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

function setupApi(): void {
  window.jimuhubApi = {
    getStartupStatus: vi.fn().mockResolvedValue({ ok: true }),
    listClients: vi.fn().mockResolvedValue([sampleClient]),
    getClient: vi.fn().mockResolvedValue(sampleClient),
    createClient: vi.fn().mockResolvedValue({ id: 2 }),
    updateClient: vi.fn().mockResolvedValue({ success: true }),
    deactivateClient: vi.fn().mockResolvedValue({ success: true }),
    exportData: vi.fn(),
    importData: vi.fn(),
    getCompanyProfile: vi.fn().mockResolvedValue(null),
    saveCompanyProfile: vi.fn().mockResolvedValue({ success: true })
  } as unknown as Window['jimuhubApi']
}

describe('App', () => {
  beforeEach(() => {
    setupApi()
  })

  it('起動時にデータベース接続エラーがある場合は起動エラー画面を表示する', async () => {
    window.jimuhubApi.getStartupStatus = vi
      .fn()
      .mockResolvedValue({ ok: false, message: 'データを読み込めませんでした' })
    render(<App />)

    expect(await screen.findByText('データを読み込めませんでした')).toBeInTheDocument()
  })

  it('ホーム→取引先一覧→詳細→編集→保存で詳細画面へ戻る', async () => {
    render(<App />)

    await userEvent.click(await screen.findByText('取引先管理'))
    await userEvent.click(await screen.findByText('アルファ商事株式会社'))
    await userEvent.click(await screen.findByText('編集'))

    expect(await screen.findByDisplayValue('アルファ商事株式会社')).toBeInTheDocument()
    await userEvent.click(screen.getByText('保存'))

    expect(await screen.findByText('取引先を更新しました')).toBeInTheDocument()
  })

  it('取引先一覧→新規登録→登録すると一覧へ戻り完了メッセージを表示する', async () => {
    render(<App />)

    await userEvent.click(await screen.findByText('取引先管理'))
    await userEvent.click(await screen.findByText('+ 新規登録'))
    await userEvent.type(screen.getByLabelText('取引先名称'), '新規商事株式会社')
    await userEvent.click(screen.getByText('登録'))

    expect(await screen.findByText('取引先を登録しました')).toBeInTheDocument()
  })

  it('ホーム→自社情報・振込先の設定→保存→ホームへ戻ると設定が反映されている', async () => {
    render(<App />)

    await userEvent.click(await screen.findByText('自社情報・振込先の設定'))
    await userEvent.type(screen.getByLabelText('氏名・屋号'), 'サンプル商店 山田太郎')
    await userEvent.type(screen.getByLabelText('住所'), '東京都千代田区1-1-1')
    await userEvent.click(screen.getByText('保存'))

    expect(await screen.findByText('自社情報を保存しました')).toBeInTheDocument()
    expect(window.jimuhubApi.saveCompanyProfile).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'サンプル商店 山田太郎' })
    )

    await userEvent.click(screen.getByText('ホーム'))
    expect(await screen.findByText('取引先登録件数(利用中)')).toBeInTheDocument()
  })

  it('ホームでエクスポートダイアログを開閉できる', async () => {
    render(<App />)

    await userEvent.click(await screen.findByText('データをエクスポート'))
    expect(await screen.findByText('データをエクスポート', { selector: 'h2' })).toBeInTheDocument()

    await userEvent.click(screen.getByLabelText('閉じる'))
    await waitFor(() =>
      expect(screen.queryByText('データをエクスポート', { selector: 'h2' })).not.toBeInTheDocument()
    )
  })
})
