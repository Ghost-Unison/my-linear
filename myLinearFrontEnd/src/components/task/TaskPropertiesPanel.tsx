import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import type { TaskDetail, UpdateTaskInput } from "@/api/types"
import {
  TaskAssigneeEditor,
  TaskDueDateEditor,
  TaskLabelsEditor,
  TaskPriorityEditor,
  TaskProjectEditor,
  TaskStatusEditor,
} from "./TaskPropertyEditors"

interface TaskPropertiesPanelProps {
  task: TaskDetail
  workspaceId: string
  onPatch: (input: UpdateTaskInput) => void
  /** 标签走 PUT 子资源（全量替换），独立于 onPatch 的 PATCH 通道 */
  onLabelsChange: (labelIds: string[]) => void
  onDelete: () => void
}

/**
 * 右侧属性面板（对齐 Linear issue Properties，对称 ProjectPropertiesPanel）：
 * 标签 + chip 编辑器逐行排布，底部为删除入口。由页面负责挂载/收起（抽屉交互）。
 */
export function TaskPropertiesPanel({
  task,
  workspaceId,
  onPatch,
  onLabelsChange,
  onDelete,
}: TaskPropertiesPanelProps) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-xs font-medium text-muted-foreground">{t("common.properties")}</h2>

      <div className="flex flex-col gap-3">
        <Row label={t("common.status")}>
          <TaskStatusEditor task={task} onPatch={onPatch} className="max-w-full" />
        </Row>
        <Row label={t("common.priority")}>
          <TaskPriorityEditor task={task} onPatch={onPatch} className="max-w-full" />
        </Row>
        <Row label={t("task.assignee")}>
          <TaskAssigneeEditor
            task={task}
            workspaceId={workspaceId}
            onPatch={onPatch}
            className="max-w-full"
          />
        </Row>
        <Row label={t("task.dueDate")}>
          <TaskDueDateEditor task={task} onPatch={onPatch} className="max-w-full" />
        </Row>
        <Row label={t("task.project")}>
          <TaskProjectEditor
            task={task}
            workspaceId={workspaceId}
            onPatch={onPatch}
            className="max-w-full"
          />
        </Row>
        <Row label={t("common.labels")}>
          <TaskLabelsEditor
            task={task}
            workspaceId={workspaceId}
            onLabelsChange={onLabelsChange}
            className="max-w-full"
          />
        </Row>
      </div>

      <div className="mt-4 border-t border-border pt-4">
        <button
          type="button"
          onClick={onDelete}
          className="rounded px-2 py-1 text-xs text-destructive transition-colors hover:bg-destructive/10"
        >
          {t("task.deleteAction")}
        </button>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[4.25rem_minmax(0,1fr)] items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}
