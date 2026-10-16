import { describe, expect, it } from 'vitest'
import { TASK_MESSAGES, VALIDATION_MESSAGES } from '../messages/messages'
import { TaskIdSchema, TaskInputSchema, TaskListFilterSchema, isOverdue } from './task.schema'

/** 詳細設計書3.28章・4.34章手順2(`taskInputSchema`) */
const parse = (value: unknown): ReturnType<typeof TaskInputSchema.safeParse> =>
  TaskInputSchema.safeParse(value)

describe('TaskInputSchema', () => {
  it('必須項目のみで受け付け、任意項目は未指定・空をnullに正規化する', () => {
    const r = parse({ name: '見積書を送る' })
    expect(r.success && r.data).toEqual({
      name: '見積書を送る',
      memo: null,
      dueDate: null,
      projectId: null
    })
    const r2 = parse({ name: 'x', memo: '', dueDate: '', projectId: null })
    expect(r2.success && r2.data).toEqual({ name: 'x', memo: null, dueDate: null, projectId: null })
  })

  it('タスク名は前後の空白を除去する', () => {
    const r = parse({ name: '  作業  ' })
    expect(r.success && r.data.name).toBe('作業')
  })

  it('タスク名の未入力(空白のみを含む)・100文字超を拒否する', () => {
    for (const name of ['', '   ']) {
      const r = parse({ name })
      expect(!r.success && r.error.issues[0]?.message).toBe(TASK_MESSAGES.nameRequired)
    }
    expect(parse({ name: 'あ'.repeat(100) }).success).toBe(true)
    const r = parse({ name: 'あ'.repeat(101) })
    expect(!r.success && r.error.issues[0]?.message).toBe(TASK_MESSAGES.nameTooLong)
  })

  it('メモは1000文字まで', () => {
    expect(parse({ name: 'x', memo: 'あ'.repeat(1000) }).success).toBe(true)
    const r = parse({ name: 'x', memo: 'あ'.repeat(1001) })
    expect(!r.success && r.error.issues[0]?.message).toBe(TASK_MESSAGES.memoTooLong)
  })

  it('期限日は実在日のみ(空文字・nullは期限なし)', () => {
    const ok = parse({ name: 'x', dueDate: '2026-02-28' })
    expect(ok.success && ok.data.dueDate).toBe('2026-02-28')
    for (const dueDate of ['2026-02-30', '2026/02/01', 'abc']) {
      const r = parse({ name: 'x', dueDate })
      expect(!r.success && r.error.issues[0]?.message).toBe(VALIDATION_MESSAGES.dateInvalid)
    }
  })

  it('案件は正の整数またはnull', () => {
    expect(parse({ name: 'x', projectId: 3 }).success).toBe(true)
    for (const projectId of [0, -1, 1.5, '1']) {
      expect(parse({ name: 'x', projectId }).success).toBe(false)
    }
  })
})

describe('TaskIdSchema', () => {
  it('正の整数のみ', () => {
    expect(TaskIdSchema.safeParse(1).success).toBe(true)
    for (const v of [0, -1, 1.2, '1']) expect(TaskIdSchema.safeParse(v).success).toBe(false)
  })
})

describe('TaskListFilterSchema(詳細設計書4.37章手順2)', () => {
  const ok = (v: unknown): ReturnType<typeof TaskListFilterSchema.parse> =>
    TaskListFilterSchema.parse(v)

  it('省略時は、状態=未完了・期限=すべて・キーワード空・案件の条件なし', () => {
    expect(ok({})).toEqual({
      status: 'open',
      projectId: undefined,
      dueMode: 'any',
      dueFrom: undefined,
      dueTo: undefined,
      keyword: ''
    })
  })

  it('案件は、省略=条件なし、null=案件なし、数値=その案件', () => {
    expect(ok({ projectId: null }).projectId).toBeNull()
    expect(ok({ projectId: 3 }).projectId).toBe(3)
    expect(TaskListFilterSchema.safeParse({ projectId: 0 }).success).toBe(false)
  })

  it('状態・期限の種類は列挙値のみ', () => {
    for (const status of ['all', 'open', 'done']) expect(ok({ status }).status).toBe(status)
    expect(TaskListFilterSchema.safeParse({ status: 'x' }).success).toBe(false)
    expect(TaskListFilterSchema.safeParse({ dueMode: 'x' }).success).toBe(false)
  })

  it('キーワードは前後の空白を除去し、100文字まで', () => {
    expect(ok({ keyword: '  請求  ' }).keyword).toBe('請求')
    expect(TaskListFilterSchema.safeParse({ keyword: 'あ'.repeat(101) }).success).toBe(false)
  })

  it('期限の日付は空文字・未指定・実在日のみ。空文字は未指定として扱う', () => {
    expect(ok({ dueMode: 'range', dueFrom: '', dueTo: '' })).toMatchObject({
      dueFrom: undefined,
      dueTo: undefined
    })
    expect(TaskListFilterSchema.safeParse({ dueFrom: '2026-02-30' }).success).toBe(false)
  })

  it('期間指定で開始日より終了日が前の場合は専用のエラー。同日は許可', () => {
    const bad = TaskListFilterSchema.safeParse({
      dueMode: 'range',
      dueFrom: '2026-10-10',
      dueTo: '2026-10-09'
    })
    expect(!bad.success && bad.error.issues[0]?.message).toBe(TASK_MESSAGES.dueRangeInvalid)
    expect(
      TaskListFilterSchema.safeParse({
        dueMode: 'range',
        dueFrom: '2026-10-10',
        dueTo: '2026-10-10'
      }).success
    ).toBe(true)
  })
})

describe('isOverdue(期限超過の判定。基本設計書2.5章★G4)', () => {
  it('未完了で期限日が今日より前の場合のみ期限超過', () => {
    expect(isOverdue('open', '2026-10-13', '2026-10-14')).toBe(true)
  })
  it('期限日が今日のタスクは期限超過ではない', () => {
    expect(isOverdue('open', '2026-10-14', '2026-10-14')).toBe(false)
  })
  it('期限日が未来、期限なし、完了のタスクは期限超過ではない', () => {
    expect(isOverdue('open', '2026-10-15', '2026-10-14')).toBe(false)
    expect(isOverdue('open', null, '2026-10-14')).toBe(false)
    expect(isOverdue('done', '2026-10-01', '2026-10-14')).toBe(false)
  })
})
