// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientFormPage } from './ClientFormPage'
import type { Client } from '@shared/types/client'

const existingClient: Client = {
  id: 5,
  name: '既存商事株式会社',
  honorific: '様',
  contactPerson: '既存太郎',
  postalCode: '100-0001',
  address: '東京都千代田区1-1-1',
  phone: '03-0000-0000',
  email: 'existing@example.com',
  invoiceRegistrationNumber: '',
  memo: '',
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

function setupApi(): {
  createClient: ReturnType<typeof vi.fn>
  updateClient: ReturnType<typeof vi.fn>
  getClient: ReturnType<typeof vi.fn>
} {
  const createClient = vi.fn().mockResolvedValue({ id: 10 })
  const updateClient = vi.fn().mockResolvedValue({ success: true })
  const getClient = vi.fn().mockResolvedValue(existingClient)
  window.jimuhubApi = {
    getStartupStatus: vi.fn(),
    listClients: vi.fn(),
    getClient,
    createClient,
    updateClient,
    deactivateClient: vi.fn(),
    exportData: vi.fn(),
    importData: vi.fn()
  } as unknown as Window['jimuhubApi']
  return { createClient, updateClient, getClient }
}

describe('ClientFormPage(新規登録)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('必須項目(取引先名称)が空欄の場合は登録処理を行わずエラーを表示する', async () => {
    const { createClient } = setupApi()
    render(<ClientFormPage mode="new" onCreated={vi.fn()} onUpdated={vi.fn()} onCancel={vi.fn()} />)

    await userEvent.click(screen.getByText('登録'))

    expect(await screen.findByText('取引先名称を入力してください')).toBeInTheDocument()
    expect(createClient).not.toHaveBeenCalled()
  })

  it('必須項目を入力して登録すると、createClientを呼び出しonCreatedへ結果を渡す', async () => {
    const { createClient } = setupApi()
    const onCreated = vi.fn()
    render(
      <ClientFormPage mode="new" onCreated={onCreated} onUpdated={vi.fn()} onCancel={vi.fn()} />
    )

    await userEvent.type(screen.getByLabelText('取引先名称'), '新規商事株式会社')
    await userEvent.click(screen.getByText('登録'))

    await waitFor(() =>
      expect(createClient).toHaveBeenCalledWith(
        expect.objectContaining({ name: '新規商事株式会社' })
      )
    )
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(10))
  })

  it('メールアドレスの形式が不正な場合はエラーを表示する', async () => {
    setupApi()
    render(<ClientFormPage mode="new" onCreated={vi.fn()} onUpdated={vi.fn()} onCancel={vi.fn()} />)

    await userEvent.type(screen.getByLabelText('取引先名称'), '新規商事株式会社')
    await userEvent.type(screen.getByLabelText('メールアドレス'), 'invalid')
    await userEvent.click(screen.getByText('登録'))

    expect(await screen.findByText('メールアドレスの形式が正しくありません')).toBeInTheDocument()
  })

  it('「キャンセル」ボタン押下でonCancelを呼び出す', async () => {
    setupApi()
    const onCancel = vi.fn()
    render(
      <ClientFormPage mode="new" onCreated={vi.fn()} onUpdated={vi.fn()} onCancel={onCancel} />
    )

    await userEvent.click(screen.getByText('キャンセル'))
    expect(onCancel).toHaveBeenCalled()
  })
})

describe('ClientFormPage(編集)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('既存の値を初期表示する', async () => {
    setupApi()
    render(
      <ClientFormPage
        mode="edit"
        clientId={5}
        onCreated={vi.fn()}
        onUpdated={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(await screen.findByDisplayValue('既存商事株式会社')).toBeInTheDocument()
  })

  it('保存するとupdateClientを呼び出しonUpdatedへ結果を渡す(idは維持される)', async () => {
    const { updateClient } = setupApi()
    const onUpdated = vi.fn()
    render(
      <ClientFormPage
        mode="edit"
        clientId={5}
        onCreated={vi.fn()}
        onUpdated={onUpdated}
        onCancel={vi.fn()}
      />
    )
    await screen.findByDisplayValue('既存商事株式会社')

    const nameInput = screen.getByLabelText('取引先名称')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, '更新後の名称')
    await userEvent.click(screen.getByText('保存'))

    await waitFor(() =>
      expect(updateClient).toHaveBeenCalledWith(
        5,
        expect.objectContaining({ name: '更新後の名称' })
      )
    )
    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(5))
  })

  it('編集対象の取引先が見つからない場合はエラーの案内を表示する(レビュー結果報告書 No.5)', async () => {
    setupApi()
    window.jimuhubApi.getClient = vi
      .fn()
      .mockRejectedValue(new Error('指定された取引先が見つかりません'))

    render(
      <ClientFormPage
        mode="edit"
        clientId={999}
        onCreated={vi.fn()}
        onUpdated={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(await screen.findByText('指定された取引先が見つかりません')).toBeInTheDocument()
    expect(screen.queryByLabelText('取引先名称')).not.toBeInTheDocument()
  })
})
