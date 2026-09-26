import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { Database } from '../db/db'
import { AppMetaRepository } from './app-meta.repository'

describe('AppMetaRepository', () => {
  let db: Database
  let repository: AppMetaRepository

  beforeEach(() => {
    db = new Database(':memory:')
    db.initialize()
    repository = new AppMetaRepository(db)
  })

  afterEach(() => {
    db.close()
  })

  it('初期化直後はschema_versionが取得できる', () => {
    expect(repository.get('schema_version')).toBe('1')
  })

  it('存在しないキーはnullを返す', () => {
    expect(repository.get('unknown_key')).toBeNull()
  })

  it('setで新しいキーを登録できる', () => {
    repository.set('example_key', 'example_value')
    expect(repository.get('example_key')).toBe('example_value')
  })

  it('setで既存のキーの値を更新できる', () => {
    repository.set('schema_version', '2')
    expect(repository.get('schema_version')).toBe('2')
  })
})
