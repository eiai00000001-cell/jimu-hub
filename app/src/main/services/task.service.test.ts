import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PROJECT_MESSAGES, TASK_MESSAGES } from '@shared/messages/messages'
import type { TaskInput } from '@shared/schemas/task.schema'
import { Database } from '../db/db'
import { ProjectRepository } from '../repositories/project.repository'
import { TaskRepository } from '../repositories/task.repository'
import { TaskError, TaskService } from './task.service'

const input = (over: Partial<TaskInput> = {}): TaskInput => ({
  name: '見積書を送る',
  memo: '',
  dueDate: '',
  projectId: null,
  ...over
})

describe('TaskService(F-34〜F-36。詳細設計書4.34〜4.36章)', () => {
  let db: Database
  let tasks: TaskRepository
  let projects: ProjectRepository
  let service: TaskService
  let clock: string

  beforeEach(() => {
    db = new Database(':memory:')
    db.initialize()
    tasks = new TaskRepository(db)
    projects = new ProjectRepository(db)
    clock = '2026-10-01T09:00:00.000Z'
    service = new TaskService(db, tasks, projects, () => new Date(clock))
  })
  afterEach(() => db.close())

  const project = (status: 'active' | 'completed' = 'active'): number => {
    const { id } = projects.insert({
      name: '案件',
      clientId: null,
      startDate: null,
      endDate: null,
      memo: null
    })
    if (status === 'completed') projects.updateStatus(id, 'completed')
    return id
  }

  describe('createTask(F-34)', () => {
    it('未完了で登録し、空のメモ・期限は未設定(null)で保存する。同じ名前も登録できる', () => {
      const a = service.createTask(input({ name: '  前後に空白  ' }))
      const b = service.createTask(input({ name: '前後に空白' }))
      expect(b.id).not.toBe(a.id)
      expect(tasks.findById(a.id)).toMatchObject({
        name: '前後に空白',
        memo: null,
        dueDate: null,
        projectId: null,
        status: 'open',
        completedAt: null,
        createdAt: clock,
        updatedAt: clock
      })
    })

    it('進行中の案件に紐づけて登録できる', () => {
      const pid = project()
      const { id } = service.createTask(
        input({ projectId: pid, dueDate: '2026-11-30', memo: 'メモ' })
      )
      expect(tasks.findById(id)).toMatchObject({
        projectId: pid,
        dueDate: '2026-11-30',
        memo: 'メモ'
      })
    })

    it('入力の違反(名前なし・期限が実在日でない等)はエラーにして登録しない', () => {
      expect(() => service.createTask(input({ name: '  ' }))).toThrow(TASK_MESSAGES.nameRequired)
      expect(() => service.createTask(input({ dueDate: '2026-02-30' }))).toThrow(TaskError)
      expect(() => service.createTask(input({ memo: 'あ'.repeat(1001) }))).toThrow(
        TASK_MESSAGES.memoTooLong
      )
      expect((db.sqlite.prepare('SELECT COUNT(*) AS c FROM tasks').get() as { c: number }).c).toBe(
        0
      )
    })

    it('存在しない案件・完了の案件は指定できない', () => {
      expect(() => service.createTask(input({ projectId: 999 }))).toThrow(
        TASK_MESSAGES.projectNotFound
      )
      expect(() => service.createTask(input({ projectId: project('completed') }))).toThrow(
        PROJECT_MESSAGES.projectNotSelectable
      )
      expect((db.sqlite.prepare('SELECT COUNT(*) AS c FROM tasks').get() as { c: number }).c).toBe(
        0
      )
    })
  })

  describe('updateTask(F-34)', () => {
    it('項目を更新し、状態・完了日時は変えない', () => {
      const { id } = service.createTask(input())
      clock = '2026-10-02T09:00:00.000Z'
      service.completeTask(id)
      clock = '2026-10-03T09:00:00.000Z'
      expect(service.updateTask(id, input({ name: '更新後', dueDate: '2026-12-01' }))).toEqual({
        success: true
      })
      expect(tasks.findById(id)).toMatchObject({
        name: '更新後',
        dueDate: '2026-12-01',
        status: 'done',
        completedAt: '2026-10-02T09:00:00.000Z',
        createdAt: '2026-10-01T09:00:00.000Z',
        updatedAt: clock
      })
    })

    it('対象がなければ「見つかりません」', () => {
      expect(() => service.updateTask(999, input())).toThrow(TASK_MESSAGES.notFound)
    })

    it('現在と同じ案件なら、完了の案件のままでも保存できる', () => {
      const pid = project()
      const { id } = service.createTask(input({ projectId: pid }))
      projects.updateStatus(pid, 'completed')
      service.updateTask(id, input({ projectId: pid, name: '完了案件のまま' }))
      expect(tasks.findById(id)).toMatchObject({ projectId: pid, name: '完了案件のまま' })
    })

    it('現在と異なる案件は、進行中のみ指定できる(完了・存在しないは拒否)', () => {
      const { id } = service.createTask(input({ projectId: project() }))
      const active = project()
      service.updateTask(id, input({ projectId: active }))
      expect(tasks.findById(id)?.projectId).toBe(active)
      expect(() => service.updateTask(id, input({ projectId: project('completed') }))).toThrow(
        PROJECT_MESSAGES.projectNotSelectable
      )
      expect(() => service.updateTask(id, input({ projectId: 999 }))).toThrow(
        TASK_MESSAGES.projectNotFound
      )
      expect(tasks.findById(id)?.projectId).toBe(active)
    })

    it('案件なしへ戻せる', () => {
      const { id } = service.createTask(input({ projectId: project() }))
      service.updateTask(id, input({ projectId: null }))
      expect(tasks.findById(id)?.projectId).toBeNull()
    })
  })

  describe('completeTask / reopenTask(F-35)', () => {
    it('未完了→完了で完了日時を記録し、changed: trueを返す', () => {
      const { id } = service.createTask(input())
      clock = '2026-10-05T10:00:00.000Z'
      expect(service.completeTask(id)).toEqual({ changed: true })
      expect(tasks.findById(id)).toMatchObject({
        status: 'done',
        completedAt: clock,
        updatedAt: clock
      })
    })

    it('すでに完了なら何も変更せず、changed: falseを返す(冪等)', () => {
      const { id } = service.createTask(input())
      service.completeTask(id)
      const before = tasks.findById(id)
      clock = '2026-10-06T10:00:00.000Z'
      expect(service.completeTask(id)).toEqual({ changed: false })
      expect(tasks.findById(id)).toEqual(before)
    })

    it('完了→未完了で完了日時を消し、すでに未完了なら変更しない', () => {
      const { id } = service.createTask(input())
      expect(service.reopenTask(id)).toEqual({ changed: false })
      service.completeTask(id)
      clock = '2026-10-07T10:00:00.000Z'
      expect(service.reopenTask(id)).toEqual({ changed: true })
      expect(tasks.findById(id)).toMatchObject({
        status: 'open',
        completedAt: null,
        updatedAt: clock
      })
    })

    it('対象がなければ「見つかりません」', () => {
      expect(() => service.completeTask(999)).toThrow(TASK_MESSAGES.notFound)
      expect(() => service.reopenTask(999)).toThrow(TASK_MESSAGES.notFound)
    })
  })

  describe('deleteTask(F-36)', () => {
    it('状態を問わず削除する。再度の削除は「見つかりません」', () => {
      const open = service.createTask(input()).id
      const done = service.createTask(input()).id
      service.completeTask(done)
      expect(service.deleteTask(open)).toEqual({ success: true })
      expect(service.deleteTask(done)).toEqual({ success: true })
      expect(() => service.deleteTask(open)).toThrow(TASK_MESSAGES.notFound)
      expect((db.sqlite.prepare('SELECT COUNT(*) AS c FROM tasks').get() as { c: number }).c).toBe(
        0
      )
    })
  })

  it('タスクの追加・変更・削除は、案件の行と付け替え履歴を変更しない', () => {
    const pid = project()
    const snapshot = (): unknown => [
      db.sqlite.prepare('SELECT * FROM projects ORDER BY id').all(),
      db.sqlite.prepare('SELECT COUNT(*) AS c FROM project_link_history').get(),
      db.sqlite.prepare('SELECT COUNT(*) AS c FROM cash_record_history').get()
    ]
    const before = snapshot()
    const { id } = service.createTask(input({ projectId: pid }))
    service.updateTask(id, input({ projectId: pid, name: 'x' }))
    service.completeTask(id)
    service.reopenTask(id)
    service.deleteTask(id)
    expect(snapshot()).toEqual(before)
  })
})
