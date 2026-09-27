import type { ProjectRow } from "@/api/types"
import { applyShowClosed, type ProjectDisplayState } from "@/lib/display-state"
import { NONE } from "@/lib/filter-state"
import type { ViewTaskBucket } from "@/lib/views-task-stats"

export type ViewProjectDimension = "lead" | "member" | "label"

export interface ViewProjectSelection {
  dimension: ViewProjectDimension
  value: string
}

/** 保留首个同 ID 行及输入序；统计不能因多成员、多标签入组或重复行而重复计数。 */
function uniqueProjectRows(rows: ProjectRow[]): ProjectRow[] {
  const seen = new Set<string>()
  return rows.filter((row) => {
    if (seen.has(row.id)) return false
    seen.add(row.id)
    return true
  })
}

/** 与列表展示口径一致：先隐藏关闭项目，再按 ID 去重；其它 Display 选项不影响计数。 */
export function displayedProjectRows(rows: ProjectRow[], state: ProjectDisplayState): ProjectRow[] {
  return uniqueProjectRows(applyShowClosed(rows, state.showClosed))
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** 只统计展示行；无标签不造桶，多值桶计数不能累加为项目总数，总数取展示行数。 */
export function buildViewProjectStats(rows: ProjectRow[], dimension: ViewProjectDimension): ViewTaskBucket[] {
  const buckets = new Map<string, ViewTaskBucket>()
  const add = (value: string, name: string, color?: string) => {
    const bucket = buckets.get(value)
    if (bucket) bucket.count++
    else buckets.set(value, { value, name, count: 1, ...(color ? { color } : {}) })
  }

  for (const row of uniqueProjectRows(rows)) {
    switch (dimension) {
      case "lead":
        add(row.lead?.id ?? NONE, row.lead?.name ?? "", row.lead?.avatarColor)
        break
      case "member": {
        if (row.members.length === 0) add(NONE, "")
        const seenMembers = new Set<string>()
        for (const member of row.members) {
          if (seenMembers.has(member.id)) continue
          seenMembers.add(member.id)
          add(member.id, member.name, member.avatarColor)
        }
        break
      }
      case "label": {
        const seenLabels = new Set<string>()
        for (const label of row.labels) {
          if (seenLabels.has(label.id)) continue
          seenLabels.add(label.id)
          add(label.id, label.name, label.color)
        }
        break
      }
    }
  }

  return [...buckets.values()].sort(
    (a, b) => b.count - a.count || compareText(a.name, b.name) || compareText(a.value, b.value),
  )
}

/** 独立钻取已有展示行；不重算 Display，也不裁剪其它维度的统计基准。 */
export function selectViewProjectRows(rows: ProjectRow[], selection: ViewProjectSelection | null): ProjectRow[] {
  if (!selection) return rows
  const { dimension, value } = selection
  return rows.filter((row) => {
    switch (dimension) {
      case "lead":
        return (row.lead?.id ?? NONE) === value
      case "member":
        return value === NONE ? row.members.length === 0 : row.members.some((member) => member.id === value)
      case "label":
        return row.labels.some((label) => label.id === value)
    }
  })
}
