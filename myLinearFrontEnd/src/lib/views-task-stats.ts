import type { TaskRow } from "@/api/types"
import { NONE } from "@/lib/filter-state"
import {
  applyShowCompleted,
  taskDisplayRows,
  type TaskDisplayState,
} from "@/lib/task-display-state"

export type ViewTaskDimension = "assignee" | "label" | "project"

export interface ViewTaskSelection {
  dimension: ViewTaskDimension
  value: string
}

export interface ViewTaskBucket {
  value: string
  name: string
  count: number
  color?: string
}

/** 保留首个同 ID 行及输入序；统计不能因多标签入组或重复行而重复计数。 */
function uniqueTaskRows(rows: TaskRow[]): TaskRow[] {
  const seen = new Set<string>()
  return rows.filter((row) => {
    if (seen.has(row.id)) return false
    seen.add(row.id)
    return true
  })
}

/** 与列表锚点口径一致：先隐藏完结行，再应用子任务开关，最后按 ID 去重。 */
export function displayedTaskRows(tasks: TaskRow[], state: TaskDisplayState): TaskRow[] {
  return uniqueTaskRows(taskDisplayRows(applyShowCompleted(tasks, state.showCompleted), state.showSubIssues))
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** 统计只接受展示行，不读取树上下文，也不将无标签任务归入虚构标签桶。 */
export function buildViewTaskStats(rows: TaskRow[], dimension: ViewTaskDimension): ViewTaskBucket[] {
  const buckets = new Map<string, ViewTaskBucket>()
  const add = (value: string, name: string, color?: string) => {
    const bucket = buckets.get(value)
    if (bucket) bucket.count++
    else buckets.set(value, { value, name, count: 1, ...(color ? { color } : {}) })
  }

  for (const row of uniqueTaskRows(rows)) {
    switch (dimension) {
      case "assignee":
        add(row.assignee?.id ?? NONE, row.assignee?.name ?? "", row.assignee?.avatarColor)
        break
      case "project":
        add(row.project?.id ?? NONE, row.project?.name ?? "")
        break
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

/** 独立钻取已有展示行；禁止先筛基础任务再计算 display，以免隐藏子任务被提升为根。 */
export function selectViewTaskRows(rows: TaskRow[], selection: ViewTaskSelection | null): TaskRow[] {
  if (!selection) return rows
  const { dimension, value } = selection
  return rows.filter((row) => {
    switch (dimension) {
      case "assignee":
        return (row.assignee?.id ?? NONE) === value
      case "project":
        return (row.project?.id ?? NONE) === value
      case "label":
        return row.labels.some((label) => label.id === value)
    }
  })
}
