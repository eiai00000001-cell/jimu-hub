import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { Database } from '../db/db'
import { ClientRepository } from './client.repository'
import type { ClientInput } from '@shared/schemas/client.schema'

const baseInput: ClientInput = {
  name: '株式会社サンプル',
  honorific: '御中',
  contactPerson: '山田太郎',
  postalCode: '123-4567',
  address: '東京都千代田区1-1-1',
  phone: '03-1234-5678',
  email: 'sample@example.com',
  invoiceRegistrationNumber: 'T1234567890123',
  memo: '備考'
}

describe('ClientRepository', () => {
  let db: Database
  let repository: ClientRepository

  beforeEach(() => {
    db = new Database(':memory:')
    db.initialize()
    repository = new ClientRepository(db)
  })

  afterEach(() => {
    db.close()
  })

  it('insertで登録した取引先をfindByIdで取得できる', () => {
    const { id } = repository.insert(baseInput)
    const found = repository.findById(id)

    expect(found).not.toBeNull()
    expect(found?.name).toBe('株式会社サンプル')
    expect(found?.status).toBe('active')
    expect(found?.createdAt).toEqual(expect.any(String))
    expect(found?.updatedAt).toEqual(expect.any(String))
  })

  it('任意項目が空欄の場合はnullとして保存される', () => {
    const { id } = repository.insert({ ...baseInput, contactPerson: '', memo: '' })
    const found = repository.findById(id)

    expect(found?.contactPerson).toBeNull()
    expect(found?.memo).toBeNull()
  })

  it('findByIdで存在しないIDを指定した場合はnullを返す', () => {
    expect(repository.findById(9999)).toBeNull()
  })

  it('findAllは名称昇順(五十音順)を既定の並び順とする', () => {
    repository.insert({ ...baseInput, name: 'わ行株式会社' })
    repository.insert({ ...baseInput, name: 'あ行株式会社' })

    const list = repository.findAll()
    expect(list.map((c) => c.name)).toEqual(['あ行株式会社', 'わ行株式会社'])
  })

  it('findAllはstatusFilter未指定(既定)では利用中のみ返す', () => {
    const { id } = repository.insert({ ...baseInput, name: '利用停止予定株式会社' })
    repository.updateStatus(id, 'inactive')
    repository.insert({ ...baseInput, name: '利用中株式会社' })

    const list = repository.findAll()
    expect(list.map((c) => c.name)).toEqual(['利用中株式会社'])
  })

  it('findAllはstatusFilter=allで利用停止も含めて返す', () => {
    const { id } = repository.insert({ ...baseInput, name: '利用停止株式会社' })
    repository.updateStatus(id, 'inactive')
    repository.insert({ ...baseInput, name: '利用中株式会社' })

    const list = repository.findAll({ statusFilter: 'all' })
    expect(list.length).toBe(2)
  })

  it('findAllはkeywordで名称の部分一致検索を行う', () => {
    repository.insert({ ...baseInput, name: '株式会社アルファ' })
    repository.insert({ ...baseInput, name: '株式会社ベータ' })

    const list = repository.findAll({ keyword: 'アルファ' })
    expect(list.map((c) => c.name)).toEqual(['株式会社アルファ'])
  })

  it('findAllはsort=created_at_descで登録日時の新しい順に並べる', () => {
    const first = repository.insert({ ...baseInput, name: '1件目' })
    const second = repository.insert({ ...baseInput, name: '2件目' })
    void first
    void second

    const list = repository.findAll({ sort: 'created_at_desc' })
    expect(list.map((c) => c.name)).toEqual(['2件目', '1件目'])
  })

  it('updateで内容を更新してもidは変更しない', () => {
    const { id } = repository.insert(baseInput)
    repository.update(id, { ...baseInput, name: '更新後の名称' })

    const found = repository.findById(id)
    expect(found?.id).toBe(id)
    expect(found?.name).toBe('更新後の名称')
  })

  it('updateStatusで状態をinactiveに変更できる', () => {
    const { id } = repository.insert(baseInput)
    repository.updateStatus(id, 'inactive')

    const found = repository.findById(id)
    expect(found?.status).toBe('inactive')
  })

  it('findAllForBackupは状態に関わらずid昇順で全件返す(バックアップ用)', () => {
    const first = repository.insert({ ...baseInput, name: '1件目' })
    const second = repository.insert({ ...baseInput, name: '2件目' })
    repository.updateStatus(second.id, 'inactive')

    const all = repository.findAllForBackup()
    expect(all.map((c) => c.id)).toEqual([first.id, second.id])
    expect(all.map((c) => c.status)).toEqual(['active', 'inactive'])
  })

  it('deleteAllで全件削除される', () => {
    repository.insert(baseInput)
    repository.insert({ ...baseInput, name: '2件目' })

    repository.deleteAll()

    expect(repository.findAllForBackup()).toEqual([])
  })

  it('insertWithIdは指定したidを保持したまま登録する(復元用)', () => {
    repository.insertWithId({
      id: 42,
      name: '復元された取引先',
      honorific: '様',
      contactPerson: null,
      postalCode: null,
      address: null,
      phone: null,
      email: null,
      invoiceRegistrationNumber: null,
      memo: null,
      status: 'inactive',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z'
    })

    const found = repository.findById(42)
    expect(found?.id).toBe(42)
    expect(found?.name).toBe('復元された取引先')
    expect(found?.status).toBe('inactive')
  })
})
