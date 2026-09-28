import type { TaskRow } from "@/api/types"
import { NONE } from "@/lib/filter-state"
import {
  applyShowCompleted,
  taskDisplayRows,
  type TaskDisplayState,
} from "@/lib/task-display-state"
import { collectStatBuckets, uniqueById, type ViewStatBucket } from "@/lib/views-stat-buckets"

export type ViewTaskDimension = "assignee" | "label" | "project"

export interface ViewTaskSelection {
  dimension: ViewTaskDimension
  value: string
}

/** 与列表锚点口径一致：先隐藏完结行，再应用子任务开关，最后按 ID 去重。 */
export function displayedTaskRows(tasks: TaskRow[], state: TaskDisplayState): TaskRow[] {
  return uniqueById(taskDisplayRows(applyShowCompleted(tasks, state.showCompleted), state.showSubIssues))
}

/** 统计只接受展示行，不读取树上下文，也不将无标签任务归入虚构标签桶。 */
export function buildViewTaskStats(rows: TaskRow[], dimension: ViewTaskDimension): ViewStatBucket[] {
  return collectStatBuckets(uniqueById(rows), (row, add) => {
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
  })
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
