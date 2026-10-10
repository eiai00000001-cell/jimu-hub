import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc/channels'
import {
  ProjectIdSchema,
  ProjectInputSchema,
  ProjectLinkChangeSchema,
  ProjectLinkHistoryQuerySchema,
  ProjectListFilterSchema,
  ProjectSelectableQuerySchema
} from '@shared/schemas/project.schema'
import type { ProjectService } from '../services/project.service'
import type { ProjectLinkService } from '../services/project-link.service'

/**
 * `projects:*`・`projectLinks:history`チャンネルを受信し`ProjectService`を呼び出すIPC層。
 * IPC境界でid・filter・入力をZodスキーマにより再検証する(詳細設計書4.27〜4.30章)。
 * 参照元: 詳細設計書 5章(`ProjectsIpcHandler`)、7章
 */
export class ProjectsIpcHandler {
  constructor(
    private readonly service: ProjectService,
    private readonly linkService: ProjectLinkService
  ) {}

  registerHandlers(): void {
    ipcMain.handle(IPC_CHANNELS.projectsList, async (_event, filter?: unknown) =>
      this.service.listProjects(ProjectListFilterSchema.parse(filter ?? {}))
    )
    ipcMain.handle(IPC_CHANNELS.projectsGet, async (_event, id: unknown) =>
      this.service.getProject(ProjectIdSchema.parse(id))
    )
    ipcMain.handle(IPC_CHANNELS.projectsCreate, async (_event, input: unknown) =>
      this.service.createProject(ProjectInputSchema.parse(input))
    )
    ipcMain.handle(IPC_CHANNELS.projectsUpdate, async (_event, id: unknown, input: unknown) =>
      this.service.updateProject(ProjectIdSchema.parse(id), ProjectInputSchema.parse(input))
    )
    ipcMain.handle(IPC_CHANNELS.projectsDelete, async (_event, id: unknown) =>
      this.service.deleteProject(ProjectIdSchema.parse(id))
    )
    ipcMain.handle(IPC_CHANNELS.projectsComplete, async (_event, id: unknown) =>
      this.service.completeProject(ProjectIdSchema.parse(id))
    )
    ipcMain.handle(IPC_CHANNELS.projectsReopen, async (_event, id: unknown) =>
      this.service.reopenProject(ProjectIdSchema.parse(id))
    )
    ipcMain.handle(IPC_CHANNELS.projectsListSelectable, async (_event, includeId?: unknown) =>
      this.service.listSelectable(
        ProjectSelectableQuerySchema.parse({ includeId: includeId ?? undefined }).includeId
      )
    )
    ipcMain.handle(IPC_CHANNELS.projectLinksChange, async (_event, change: unknown) => {
      const { targetType, targetId, projectId } = ProjectLinkChangeSchema.parse(change)
      return this.linkService.changeLink(targetType, targetId, projectId)
    })
    ipcMain.handle(
      IPC_CHANNELS.projectLinksHistory,
      async (_event, targetType: unknown, targetId: unknown) => {
        const query = ProjectLinkHistoryQuerySchema.parse({ targetType, targetId })
        return this.service.listHistory(query.targetType, query.targetId)
      }
    )
  }
}
