import { useEffect, useState, type FormEvent } from "react"
import { Box, Tag, User } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { ProjectRef, TaskStatus } from "@/api/types"
import { displayError } from "@/lib/errors"
import { useCreateTask } from "@/hooks/useTasks"
import { useLabels } from "@/hooks/useLabels"
import { useMembers } from "@/hooks/useMembers"
import { useProjects } from "@/hooks/useProjects"
import { DatePicker } from "@/components/ui/date-picker"
import { DIALOG_TITLE_INPUT, FormDialog } from "@/components/ui/form-dialog"
import { labelOptions } from "@/components/ui/label-options"
import { memberOptions } from "@/components/ui/member-options"
import { projectOptions } from "@/components/ui/project-options"
import { MultiSelect, Select } from "@/components/ui/select"
import { usePriorityOptions } from "@/components/ui/priority-icon"
import { useTaskStatusOptions } from "./task-status"

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
 * project 传入时锁定归属（chip 只读展示）；labels 多选 scope=task（P1.md §3，提交带 labelIds）；
 * 裁剪 description（详情页再补）。
 */
export function CreateTaskDialog({
  open,
  workspaceId,
  project,
  defaultStatus = "todo",
  onClose,
}: CreateTaskDialogProps) {
  const { t } = useTranslation()
  const statusOptions = useTaskStatusOptions()
  const priorityOptions = usePriorityOptions()
  const createTask = useCreateTask(workspaceId)
  // 三份选项列表一律按 open 惰性启用：弹窗在宿主页面（任务列表页 / 项目详情页）常驻挂载，
  // 而行内 chip 用的是后端内嵌引用，弹窗关闭时这三个查询没有其它消费者，预取只会在页面
  // 加载时白发 GET；staleTime Infinity 下首次打开后即长期缓存，只有第一次打开付一次 RTT
  const { data: members } = useMembers(workspaceId, open)
  // 项目选项仅在未锁定归属时需要（任务列表页入口）；锁定时 chip 只读，选项永不渲染
  const { data: projects } = useProjects(workspaceId, "name", "asc", !project && open)
  // 标签选项：仅 scope=task（R6 后端兜底）
  const { data: taskLabels } = useLabels(workspaceId, "task", open)
  const [title, setTitle] = useState("")
  const [status, setStatus] = useState<TaskStatus>("todo")
  const [priority, setPriority] = useState(0)
  const [assigneeId, setAssigneeId] = useState<string | null>(null)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [dueDate, setDueDate] = useState("")
  const [labelIds, setLabelIds] = useState<string[]>([])
  // 存储原始 error（ApiError / 校验 key 字符串），渲染期经 displayError 解析，切语言即时刷新
  const [error, setError] = useState<unknown>(null)

  // 每次打开时重置表单（status 预选点击的分组）
  useEffect(() => {
    if (open) {
      setTitle("")
      setStatus(defaultStatus)
      setPriority(0)
      setAssigneeId(null)
      setProjectId(null)
      setDueDate("")
      setLabelIds([])
      setError(null)
    }
    // defaultStatus 随打开来源变化，仅在 open 翻转时消费
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const assigneeOptions = memberOptions(members, t("task.unassigned"))

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      setError("validation.titleRequired")
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
        ...(labelIds.length > 0 ? { labelIds } : {}),
      },
      {
        onSuccess: onClose,
        onError: (err) => setError(err),
      },
    )
  }

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={t("task.newTask")}
      onSubmit={onSubmit}
      error={displayError(t, error, "common.createFailed")}
      pending={createTask.isPending}
      submitLabel={t("task.createSubmit")}
      submitDisabled={!title.trim()}
    >
      <input
        value={title}
        placeholder={t("task.titlePlaceholder")}
        autoFocus
        onChange={(e) => setTitle(e.target.value)}
        className={DIALOG_TITLE_INPUT}
      />

      {/* 属性 chip 行（对齐 Linear：Status / Priority / Assignee / Due date / Project / Labels） */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={status} options={statusOptions} onChange={setStatus} />
        <Select value={priority} options={priorityOptions} onChange={setPriority} />
        <Select
          value={assigneeId ?? ""}
          options={assigneeOptions}
          onChange={(id) => setAssigneeId(id || null)}
          placeholder={
            <span className="inline-flex items-center gap-1.5">
              <User className="size-3.5" />
              {t("task.assignee")}
            </span>
          }
        />
        <DatePicker value={dueDate} onChange={setDueDate} placeholder={t("task.dueDate")} />
        {/* 项目归属：锁定时只读 chip 展示；未锁定时可选（任务可不归属项目，P0.md §3） */}
        {project ? (
          <span
            title={t("task.lockedProject", { name: project.name })}
            className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 text-xs text-ink-muted"
          >
            <Box className="size-3.5" />
            {project.name}
          </span>
        ) : (
          <Select
            value={projectId ?? ""}
            options={projectOptions(projects, t("task.noProject"))}
            onChange={(id) => setProjectId(id || null)}
            placeholder={
              <span className="inline-flex items-center gap-1.5">
                <Box className="size-3.5" />
                {t("task.project")}
              </span>
            }
          />
        )}
        <MultiSelect
          value={labelIds}
          options={labelOptions(taskLabels)}
          onChange={setLabelIds}
          placeholder={
            <span className="inline-flex items-center gap-1.5">
              <Tag className="size-3.5" />
              {t("common.labels")}
            </span>
          }
        />
      </div>
    </FormDialog>
  )
}
