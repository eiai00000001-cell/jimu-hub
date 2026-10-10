import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc/channels'
import { PROJECT_MESSAGES } from '@shared/messages/messages'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Handler) => {
      handlers.set(channel, handler)
    })
  }
}))

import { ProjectsIpcHandler } from './projects.ipc-handler'
import type { ProjectService } from '../services/project.service'

const validInput = { name: '案件', clientId: null, startDate: '', endDate: '', memo: '' }

describe('ProjectsIpcHandler(IPC境界での再検証)', () => {
  let service: Record<string, ReturnType<typeof vi.fn>>

  beforeEach(() => {
    handlers.clear()
    service = {
      listProjects: vi.fn().mockReturnValue([]),
      getProject: vi.fn().mockReturnValue({ id: 1 }),
      createProject: vi.fn().mockReturnValue({ id: 1 }),
      updateProject: vi.fn().mockReturnValue({ success: true }),
      deleteProject: vi.fn().mockReturnValue({ success: true }),
      completeProject: vi.fn().mockReturnValue({ success: true }),
      reopenProject: vi.fn().mockReturnValue({ success: true }),
      listSelectable: vi.fn().mockReturnValue([]),
      listHistory: vi.fn().mockReturnValue([])
    }
    new ProjectsIpcHandler(service as unknown as ProjectService).registerHandlers()
  })

  const call = (channel: string, ...args: unknown[]): unknown => handlers.get(channel)!({}, ...args)

  it('各チャンネルを登録する', () => {
    for (const channel of [
      IPC_CHANNELS.projectsList,
      IPC_CHANNELS.projectsGet,
      IPC_CHANNELS.projectsCreate,
      IPC_CHANNELS.projectsUpdate,
      IPC_CHANNELS.projectsDelete,
      IPC_CHANNELS.projectsComplete,
      IPC_CHANNELS.projectsReopen,
      IPC_CHANNELS.projectsListSelectable,
      IPC_CHANNELS.projectLinksHistory
    ]) {
      expect(handlers.has(channel)).toBe(true)
    }
  })

  it('一覧は、条件が無くても呼び出せる。期間が逆の場合は呼び出さない', async () => {
    await call(IPC_CHANNELS.projectsList)
    expect(service.listProjects).toHaveBeenCalledWith({})
    await expect(
      call(IPC_CHANNELS.projectsList, { periodFrom: '2026-10-02', periodTo: '2026-10-01' })
    ).rejects.toThrow(PROJECT_MESSAGES.periodFilterInvalid)
  })

  it('登録・更新は、入力を検証して呼び出す。不正な入力は呼び出さない', async () => {
    await call(IPC_CHANNELS.projectsCreate, validInput)
    expect(service.createProject).toHaveBeenCalledWith(validInput)
    await call(IPC_CHANNELS.projectsUpdate, 3, validInput)
    expect(service.updateProject).toHaveBeenCalledWith(3, validInput)

    await expect(call(IPC_CHANNELS.projectsCreate, { ...validInput, name: ' ' })).rejects.toThrow(
      PROJECT_MESSAGES.nameRequired
    )
    await expect(call(IPC_CHANNELS.projectsUpdate, 'x', validInput)).rejects.toThrow()
    expect(service.createProject).toHaveBeenCalledTimes(1)
    expect(service.updateProject).toHaveBeenCalledTimes(1)
  })

  it('idの形式が不正な場合は、Serviceを呼び出さない', async () => {
    for (const channel of [
      IPC_CHANNELS.projectsGet,
      IPC_CHANNELS.projectsDelete,
      IPC_CHANNELS.projectsComplete,
      IPC_CHANNELS.projectsReopen
    ]) {
      await expect(call(channel, 0)).rejects.toThrow()
      await expect(call(channel, '1')).rejects.toThrow()
    }
    expect(service.getProject).not.toHaveBeenCalled()
    expect(service.deleteProject).not.toHaveBeenCalled()
  })

  it('完了・再開・削除・詳細は、idで呼び出す', async () => {
    await call(IPC_CHANNELS.projectsComplete, 2)
    await call(IPC_CHANNELS.projectsReopen, 2)
    await call(IPC_CHANNELS.projectsDelete, 2)
    await call(IPC_CHANNELS.projectsGet, 2)
    expect(service.completeProject).toHaveBeenCalledWith(2)
    expect(service.reopenProject).toHaveBeenCalledWith(2)
    expect(service.deleteProject).toHaveBeenCalledWith(2)
    expect(service.getProject).toHaveBeenCalledWith(2)
  })

  it('紐づけ先の候補は、includeIdの有無どちらでも呼び出せる', async () => {
    await call(IPC_CHANNELS.projectsListSelectable)
    expect(service.listSelectable).toHaveBeenLastCalledWith(undefined)
    await call(IPC_CHANNELS.projectsListSelectable, 4)
    expect(service.listSelectable).toHaveBeenLastCalledWith(4)
    await expect(call(IPC_CHANNELS.projectsListSelectable, -1)).rejects.toThrow()
  })

  it('付け替え履歴は、対象の種別とidを検証して呼び出す', async () => {
    await call(IPC_CHANNELS.projectLinksHistory, 'quote', 5)
    expect(service.listHistory).toHaveBeenCalledWith('quote', 5)
    await expect(call(IPC_CHANNELS.projectLinksHistory, 'other', 5)).rejects.toThrow()
    await expect(call(IPC_CHANNELS.projectLinksHistory, 'quote', 0)).rejects.toThrow()
  })
})
