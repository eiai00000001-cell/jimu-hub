import { useEffect, useState, type ReactElement } from 'react'
import type { ProjectRef, ProjectSelectable } from '@shared/types/project'

interface ProjectSelectFieldProps {
  id: string
  /** 選択中の案件ID(なしはnull) */
  value: number | null
  /** 編集時の現在の案件(完了の案件でも、選択肢に含める) */
  current?: ProjectRef | null
  onChange: (projectId: number | null) => void
}

/**
 * 入力項目「案件」(任意)。選択肢は「案件なし」と進行中の案件で、画面表示の都度取得する。
 * 現在の案件が完了の場合は、現在の案件を「{案件名}(完了)」として含める。
 * 参照元: 詳細設計書3.26章
 */
export function ProjectSelectField({
  id,
  value,
  current,
  onChange
}: ProjectSelectFieldProps): ReactElement {
  const [projects, setProjects] = useState<ProjectSelectable[]>([])
  const currentId = current?.id

  useEffect(() => {
    window.jimuhubApi.listSelectableProjects(currentId).then(setProjects)
  }, [currentId])

  return (
    <div className="field">
      <label htmlFor={id}>案件</label>
      <select
        id={id}
        aria-label="案件"
        value={value === null ? '' : String(value)}
        onChange={(event) =>
          onChange(event.target.value === '' ? null : Number(event.target.value))
        }
      >
        <option value="">案件なし</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.status === 'completed' ? `${project.name}(完了)` : project.name}
          </option>
        ))}
      </select>
      <div className="hint">任意です。完了の案件には、新しく紐づけられません</div>
    </div>
  )
}
