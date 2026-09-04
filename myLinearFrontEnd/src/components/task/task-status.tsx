import { cn } from "@/lib/utils"
import type { TaskStatus } from "@/api/types"

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In Progress",
  done: "Done",
  canceled: "Canceled",
}

/** 展示/选项顺序 = 后端枚举序（api.md §2.2 CASE 排序） */
export const TASK_STATUS_ORDER: readonly TaskStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "done",
  "canceled",
]

/** Select 选项集：新建弹窗与任务属性编辑共用（对称 project-status.tsx 的导出形态） */
export const TASK_STATUS_OPTIONS = TASK_STATUS_ORDER.map((s) => ({
  value: s,
  label: TASK_STATUS_LABELS[s],
  icon: <TaskStatusIcon status={s} />,
}))

// 图标对齐 Linear issue 状态：backlog 虚线圈 / todo 空圈 / in_progress 半填黄 / done 实心紫✓ / canceled ✕
export function TaskStatusIcon({ status, className }: { status: TaskStatus; className?: string }) {
  const cls = cn("size-4 shrink-0", className)
  switch (status) {
    case "backlog":
      return (
        <svg viewBox="0 0 16 16" className={cls} aria-hidden>
          <circle
            cx="8"
            cy="8"
            r="6"
            fill="none"
            stroke="#8a8f98"
            strokeWidth="1.5"
            strokeDasharray="2.4 2.4"
            strokeLinecap="round"
          />
        </svg>
      )
    case "todo":
      return (
        <svg viewBox="0 0 16 16" className={cls} aria-hidden>
          <circle cx="8" cy="8" r="6" fill="none" stroke="#8a8f98" strokeWidth="1.5" />
        </svg>
      )
    case "in_progress":
      return (
        <svg viewBox="0 0 16 16" className={cls} aria-hidden>
          <circle cx="8" cy="8" r="6" fill="none" stroke="#f2c94c" strokeWidth="1.5" />
          <path d="M8 2 A6 6 0 0 1 8 14 Z" fill="#f2c94c" />
        </svg>
      )
    case "done":
      return (
        <svg viewBox="0 0 16 16" className={cls} aria-hidden>
          <circle cx="8" cy="8" r="7" fill="#5e6ad2" />
          <path
            d="M5 8.2 7.2 10.4 11 6"
            fill="none"
            stroke="#fff"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )
    case "canceled":
      return (
        <svg viewBox="0 0 16 16" className={cls} aria-hidden>
          <circle cx="8" cy="8" r="6" fill="none" stroke="#8a8f98" strokeWidth="1.5" />
          <path
            d="M5.8 5.8 10.2 10.2 M10.2 5.8 5.8 10.2"
            stroke="#8a8f98"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      )
  }
}
