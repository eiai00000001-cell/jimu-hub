import type { ReactElement } from 'react'

interface TaskDueDateProps {
  dueDate: string | null
  /** 期限超過(Mainが判定した真偽値。未完了で期限日が今日より前) */
  overdue: boolean
}

/**
 * タスクの期限日の表示。期限超過は、赤字の期限日と「期限超過」バッジ(アイコン付き)で示し、色だけに頼らない。
 * 期限なしは補助グレーの「期限なし」。参照元: 詳細設計書3.27〜3.29章、デザインガイド(タスク・期限)
 */
export function TaskDueDate({ dueDate, overdue }: TaskDueDateProps): ReactElement {
  if (dueDate === null) {
    return <span style={{ color: 'var(--color-text-secondary)' }}>期限なし</span>
  }
  if (!overdue) return <>{dueDate}</>
  return (
    <>
      <span className="due-overdue">{dueDate}</span>{' '}
      <span className="badge-overdue">
        <span className="alert-icon">!</span>期限超過
      </span>
    </>
  )
}
