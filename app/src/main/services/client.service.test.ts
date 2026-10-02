import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { Database } from '../db/db'
import { ClientRepository } from '../repositories/client.repository'
import { ClientService, ClientNotFoundError } from './client.service'
import type { ClientInput } from '@shared/schemas/client.schema'

const baseInput: ClientInput = {
  name: '株式会社サンプル',
  furigana: 'カブシキガイシャサンプル',
  honorific: '御中',
  contactPerson: '山田太郎',
  postalCode: '123-4567',
  address: '東京都千代田区1-1-1',
  phone: '03-1234-5678',
  email: 'sample@example.com',
  invoiceRegistrationNumber: 'T1234567890123',
  memo: '備考'
}

describe('ClientService', () => {
  let db: Database
  let service: ClientService

  beforeEach(() => {
    db = new Database(':memory:')
    db.initialize()
    service = new ClientService(new ClientRepository(db))
  })

  afterEach(() => {
    db.close()
  })

  it('createClientで取引先を登録できる', () => {
    const result = service.createClient(baseInput)
    expect(result.id).toEqual(expect.any(Number))

    const found = service.getClient(result.id)
    expect(found.name).toBe('株式会社サンプル')
    expect(found.status).toBe('active')
  })

  it('createClientは必須項目(取引先名称)が空欄の場合はエラーを投げる', () => {
    expect(() => service.createClient({ ...baseInput, name: '' })).toThrow(
      '取引先名称を入力してください'
    )
  })

  it('getClientは存在しないIDの場合ClientNotFoundErrorを投げる', () => {
    expect(() => service.getClient(9999)).toThrow(ClientNotFoundError)
  })

  it('updateClientで内容を更新できる(idは変更しない)', () => {
    const { id } = service.createClient(baseInput)
    service.updateClient(id, { ...baseInput, name: '更新後の名称' })

    const found = service.getClient(id)
    expect(found.id).toBe(id)
    expect(found.name).toBe('更新後の名称')
  })

  it('updateClientはバリデーションNGの場合エラーを投げ、更新を行わない', () => {
    const { id } = service.createClient(baseInput)
    expect(() => service.updateClient(id, { ...baseInput, name: '' })).toThrow(
      '取引先名称を入力してください'
    )

    const found = service.getClient(id)
    expect(found.name).toBe('株式会社サンプル')
  })

  it('deactivateClientで状態をinactiveにする', () => {
    const { id } = service.createClient(baseInput)
    service.deactivateClient(id)

    const found = service.getClient(id)
    expect(found.status).toBe('inactive')
  })

  it('updateClientは存在しないidの場合ClientNotFoundErrorを投げる(レビュー結果報告書 No.9)', () => {
    expect(() => service.updateClient(9999, baseInput)).toThrow(ClientNotFoundError)
  })

  it('deactivateClientは存在しないidの場合ClientNotFoundErrorを投げる(レビュー結果報告書 No.9)', () => {
    expect(() => service.deactivateClient(9999)).toThrow(ClientNotFoundError)
  })

  it('listClientsは既定で利用中のみを名称昇順で返す', () => {
    const first = service.createClient({ ...baseInput, name: 'わ行株式会社' })
    service.createClient({ ...baseInput, name: 'あ行株式会社' })
    service.deactivateClient(first.id)

    const list = service.listClients()
    expect(list.map((c) => c.name)).toEqual(['あ行株式会社'])
  })
})
