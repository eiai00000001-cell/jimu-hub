import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc/channels'
import { TaskIdSchema, TaskInputSchema, TaskListFilterSchema } from '@shared/schemas/task.schema'
import type { TaskService } from '../services/task.service'

/**
 * `tasks:*`チャンネルを受信し`TaskService`を呼び出す薄いIPC層。
 * IPC境界でid・条件・入力をZodスキーマにより再検証する(Service層でも再検証する)。
 * 業務エラー(見つかりません等)は例外として伝播し、Rendererはメッセージをそのまま表示する。
 * 参照元: 詳細設計書 4.34〜4.37章、5章(`TasksIpcHandler`)、7章
 */
export class TasksIpcHandler {
  constructor(private readonly service: TaskService) {}

  registerHandlers(): void {
    ipcMain.handle(IPC_CHANNELS.tasksList, async (_event, filter?: unknown) =>
      this.service.listTasks(TaskListFilterSchema.parse(filter ?? {}))
    )
    ipcMain.handle(IPC_CHANNELS.tasksGet, async (_event, id: unknown) =>
      this.service.getTask(TaskIdSchema.parse(id))
    )
    ipcMain.handle(IPC_CHANNELS.tasksCreate, async (_event, input: unknown) =>
      this.service.createTask(TaskInputSchema.parse(input))
    )
    ipcMain.handle(IPC_CHANNELS.tasksUpdate, async (_event, id: unknown, input: unknown) =>
      this.service.updateTask(TaskIdSchema.parse(id), TaskInputSchema.parse(input))
    )
    ipcMain.handle(IPC_CHANNELS.tasksComplete, async (_event, id: unknown) =>
      this.service.completeTask(TaskIdSchema.parse(id))
    )
    ipcMain.handle(IPC_CHANNELS.tasksReopen, async (_event, id: unknown) =>
      this.service.reopenTask(TaskIdSchema.parse(id))
    )
    ipcMain.handle(IPC_CHANNELS.tasksDelete, async (_event, id: unknown) =>
      this.service.deleteTask(TaskIdSchema.parse(id))
    )
  }
}
