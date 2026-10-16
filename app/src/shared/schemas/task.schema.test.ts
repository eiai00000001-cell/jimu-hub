import { describe, expect, it } from 'vitest'
import { TASK_MESSAGES, VALIDATION_MESSAGES } from '../messages/messages'
import { TaskIdSchema, TaskInputSchema } from './task.schema'

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
