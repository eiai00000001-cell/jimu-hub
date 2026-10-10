/**
 * 案件(PROJECTS)の型定義。
 * 参照元: 詳細設計書 3.22〜3.26章、4.27〜4.30章、6.14〜6.15章、7章
 */

export const PROJECT_STATUSES = ['active', 'completed'] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

export const PROJECT_STATUS_FILTERS = ['all', 'active', 'completed'] as const
export type ProjectStatusFilter = (typeof PROJECT_STATUS_FILTERS)[number]

export const PROJECT_LINK_TARGET_TYPES = ['quote', 'invoice', 'cash_record'] as const
export type ProjectLinkTargetType = (typeof PROJECT_LINK_TARGET_TYPES)[number]

export type ProjectLinkKind = 'assign' | 'change' | 'unassign' | 'auto_release'

/** 案件の基本情報(登録・編集画面、詳細画面) */
export interface Project {
  id: number
  name: string
  clientId: number | null
  /** 利用停止の取引先も名称を返す */
  clientName: string | null
  startDate: string | null
  endDate: string | null
  memo: string | null
  status: ProjectStatus
  createdAt: string
  updatedAt: string
}

/** 案件一覧の1行 */
export interface ProjectListItem {
  id: number
  name: string
  clientId: number | null
  clientName: string | null
  status: ProjectStatus
  startDate: string | null
  endDate: string | null
}

/** 紐づけ先の候補(`projects:listSelectable`) */
export interface ProjectSelectable {
  id: number
  name: string
  status: ProjectStatus
}

/** 見積書・請求書・入出金・経費の詳細画面などに表示する、紐づく案件 */
export interface ProjectRef {
  id: number
  name: string
  status: ProjectStatus
}

/** 案件への付け替え履歴の1行(追記のみ) */
export interface ProjectLinkHistoryEntry {
  id: number
  operatedAt: string
  targetType: ProjectLinkTargetType
  targetId: number
  targetLabel: string
  fromProjectId: number | null
  fromProjectName: string | null
  toProjectId: number | null
  toProjectName: string | null
  kind: ProjectLinkKind
}

/** 案件に紐づく見積書・請求書の1行 */
export interface ProjectLinkedDocument {
  id: number
  /** 下書きはnull */
  documentNumber: string | null
  issueDate: string
  clientName: string
  totalAmount: number
  status: 'draft' | 'finalized'
}

/** 案件に紐づく入出金・経費の1行 */
export interface ProjectLinkedRecord {
  id: number
  recordDate: string
  kind: 'income' | 'expense'
  amount: number
  description: string
  status: 'active' | 'cancelled'
}

export interface ProjectDetail extends Project {
  quotes: ProjectLinkedDocument[]
  invoices: ProjectLinkedDocument[]
  records: ProjectLinkedRecord[]
  /** この案件に関する付け替え履歴(新しい順) */
  history: ProjectLinkHistoryEntry[]
  /** 紐づけが0件で、削除できるか */
  deletable: boolean
}
