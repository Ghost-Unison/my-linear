import { Box, User } from "lucide-react"
import type { TaskDetail, TaskStatus, UpdateTaskInput } from "@/api/types"
import { useMembers } from "@/hooks/useMembers"
import { useProjects } from "@/hooks/useProjects"
import { DatePicker } from "@/components/ui/date-picker"
import { memberOptions } from "@/components/ui/member-options"
import { projectOptions } from "@/components/ui/project-options"
import { PRIORITY_OPTIONS } from "@/components/ui/priority-icon"
import { Select } from "@/components/ui/select"
import { TASK_STATUS_OPTIONS } from "./task-status"

/**
 * 任务属性 chip 编辑器集合：详情页内容区与右侧面板共用（Linear 式双呈现，对称 ProjectPropertyEditors）。
 * 全部无本地状态——读当前 task、改即回调 onPatch（PATCH 只发送变更字段），
 * 保存后的回显由 useUpdateTask 的 setQueryData 即时驱动。
 */

interface TaskEditorProps {
  task: TaskDetail
  onPatch: (input: UpdateTaskInput) => void
}

/** 面板窄列下的宽度约束 */
interface ChipEditorProps extends TaskEditorProps {
  className?: string
}

export function TaskStatusEditor({ task, onPatch, className }: ChipEditorProps) {
  return (
    <Select<TaskStatus>
      value={task.status}
      options={TASK_STATUS_OPTIONS}
      onChange={(status) => onPatch({ status })}
      className={className}
    />
  )
}

export function TaskPriorityEditor({ task, onPatch, className }: ChipEditorProps) {
  return (
    <Select
      value={task.priority}
      options={PRIORITY_OPTIONS}
      onChange={(priority) => onPatch({ priority })}
      className={className}
    />
  )
}

interface WorkspaceEditorProps extends ChipEditorProps {
  workspaceId: string
}

/** assignee 仅校验 workspace 成员（R3，与项目 lead/members 解绑）；空位项 = 取消指派 */
export function TaskAssigneeEditor({ task, workspaceId, onPatch, className }: WorkspaceEditorProps) {
  const { data: members } = useMembers(workspaceId)
  return (
    <Select
      value={task.assignee?.id ?? ""}
      options={memberOptions(members, "Unassigned")}
      onChange={(assigneeId) => onPatch({ assigneeId: assigneeId || null })}
      className={className}
      placeholder={
        <span className="inline-flex items-center gap-1.5">
          <User className="size-3.5" />
          负责人
        </span>
      }
    />
  )
}

/** 清空 = 显式 null（api.md §1 PATCH 语义） */
export function TaskDueDateEditor({ task, onPatch, className }: ChipEditorProps) {
  return (
    <DatePicker
      value={task.dueDate ?? ""}
      onChange={(v) => onPatch({ dueDate: v || null })}
      placeholder="截止日期"
      className={className}
    />
  )
}

/** project 可改挂/置空（变更时后端同步整棵子树，R4）；选项按名称排序 */
export function TaskProjectEditor({ task, workspaceId, onPatch, className }: WorkspaceEditorProps) {
  const { data: projects } = useProjects(workspaceId, "name", "asc")
  return (
    <Select
      value={task.project?.id ?? ""}
      options={projectOptions(projects, "No project")}
      onChange={(projectId) => onPatch({ projectId: projectId || null })}
      className={className}
      placeholder={
        <span className="inline-flex items-center gap-1.5">
          <Box className="size-3.5" />
          项目
        </span>
      }
    />
  )
}
