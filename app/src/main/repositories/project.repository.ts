import type { Database } from '../db/db'
import type {
  Project,
  ProjectLinkKind,
  ProjectLinkTargetType,
  ProjectRef,
  ProjectLinkHistoryEntry,
  ProjectLinkedDocument,
  ProjectLinkedRecord,
  ProjectListItem,
  ProjectSelectable,
  ProjectStatus
} from '@shared/types/project'
import type { ProjectListFilter } from '@shared/schemas/project.schema'

/** 見積書・請求書・入出金の詳細取得時に、紐づく案件を付与するための参照(IPC層が使う) */
export interface ProjectRefLookup {
  findLinkedProjectRef(targetType: ProjectLinkTargetType, targetId: number): ProjectRef | null
}

function nowIso(): string {
  return new Date().toISOString()
}

/** Repositoryへ渡す、正規化済み(空文字をnullへ変換済み)の案件の項目 */
export interface ProjectRecordInput {
  name: string
  clientId: number | null
  startDate: string | null
  endDate: string | null
  memo: string | null
}

interface ProjectRow {
  id: number
  name: string
  client_id: number | null
  client_name: string | null
  start_date: string | null
  end_date: string | null
  memo: string | null
  status: ProjectStatus
  created_at: string
  updated_at: string
}

const PROJECT_SELECT = `
  SELECT p.id, p.name, p.client_id, c.name AS client_name, p.start_date, p.end_date,
         p.memo, p.status, p.created_at, p.updated_at
  FROM projects p LEFT JOIN clients c ON c.id = p.client_id`

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

/**
 * projectsテーブル・project_link_historyテーブルへのアクセスを担うRepository層。
 * 参照元: 詳細設計書 4.27〜4.30章、5章(`ProjectRepository`)、6.14・6.15章
 */
export class ProjectRepository {
  constructor(private readonly database: Database) {}

  private get sqlite(): Database['sqlite'] {
    return this.database.sqlite
  }

  findById(id: number): Project | null {
    const row = this.sqlite.prepare(`${PROJECT_SELECT} WHERE p.id = ?`).get(id) as
      ProjectRow | undefined
    return row
      ? {
          id: row.id,
          name: row.name,
          clientId: row.client_id,
          clientName: row.client_name,
          startDate: row.start_date,
          endDate: row.end_date,
          memo: row.memo,
          status: row.status,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        }
      : null
  }

  /**
   * 案件一覧の検索(指定した条件をすべて満たす案件。並び順はidの降順)。
   * 期間は、案件の期間と重なる案件とし、期間を指定した場合は開始日・終了日がともに空の案件を対象外とする(詳細設計書4.28章)。
   */
  search(filter: ProjectListFilter): ProjectListItem[] {
    const where: string[] = []
    const params: unknown[] = []
    if (filter.keyword) {
      where.push("p.name LIKE ? ESCAPE '\\'")
      params.push(`%${escapeLike(filter.keyword)}%`)
    }
    if (filter.clientId !== undefined) {
      where.push('p.client_id = ?')
      params.push(filter.clientId)
    }
    if (filter.status && filter.status !== 'all') {
      where.push('p.status = ?')
      params.push(filter.status)
    }
    if (filter.periodFrom || filter.periodTo) {
      where.push('(p.start_date IS NOT NULL OR p.end_date IS NOT NULL)')
    }
    if (filter.periodFrom) {
      where.push('(p.end_date IS NULL OR p.end_date >= ?)')
      params.push(filter.periodFrom)
    }
    if (filter.periodTo) {
      where.push('(p.start_date IS NULL OR p.start_date <= ?)')
      params.push(filter.periodTo)
    }
    const rows = this.sqlite
      .prepare(
        `${PROJECT_SELECT} ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.id DESC`
      )
      .all(...params) as ProjectRow[]
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      clientId: row.client_id,
      clientName: row.client_name,
      status: row.status,
      startDate: row.start_date,
      endDate: row.end_date
    }))
  }

  /** 紐づけ先の候補(進行中の案件と、`includeId`の案件)。新しい順 */
  listSelectable(includeId?: number): ProjectSelectable[] {
    return this.sqlite
      .prepare(
        `SELECT id, name, status FROM projects
         WHERE status = 'active' OR id = ? ORDER BY id DESC`
      )
      .all(includeId ?? -1) as ProjectSelectable[]
  }

  /** 取引先の存在と状態(案件の取引先の検証用) */
  findClientStatus(clientId: number): 'active' | 'inactive' | null {
    const row = this.sqlite.prepare('SELECT status FROM clients WHERE id = ?').get(clientId) as
      { status: 'active' | 'inactive' } | undefined
    return row?.status ?? null
  }

  insert(input: ProjectRecordInput): { id: number } {
    const now = nowIso()
    const result = this.sqlite
      .prepare(
        `INSERT INTO projects (name, client_id, start_date, end_date, memo, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`
      )
      .run(input.name, input.clientId, input.startDate, input.endDate, input.memo, now, now)
    return { id: Number(result.lastInsertRowid) }
  }

  /** 状態は変更しない */
  update(id: number, input: ProjectRecordInput): void {
    this.sqlite
      .prepare(
        `UPDATE projects SET name = ?, client_id = ?, start_date = ?, end_date = ?, memo = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(input.name, input.clientId, input.startDate, input.endDate, input.memo, nowIso(), id)
  }

  updateStatus(id: number, status: ProjectStatus): void {
    this.sqlite
      .prepare('UPDATE projects SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, nowIso(), id)
  }

  delete(id: number): void {
    this.sqlite.prepare('DELETE FROM projects WHERE id = ?').run(id)
  }

  /** 案件に紐づく見積書・請求書・入出金・経費の合計件数(取消済の記録を含む) */
  countLinks(id: number): number {
    const row = this.sqlite
      .prepare(
        `SELECT (SELECT COUNT(*) FROM quotes WHERE project_id = @id)
              + (SELECT COUNT(*) FROM invoices WHERE project_id = @id)
              + (SELECT COUNT(*) FROM cash_records WHERE project_id = @id) AS c`
      )
      .get({ id }) as { c: number }
    return row.c
  }

  /** 案件に紐づく書類(新しい発行日順) */
  listLinkedDocuments(table: 'quotes' | 'invoices', projectId: number): ProjectLinkedDocument[] {
    const numberColumn = table === 'quotes' ? 'd.quote_number' : 'd.invoice_number'
    const rows = this.sqlite
      .prepare(
        `SELECT d.id, ${numberColumn} AS documentNumber, d.issue_date AS issueDate,
                c.name AS clientName, d.total_amount AS totalAmount, d.status
         FROM ${table} d JOIN clients c ON c.id = d.client_id
         WHERE d.project_id = ? ORDER BY d.issue_date DESC, d.id DESC`
      )
      .all(projectId) as ProjectLinkedDocument[]
    return rows
  }

  /** 案件に紐づく入出金・経費(日付の新しい順) */
  listLinkedRecords(projectId: number): ProjectLinkedRecord[] {
    return this.sqlite
      .prepare(
        `SELECT id, record_date AS recordDate, kind, amount, description, status
         FROM cash_records WHERE project_id = ? ORDER BY record_date DESC, id DESC`
      )
      .all(projectId) as ProjectLinkedRecord[]
  }

  /** 案件に関する付け替え履歴(移動元・移動先のどちらかがこの案件。新しい順) */
  listHistoryOfProject(projectId: number): ProjectLinkHistoryEntry[] {
    return this.mapHistory(
      this.sqlite
        .prepare(
          `${HISTORY_SELECT} WHERE from_project_id = @id OR to_project_id = @id ORDER BY id DESC`
        )
        .all({ id: projectId })
    )
  }

  /** 対象(見積書・請求書・入出金)の付け替え履歴(新しい順) */
  listHistoryOfTarget(targetType: string, targetId: number): ProjectLinkHistoryEntry[] {
    return this.mapHistory(
      this.sqlite
        .prepare(`${HISTORY_SELECT} WHERE target_type = ? AND target_id = ? ORDER BY id DESC`)
        .all(targetType, targetId)
    )
  }

  /** 付け替えの対象(見積書・請求書・入出金)の現在の案件・表示用の名称・削除状態。存在しなければnull */
  findLinkTarget(
    targetType: ProjectLinkTargetType,
    targetId: number
  ): { projectId: number | null; label: string; deleted: boolean } | null {
    if (targetType === 'cash_record') {
      const row = this.sqlite
        .prepare(
          'SELECT project_id AS projectId, record_date AS date, description, is_deleted AS deleted FROM cash_records WHERE id = ?'
        )
        .get(targetId) as
        { projectId: number | null; date: string; description: string; deleted: number } | undefined
      return row
        ? {
            projectId: row.projectId,
            label: `${row.date} ${row.description}`.slice(0, 30),
            deleted: row.deleted === 1
          }
        : null
    }
    const table = targetType === 'quote' ? 'quotes' : 'invoices'
    const numberColumn = targetType === 'quote' ? 'quote_number' : 'invoice_number'
    const row = this.sqlite
      .prepare(
        `SELECT project_id AS projectId, ${numberColumn} AS documentNumber FROM ${table} WHERE id = ?`
      )
      .get(targetId) as { projectId: number | null; documentNumber: string | null } | undefined
    return row
      ? { projectId: row.projectId, label: row.documentNumber ?? '下書き', deleted: false }
      : null
  }

  /**
   * 対象の`project_id`のみを更新する。`updated_at`・`pdf_hash`・`record_hash`・`pdf_hash_mismatch`は更新しない
   * (案件の紐づけは、書類・記録の本体とは別に管理する。詳細設計書4.30章手順2-4)。
   */
  setProjectId(
    targetType: ProjectLinkTargetType,
    targetId: number,
    projectId: number | null
  ): void {
    const table =
      targetType === 'quote' ? 'quotes' : targetType === 'invoice' ? 'invoices' : 'cash_records'
    this.sqlite.prepare(`UPDATE ${table} SET project_id = ? WHERE id = ?`).run(projectId, targetId)
  }

  insertHistory(entry: {
    targetType: ProjectLinkTargetType
    targetId: number
    targetLabel: string
    fromProjectId: number | null
    fromProjectName: string | null
    toProjectId: number | null
    toProjectName: string | null
    kind: ProjectLinkKind
  }): void {
    this.sqlite
      .prepare(
        `INSERT INTO project_link_history
           (operated_at, target_type, target_id, target_label, from_project_id, from_project_name,
            to_project_id, to_project_name, kind)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        nowIso(),
        entry.targetType,
        entry.targetId,
        entry.targetLabel,
        entry.fromProjectId,
        entry.fromProjectName,
        entry.toProjectId,
        entry.toProjectName,
        entry.kind
      )
  }

  /** 対象に紐づく案件(名称・状態つき)。紐づけがなければnull */
  findLinkedProjectRef(targetType: ProjectLinkTargetType, targetId: number): ProjectRef | null {
    const target = this.findLinkTarget(targetType, targetId)
    if (!target || target.projectId === null) return null
    const project = this.findById(target.projectId)
    return project ? { id: project.id, name: project.name, status: project.status } : null
  }

  private mapHistory(rows: unknown[]): ProjectLinkHistoryEntry[] {
    return rows as ProjectLinkHistoryEntry[]
  }
}

const HISTORY_SELECT = `
  SELECT id, operated_at AS operatedAt, target_type AS targetType, target_id AS targetId,
         target_label AS targetLabel, from_project_id AS fromProjectId,
         from_project_name AS fromProjectName, to_project_id AS toProjectId,
         to_project_name AS toProjectName, kind
  FROM project_link_history`
