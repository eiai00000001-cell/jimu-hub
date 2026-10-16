import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Database } from '../db/db'
import { ProjectRepository } from './project.repository'
import { TaskRepository } from './task.repository'
import { TaskListFilterSchema } from '@shared/schemas/task.schema'
import type { TaskListFilter } from '@shared/schemas/task.schema'

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

  describe('検索・件数(F-37・F-38。詳細設計書4.37・4.38章)', () => {
    const TODAY = '2026-10-14'
    let projects: ProjectRepository

    const project = (name: string, status: 'active' | 'completed' = 'active'): number => {
      projects = new ProjectRepository(db)
      const { id } = projects.insert({
        name,
        clientId: null,
        startDate: null,
        endDate: null,
        memo: null
      })
      if (status === 'completed') projects.updateStatus(id, 'completed')
      return id
    }
    const task = (
      name: string,
      dueDate: string | null,
      projectId: number | null = null,
      done = false
    ): number => {
      const { id } = repo.insert({ name, memo: null, dueDate, projectId }, T1)
      if (done) repo.markDone(id, T2)
      return id
    }
    const names = (filter: Partial<TaskListFilter> = {}): string[] =>
      repo.search(TaskListFilterSchema.parse(filter), TODAY).map((t) => t.name)

    it('既定は未完了のみ。状態で絞り込み・すべてを選べる', () => {
      task('未完了A', null)
      task('完了B', null, null, true)
      expect(names()).toEqual(['未完了A'])
      expect(names({ status: 'done' })).toEqual(['完了B'])
      expect(names({ status: 'all' })).toEqual(['未完了A', '完了B'])
    })

    it('並びは期限日の昇順、期限なしは末尾、同じ期限・期限なし同士は登録の古い順', () => {
      task('期限なし1', null)
      task('11/01-a', '2026-11-01')
      task('10/01', '2026-10-01')
      task('期限なし2', null)
      task('11/01-b', '2026-11-01')
      expect(names()).toEqual(['10/01', '11/01-a', '11/01-b', '期限なし1', '期限なし2'])
    })

    it('案件で絞り込める(案件なしのみ、特定の案件)。完了の案件のタスクも対象', () => {
      const a = project('案件A')
      const done = project('完了案件', 'completed')
      task('案件なし', null)
      task('Aのタスク', null, a)
      task('完了案件のタスク', null, done)
      expect(names({ projectId: null })).toEqual(['案件なし'])
      expect(names({ projectId: a })).toEqual(['Aのタスク'])
      expect(names({ projectId: done })).toEqual(['完了案件のタスク'])
      expect(names()).toHaveLength(3)
    })

    it('期限: 期間指定(境界を含む。期限なしは含めない)', () => {
      task('9/30', '2026-09-30')
      task('10/01', '2026-10-01')
      task('10/31', '2026-10-31')
      task('11/01', '2026-11-01')
      task('なし', null)
      expect(names({ dueMode: 'range', dueFrom: '2026-10-01', dueTo: '2026-10-31' })).toEqual([
        '10/01',
        '10/31'
      ])
      expect(names({ dueMode: 'range', dueFrom: '2026-10-31' })).toEqual(['10/31', '11/01'])
      expect(names({ dueMode: 'range', dueTo: '2026-09-30' })).toEqual(['9/30'])
      // 両方が空欄の場合は「すべて」と同じ(期限なしも含む)
      expect(names({ dueMode: 'range' })).toHaveLength(5)
    })

    it('期限: 期限超過のみ(未完了で今日より前。今日は含めない。完了は含めない)、期限なしのみ', () => {
      task('昨日', '2026-10-13')
      task('今日', TODAY)
      task('明日', '2026-10-15')
      task('完了の過去', '2026-10-01', null, true)
      task('なし', null)
      expect(names({ dueMode: 'overdue', status: 'all' })).toEqual(['昨日'])
      expect(names({ dueMode: 'none', status: 'all' })).toEqual(['なし'])
    })

    it('キーワードは部分一致。%・_・\\は文字として扱う', () => {
      task('請求書を送る', null)
      task('100%確認', null)
      task('a_b', null)
      task('axb', null)
      task('パス\\確認', null)
      expect(names({ keyword: '請求' })).toEqual(['請求書を送る'])
      expect(names({ keyword: '%' })).toEqual(['100%確認'])
      expect(names({ keyword: 'a_b' })).toEqual(['a_b'])
      expect(names({ keyword: '\\' })).toEqual(['パス\\確認'])
    })

    it('条件はすべて満たすもの(AND)', () => {
      const a = project('案件A')
      task('請求A', '2026-10-01', a)
      task('請求B', '2026-10-01', null)
      task('見積A', '2026-10-01', a)
      expect(names({ projectId: a, keyword: '請求', dueMode: 'overdue' })).toEqual(['請求A'])
    })

    it('各行に案件名・案件の状態・overdue(表示時の判定)が付く', () => {
      const done = project('完了案件', 'completed')
      task('超過', '2026-10-13', done)
      task('今日', TODAY)
      task('完了済み', '2026-10-01', null, true)
      const rows = repo.search(TaskListFilterSchema.parse({ status: 'all' }), TODAY)
      expect(rows.find((r) => r.name === '超過')).toMatchObject({
        projectName: '完了案件',
        projectStatus: 'completed',
        overdue: true,
        completedAt: null
      })
      expect(rows.find((r) => r.name === '今日')).toMatchObject({
        projectId: null,
        projectName: null,
        projectStatus: null,
        overdue: false
      })
      expect(rows.find((r) => r.name === '完了済み')).toMatchObject({
        overdue: false,
        completedAt: T2
      })
    })

    it('「今日」を変えると、保存し直さなくても期限超過の判定が変わる(日付またぎ)', () => {
      task('期限10/14', '2026-10-14')
      const overdueOn = (today: string): boolean =>
        repo.search(TaskListFilterSchema.parse({}), today)[0]!.overdue
      expect(overdueOn('2026-10-14')).toBe(false)
      expect(overdueOn('2026-10-15')).toBe(true)
      expect(repo.countOpenAndOverdue('2026-10-14').overdue).toBe(0)
      expect(repo.countOpenAndOverdue('2026-10-15').overdue).toBe(1)
    })

    it('countOpenAndOverdueは全タスクが対象(完了は数えない)', () => {
      task('超過', '2026-10-13')
      task('今日', TODAY)
      task('なし', null)
      task('完了', '2026-10-01', null, true)
      expect(repo.countOpenAndOverdue(TODAY)).toEqual({ open: 3, overdue: 1 })
    })

    it('findByProjectは、その案件のタスクを未完了・完了とも期限順で返す', () => {
      const a = project('案件A')
      const b = project('案件B')
      task('A-期限なし', null, a)
      task('A-完了', '2026-09-01', a, true)
      task('A-超過', '2026-10-01', a)
      task('B', null, b)
      const rows = repo.findByProject(a, TODAY)
      expect(rows.map((r) => r.name)).toEqual(['A-完了', 'A-超過', 'A-期限なし'])
      expect(rows.map((r) => r.overdue)).toEqual([false, true, false])
      expect(repo.findByProject(999, TODAY)).toEqual([])
    })

    it('findDetailは、メモ・登録/更新日時を含む詳細を返す。なければnull', () => {
      const a = project('案件A')
      const { id } = repo.insert(
        { name: 't', memo: 'メモ', dueDate: '2026-10-01', projectId: a },
        T1
      )
      expect(repo.findDetail(id, TODAY)).toMatchObject({
        id,
        name: 't',
        memo: 'メモ',
        projectName: '案件A',
        projectStatus: 'active',
        overdue: true,
        createdAt: T1,
        updatedAt: T1
      })
      expect(repo.findDetail(999, TODAY)).toBeNull()
    })
  })
})
