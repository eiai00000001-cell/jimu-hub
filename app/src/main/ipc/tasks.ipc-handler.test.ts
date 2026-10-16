import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc/channels'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Handler) => {
      handlers.set(channel, handler)
    })
  }
}))

import { TasksIpcHandler } from './tasks.ipc-handler'
import type { TaskService } from '../services/task.service'

describe('TasksIpcHandler(F-34〜F-37。IPC境界での再検証。詳細設計書7章)', () => {
  let service: Record<string, ReturnType<typeof vi.fn>>

  beforeEach(() => {
    handlers.clear()
    service = {
      listTasks: vi.fn().mockReturnValue({ items: [], counts: { open: 0, overdue: 0 } }),
      getTask: vi.fn().mockReturnValue({ id: 1 }),
      createTask: vi.fn().mockReturnValue({ id: 1 }),
      updateTask: vi.fn().mockReturnValue({ success: true }),
      completeTask: vi.fn().mockReturnValue({ changed: true }),
      reopenTask: vi.fn().mockReturnValue({ changed: true }),
      deleteTask: vi.fn().mockReturnValue({ success: true })
    }
    new TasksIpcHandler(service as unknown as TaskService).registerHandlers()
  })

  const call = (channel: string, ...args: unknown[]): unknown => handlers.get(channel)!({}, ...args)

  it('チャンネル名は設計書7章のとおりで、7つすべてを登録する', () => {
    expect(IPC_CHANNELS.tasksList).toBe('tasks:list')
    expect(IPC_CHANNELS.tasksGet).toBe('tasks:get')
    expect(IPC_CHANNELS.tasksCreate).toBe('tasks:create')
    expect(IPC_CHANNELS.tasksUpdate).toBe('tasks:update')
    expect(IPC_CHANNELS.tasksComplete).toBe('tasks:complete')
    expect(IPC_CHANNELS.tasksReopen).toBe('tasks:reopen')
    expect(IPC_CHANNELS.tasksDelete).toBe('tasks:delete')
    for (const channel of [
      IPC_CHANNELS.tasksList,
      IPC_CHANNELS.tasksGet,
      IPC_CHANNELS.tasksCreate,
      IPC_CHANNELS.tasksUpdate,
      IPC_CHANNELS.tasksComplete,
      IPC_CHANNELS.tasksReopen,
      IPC_CHANNELS.tasksDelete
    ]) {
      expect(handlers.has(channel)).toBe(true)
    }
  })

  it('一覧: 条件を検証してServiceへ渡す。条件を省略した場合は空の条件で呼ぶ', async () => {
    await call(IPC_CHANNELS.tasksList)
    expect(service.listTasks).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'open', dueMode: 'any', keyword: '' })
    )
    await call(IPC_CHANNELS.tasksList, { status: 'all', projectId: null, keyword: ' 請求 ' })
    expect(service.listTasks).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'all', projectId: null, keyword: '請求' })
    )
  })

  it('一覧: 不正な条件(列挙値・日付・期間の前後・キーワード長・余計な型)は拒否し、Serviceを呼ばない', async () => {
    for (const bad of [
      { status: 'x' },
      { dueMode: 'x' },
      { dueFrom: '2026-02-30' },
      { dueMode: 'range', dueFrom: '2026-10-10', dueTo: '2026-10-09' },
      { keyword: 'あ'.repeat(101) },
      { projectId: 0 },
      'open'
    ]) {
      await expect(
        Promise.resolve().then(() => call(IPC_CHANNELS.tasksList, bad))
      ).rejects.toThrow()
    }
    expect(service.listTasks).not.toHaveBeenCalled()
  })

  it('登録・更新: 入力を検証し、正規化した値をServiceへ渡す', async () => {
    await call(IPC_CHANNELS.tasksCreate, {
      name: '  作業  ',
      memo: '',
      dueDate: '',
      projectId: null
    })
    expect(service.createTask).toHaveBeenCalledWith({
      name: '作業',
      memo: null,
      dueDate: null,
      projectId: null
    })
    await call(IPC_CHANNELS.tasksUpdate, 3, { name: '更新', dueDate: '2026-12-01', projectId: 2 })
    expect(service.updateTask).toHaveBeenCalledWith(3, {
      name: '更新',
      memo: null,
      dueDate: '2026-12-01',
      projectId: 2
    })
  })

  it('登録・更新: 不正な入力(名前なし・長すぎる・不正な日付・案件の型)は拒否し、Serviceを呼ばない', async () => {
    const bads = [
      undefined,
      null,
      'x',
      { name: '' },
      { name: 'あ'.repeat(101) },
      { name: 'x', memo: 'あ'.repeat(1001) },
      { name: 'x', dueDate: '2026/10/01' },
      { name: 'x', projectId: '1' },
      { name: 'x', projectId: -1 }
    ]
    for (const bad of bads) {
      await expect(
        Promise.resolve().then(() => call(IPC_CHANNELS.tasksCreate, bad))
      ).rejects.toThrow()
      await expect(
        Promise.resolve().then(() => call(IPC_CHANNELS.tasksUpdate, 1, bad))
      ).rejects.toThrow()
    }
    expect(service.createTask).not.toHaveBeenCalled()
    expect(service.updateTask).not.toHaveBeenCalled()
  })

  it('取得・完了・未完了・削除: 正の整数のidのみ受け付け、結果をそのまま返す', async () => {
    expect(await call(IPC_CHANNELS.tasksGet, 5)).toEqual({ id: 1 })
    expect(await call(IPC_CHANNELS.tasksComplete, 5)).toEqual({ changed: true })
    expect(await call(IPC_CHANNELS.tasksReopen, 5)).toEqual({ changed: true })
    expect(await call(IPC_CHANNELS.tasksDelete, 5)).toEqual({ success: true })
    for (const fn of ['getTask', 'completeTask', 'reopenTask', 'deleteTask']) {
      expect(service[fn]).toHaveBeenCalledWith(5)
    }
  })

  it('取得・完了・未完了・削除・更新: 不正なid(0・負数・小数・文字列・未指定)は拒否し、Serviceを呼ばない', async () => {
    for (const channel of [
      IPC_CHANNELS.tasksGet,
      IPC_CHANNELS.tasksComplete,
      IPC_CHANNELS.tasksReopen,
      IPC_CHANNELS.tasksDelete
    ]) {
      for (const bad of [0, -1, 1.5, '1', undefined, null, { id: 1 }]) {
        await expect(Promise.resolve().then(() => call(channel, bad))).rejects.toThrow()
      }
    }
    await expect(
      Promise.resolve().then(() => call(IPC_CHANNELS.tasksUpdate, 0, { name: 'x' }))
    ).rejects.toThrow()
    for (const fn of ['getTask', 'completeTask', 'reopenTask', 'deleteTask', 'updateTask']) {
      expect(service[fn]).not.toHaveBeenCalled()
    }
  })

  it('Serviceの業務エラー(見つかりません等)は、例外のまま伝播する(メッセージはTASK_MESSAGESの文言)', async () => {
    service.getTask!.mockImplementation(() => {
      throw new Error('対象のタスクが見つかりません。一覧を更新しました')
    })
    await expect(Promise.resolve().then(() => call(IPC_CHANNELS.tasksGet, 9))).rejects.toThrow(
      '対象のタスクが見つかりません。一覧を更新しました'
    )
  })
})
