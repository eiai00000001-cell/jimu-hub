import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Database } from '../db/db'
import { TaskRepository } from './task.repository'

describe('TaskRepository(詳細設計書4.34〜4.36章、6.19章)', () => {
  let db: Database
  let repo: TaskRepository
  const T1 = '2026-10-01T00:00:00.000Z'
  const T2 = '2026-10-02T00:00:00.000Z'

  beforeEach(() => {
    db = new Database(':memory:')
    db.initialize()
    repo = new TaskRepository(db)
  })
  afterEach(() => db.close())

  const add = (over: Partial<Parameters<TaskRepository['insert']>[0]> = {}): number =>
    repo.insert({ name: 'タスク', memo: null, dueDate: null, projectId: null, ...over }, T1).id

  it('insertは未完了で登録し、採番したidを返す。同じ名前も登録できる', () => {
    const a = add({ name: '同名' })
    const b = add({ name: '同名', memo: 'メモ', dueDate: '2026-11-01' })
    expect(b).toBeGreaterThan(a)
    expect(repo.findById(b)).toEqual({
      id: b,
      name: '同名',
      memo: 'メモ',
      dueDate: '2026-11-01',
      projectId: null,
      status: 'open',
      completedAt: null,
      createdAt: T1,
      updatedAt: T1
    })
  })

  it('findByIdは存在しなければnull', () => {
    expect(repo.findById(999)).toBeNull()
  })

  it('updateは項目と更新日時のみを変え、状態・完了日時・登録日時は変えない', () => {
    const id = add()
    repo.markDone(id, T1)
    const changed = repo.update(
      id,
      { name: '更新', memo: 'm', dueDate: '2026-12-01', projectId: null },
      T2
    )
    expect(changed).toBe(true)
    expect(repo.findById(id)).toMatchObject({
      name: '更新',
      memo: 'm',
      dueDate: '2026-12-01',
      status: 'done',
      completedAt: T1,
      createdAt: T1,
      updatedAt: T2
    })
  })

  it('updateは対象がなければfalse', () => {
    expect(repo.update(999, { name: 'x', memo: null, dueDate: null, projectId: null }, T2)).toBe(
      false
    )
  })

  it('markDoneは未完了のときだけ更新し、完了日時と更新日時を記録する', () => {
    const id = add()
    expect(repo.markDone(id, T2)).toBe(true)
    expect(repo.findById(id)).toMatchObject({ status: 'done', completedAt: T2, updatedAt: T2 })
    expect(repo.markDone(id, '2026-10-03T00:00:00.000Z')).toBe(false)
    expect(repo.findById(id)?.completedAt).toBe(T2)
    expect(repo.markDone(999, T2)).toBe(false)
  })

  it('markOpenは完了のときだけ更新し、完了日時をNULLに戻す', () => {
    const id = add()
    expect(repo.markOpen(id, T2)).toBe(false)
    repo.markDone(id, T1)
    expect(repo.markOpen(id, T2)).toBe(true)
    expect(repo.findById(id)).toMatchObject({ status: 'open', completedAt: null, updatedAt: T2 })
  })

  it('deleteは状態を問わず削除し、件数に応じて真偽を返す', () => {
    const open = add()
    const done = add()
    repo.markDone(done, T1)
    expect(repo.delete(open)).toBe(true)
    expect(repo.delete(done)).toBe(true)
    expect(repo.delete(open)).toBe(false)
    expect(repo.findById(done)).toBeNull()
  })
})
