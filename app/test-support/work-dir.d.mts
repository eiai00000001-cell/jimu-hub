export type WorkKind = 'e2e' | 'unit' | 'tools'
export interface EntryReport {
  count: number
  bytes: number
  names: string[]
}
export interface LeftoverReport {
  work: EntryReport
  tmp: EntryReport
}
export interface WorkTools {
  root: string
  createWorkDir(kind: WorkKind, label: string): string
  removeWorkDir(dir: string): void
  removeCreatedWorkDirs(): void
  sweepWorkRoot(kind?: WorkKind): void
  reportLeftovers(tmpRoot?: string): LeftoverReport
}
export const WORK_ROOT_NAME: string
export const KINDS: WorkKind[]
export function createWorkTools(root: string): WorkTools
export function workRoot(): string
export function createWorkDir(kind: WorkKind, label: string): string
export function removeWorkDir(dir: string): void
export function removeCreatedWorkDirs(): void
export function sweepWorkRoot(kind?: WorkKind): void
export function reportLeftovers(tmpRoot?: string): LeftoverReport
export function useWorkDir(
  label: string,
  hooks: { beforeEach: (fn: () => void) => void; afterEach: (fn: () => void) => void }
): () => string
