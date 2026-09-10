import { Box, User } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { TaskDetail, TaskStatus, UpdateTaskInput } from "@/api/types"
import { useMembers } from "@/hooks/useMembers"
import { useProjects } from "@/hooks/useProjects"
import { DatePicker } from "@/components/ui/date-picker"
import { LabelsEditor } from "@/components/ui/label-picker"
import { memberOptions } from "@/components/ui/member-options"
import { projectOptions } from "@/components/ui/project-options"
import { usePriorityOptions } from "@/components/ui/priority-icon"
import { Select } from "@/components/ui/select"
import { useTaskStatusOptions } from "./task-status"

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
  const options = useTaskStatusOptions()
  return (
    <Select<TaskStatus>
      value={task.status}
      options={options}
      onChange={(status) => onPatch({ status })}
      className={className}
    />
  )
}

export function TaskPriorityEditor({ task, onPatch, className }: ChipEditorProps) {
  const options = usePriorityOptions()
  return (
    <Select
      value={task.priority}
      options={options}
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
  const { t } = useTranslation()
  const { data: members } = useMembers(workspaceId)
  return (
    <Select
      value={task.assignee?.id ?? ""}
      options={memberOptions(members, t("task.unassigned"))}
      onChange={(assigneeId) => onPatch({ assigneeId: assigneeId || null })}
      className={className}
      placeholder={
        <span className="inline-flex items-center gap-1.5">
          <User className="size-3.5" />
          {t("task.assignee")}
        </span>
      }
    />
  )
}

/** 清空 = 显式 null（api.md §1 PATCH 语义） */
export function TaskDueDateEditor({ task, onPatch, className }: ChipEditorProps) {
  const { t } = useTranslation()
  return (
    <DatePicker
      value={task.dueDate ?? ""}
      onChange={(v) => onPatch({ dueDate: v || null })}
      placeholder={t("task.dueDate")}
      className={className}
    />
  )
}

/** project 可改挂/置空（变更时后端同步整棵子树，R4）；选项按名称排序（projectOptions 本地排） */
export function TaskProjectEditor({ task, workspaceId, onPatch, className }: WorkspaceEditorProps) {
  const { t } = useTranslation()
  const { data: projects } = useProjects(workspaceId)
  return (
    <Select
      value={task.project?.id ?? ""}
      options={projectOptions(projects, t("task.noProject"))}
      onChange={(projectId) => onPatch({ projectId: projectId || null })}
      className={className}
      placeholder={
        <span className="inline-flex items-center gap-1.5">
          <Box className="size-3.5" />
          {t("task.project")}
        </span>
      }
    />
  )
}

interface TaskLabelsEditorProps {
  task: TaskDetail
  workspaceId: string
  /** 标签走 PUT 子资源（全量替换，api.md §9），不走 onPatch 的 PATCH 通道 */
  onLabelsChange: (labelIds: string[]) => void
  className?: string
}

/**
 * Labels 行：chip 簇 + “+” 管理入口（交互实现见 ui/label-picker 的 LabelsEditor，
 * Project / Task 详情共用，仅 scope 与实体不同：点 chip 或 “+” 开同一面板，可搜索、
 * 复选、无匹配时就地新建选色）；每次增删即发 PUT 全量替换，回显由 useSetTaskLabels
 * 的 setQueryData 即时驱动
 */
export function TaskLabelsEditor({ task, workspaceId, onLabelsChange, className }: TaskLabelsEditorProps) {
  return (
    <LabelsEditor
      labels={task.labels}
      workspaceId={workspaceId}
      scope="task"
      onLabelsChange={onLabelsChange}
      className={className}
    />
  )
}
