import { useEffect, useState, type FormEvent } from "react"
import { Box, User } from "lucide-react"
import type { ProjectRef, TaskStatus } from "@/api/types"
import { errorMessage } from "@/api/client"
import { useCreateTask } from "@/hooks/useTasks"
import { useMembers } from "@/hooks/useMembers"
import { useProjects } from "@/hooks/useProjects"
import { DatePicker } from "@/components/ui/date-picker"
import { DIALOG_TITLE_INPUT, FormDialog } from "@/components/ui/form-dialog"
import { memberOptions } from "@/components/ui/member-options"
import { projectOptions } from "@/components/ui/project-options"
import { Select } from "@/components/ui/select"
import { PRIORITY_OPTIONS } from "@/components/ui/priority-icon"
import { TASK_STATUS_OPTIONS } from "./task-status"

interface CreateTaskDialogProps {
  open: boolean
  workspaceId: string
  /** 锁定归属项目（项目详情页创建入口）；不传则可自由选择/不选（任务可不归属项目） */
  project?: ProjectRef
  /** 打开时预选状态（组头 "+" 传入对应分组，见 P0.md §3） */
  defaultStatus?: TaskStatus
  onClose: () => void
}

/**
 * 新建任务弹窗（对齐 Linear New issue）：大标题输入 + 属性 chip 行。
 * project 传入时锁定归属（chip 只读展示）；裁剪 labels（P1）与 description（详情页再补）。
 */
export function CreateTaskDialog({
  open,
  workspaceId,
  project,
  defaultStatus = "todo",
  onClose,
}: CreateTaskDialogProps) {
  const createTask = useCreateTask(workspaceId)
  const { data: members } = useMembers(workspaceId)
  // 项目选项仅在未锁定归属时查询（任务列表页入口）；锁定时 chip 只读，选项永不渲染
  const { data: projects } = useProjects(workspaceId, "name", "asc", !project)
  const [title, setTitle] = useState("")
  const [status, setStatus] = useState<TaskStatus>("todo")
  const [priority, setPriority] = useState(0)
  const [assigneeId, setAssigneeId] = useState<string | null>(null)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [dueDate, setDueDate] = useState("")
  const [error, setError] = useState<string | null>(null)

  // 每次打开时重置表单（status 预选点击的分组）
  useEffect(() => {
    if (open) {
      setTitle("")
      setStatus(defaultStatus)
      setPriority(0)
      setAssigneeId(null)
      setProjectId(null)
      setDueDate("")
      setError(null)
    }
    // defaultStatus 随打开来源变化，仅在 open 翻转时消费
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const assigneeOptions = memberOptions(members, "Unassigned")

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      setError("标题不能为空")
      return
    }
    setError(null)
    createTask.mutate(
      {
        title: trimmedTitle,
        status,
        priority,
        ...(project ? { projectId: project.id } : projectId ? { projectId } : {}),
        ...(assigneeId ? { assigneeId } : {}),
        ...(dueDate ? { dueDate } : {}),
      },
      {
        onSuccess: onClose,
        onError: (err) => setError(errorMessage(err, "创建失败")),
      },
    )
  }

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title="新建任务"
      onSubmit={onSubmit}
      error={error}
      pending={createTask.isPending}
      submitLabel="Create task"
      submitDisabled={!title.trim()}
    >
      <input
        value={title}
        placeholder="Task title"
        autoFocus
        onChange={(e) => setTitle(e.target.value)}
        className={DIALOG_TITLE_INPUT}
      />

      {/* 属性 chip 行（对齐 Linear：Status / Priority / Assignee / Due date / Project） */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={status} options={TASK_STATUS_OPTIONS} onChange={setStatus} />
        <Select value={priority} options={PRIORITY_OPTIONS} onChange={setPriority} />
        <Select
          value={assigneeId ?? ""}
          options={assigneeOptions}
          onChange={(id) => setAssigneeId(id || null)}
          placeholder={
            <span className="inline-flex items-center gap-1.5">
              <User className="size-3.5" />
              负责人
            </span>
          }
        />
        <DatePicker value={dueDate} onChange={setDueDate} placeholder="截止日期" />
        {/* 项目归属：锁定时只读 chip 展示；未锁定时可选（任务可不归属项目，P0.md §3） */}
        {project ? (
          <span
            title={`任务将归属项目 ${project.name}`}
            className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 text-xs text-ink-muted"
          >
            <Box className="size-3.5" />
            {project.name}
          </span>
        ) : (
          <Select
            value={projectId ?? ""}
            options={projectOptions(projects, "No project")}
            onChange={(id) => setProjectId(id || null)}
            placeholder={
              <span className="inline-flex items-center gap-1.5">
                <Box className="size-3.5" />
                项目
              </span>
            }
          />
        )}
      </div>
    </FormDialog>
  )
}
