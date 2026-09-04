import type { ReactNode } from "react"
import type { TaskDetail, UpdateTaskInput } from "@/api/types"
import {
  TaskAssigneeEditor,
  TaskDueDateEditor,
  TaskPriorityEditor,
  TaskProjectEditor,
  TaskStatusEditor,
} from "./TaskPropertyEditors"

interface TaskPropertiesPanelProps {
  task: TaskDetail
  workspaceId: string
  onPatch: (input: UpdateTaskInput) => void
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
  onDelete,
}: TaskPropertiesPanelProps) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-xs font-medium text-muted-foreground">Properties</h2>

      <div className="flex flex-col gap-3">
        <Row label="Status">
          <TaskStatusEditor task={task} onPatch={onPatch} className="max-w-full" />
        </Row>
        <Row label="Priority">
          <TaskPriorityEditor task={task} onPatch={onPatch} className="max-w-full" />
        </Row>
        <Row label="Assignee">
          <TaskAssigneeEditor
            task={task}
            workspaceId={workspaceId}
            onPatch={onPatch}
            className="max-w-full"
          />
        </Row>
        <Row label="Due date">
          <TaskDueDateEditor task={task} onPatch={onPatch} className="max-w-full" />
        </Row>
        <Row label="Project">
          <TaskProjectEditor
            task={task}
            workspaceId={workspaceId}
            onPatch={onPatch}
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
          Delete task
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
