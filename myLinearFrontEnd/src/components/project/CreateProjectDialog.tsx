import { useEffect, useState, type FormEvent } from "react"
import { Tag, User, Users } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { ProjectStatus } from "@/api/types"
import { displayError } from "@/lib/errors"
import { useCreateProject } from "@/hooks/useProjects"
import { useLabels } from "@/hooks/useLabels"
import { useMembers } from "@/hooks/useMembers"
import { DatePicker } from "@/components/ui/date-picker"
import { DIALOG_TITLE_INPUT, FormDialog } from "@/components/ui/form-dialog"
import { labelOptions } from "@/components/ui/label-options"
import { memberOptions } from "@/components/ui/member-options"
import { MultiSelect, Select } from "@/components/ui/select"
import { usePriorityOptions } from "@/components/ui/priority-icon"
import { useProjectStatusOptions } from "@/components/project/project-status"

// 选项集经 hook 复用 priority-icon / project-status（与详情属性编辑器同源，随语言切换刷新）

/** 创建弹窗预填（展示细节批⑤：分组头 “+” 带入组路径值）；缺省回默认约定 */
export interface CreateProjectInitial {
  status?: ProjectStatus
  priority?: number
  leadId?: string | null
  memberIds?: string[]
  labelIds?: string[]
  startDate?: string
  targetDate?: string
}

/**
 * 新建项目弹窗（对齐 Linear New project，见 P0.md §2）：
 * 大标题输入 + 属性 chip 行 + 描述；labels 多选 scope=project（P1.md §3，提交带 labelIds）；
 * 裁剪 Dependencies / Milestones
 * 默认值约定：status=backlog、priority=0（No priority），均为前端必传
 */
export function CreateProjectDialog({
  open,
  workspaceId,
  initial,
  onClose,
}: {
  open: boolean
  workspaceId: string
  initial?: CreateProjectInitial
  onClose: () => void
}) {
  const { t } = useTranslation()
  const statusOptions = useProjectStatusOptions()
  const priorityOptions = usePriorityOptions()
  const createProject = useCreateProject(workspaceId)
  // 两份选项列表按 open 惰性启用（同 CreateTaskDialog）：弹窗在项目列表页常驻挂载，
  // 而列表行的 lead 用后端内嵌引用、标签 P1 不渲染，弹窗关闭时无其它消费者
  const { data: members } = useMembers(workspaceId, open)
  // 标签选项：仅 scope=project（R6 后端兜底）
  const { data: projectLabels } = useLabels(workspaceId, "project", open)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [status, setStatus] = useState<ProjectStatus>("backlog")
  const [priority, setPriority] = useState(0)
  const [leadId, setLeadId] = useState<string | null>(null)
  const [memberIds, setMemberIds] = useState<string[]>([])
  const [startDate, setStartDate] = useState("")
  const [targetDate, setTargetDate] = useState("")
  const [labelIds, setLabelIds] = useState<string[]>([])
  // 存储原始 error（ApiError / 校验 key 字符串），渲染期经 displayError 解析，切语言即时刷新
  const [error, setError] = useState<unknown>(null)

  // 每次打开时重置表单（默认值见上方约定；initial 预填覆盖其上）
  useEffect(() => {
    if (open) {
      setName("")
      setDescription("")
      setStatus(initial?.status ?? "backlog")
      setPriority(initial?.priority ?? 0)
      setLeadId(initial?.leadId ?? null)
      // R2 互斥护栏：预填 members 剔除与 lead 撞车的 id
      setMemberIds((initial?.memberIds ?? []).filter((m) => m !== (initial?.leadId ?? null)))
      setStartDate(initial?.startDate ?? "")
      setTargetDate(initial?.targetDate ?? "")
      setLabelIds(initial?.labelIds ?? [])
      setError(null)
    }
  }, [open, initial])

  // R2 前端护栏：lead 与 members 互斥——选为 lead 的成员自动移出 members
  const changeLead = (id: string) => {
    const next = id || null
    setLeadId(next)
    if (next) setMemberIds((prev) => prev.filter((m) => m !== next))
  }

  const leadOptions = memberOptions(members, t("project.noLead"))
  // members 选项排除当前 lead
  const memberOptionsExclLead = memberOptions(members?.filter((m) => m.id !== leadId))

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError("validation.nameRequired")
      return
    }
    setError(null)
    const trimmedDesc = description.trim()
    createProject.mutate(
      {
        name: trimmedName,
        ...(trimmedDesc ? { description: trimmedDesc } : {}),
        status,
        priority,
        ...(leadId ? { leadId } : {}),
        ...(memberIds.length > 0 ? { memberIds } : {}),
        ...(startDate ? { startDate } : {}),
        ...(targetDate ? { targetDate } : {}),
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
      title={t("project.newProject")}
      onSubmit={onSubmit}
      error={displayError(t, error, "common.createFailed")}
      pending={createProject.isPending}
      submitLabel={t("project.createSubmit")}
      submitDisabled={!name.trim()}
    >
      <input
        value={name}
        placeholder={t("project.namePlaceholder")}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        className={DIALOG_TITLE_INPUT}
      />

      {/* 属性 chip 行（对齐 Linear：Backlog / No priority / Lead / Members / Start / Target / Labels） */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={status} options={statusOptions} onChange={setStatus} />
        <Select value={priority} options={priorityOptions} onChange={setPriority} />
        <Select
          value={leadId ?? ""}
          options={leadOptions}
          onChange={changeLead}
          placeholder={
            <span className="inline-flex items-center gap-1.5">
              <User className="size-3.5" />
              {t("project.lead")}
            </span>
          }
        />
        <MultiSelect
          value={memberIds}
          options={memberOptionsExclLead}
          onChange={setMemberIds}
          placeholder={
            <span className="inline-flex items-center gap-1.5">
              <Users className="size-3.5" />
              {t("project.members")}
            </span>
          }
        />
        <DatePicker value={startDate} onChange={setStartDate} placeholder={t("project.startDate")} />
        <DatePicker value={targetDate} onChange={setTargetDate} placeholder={t("project.targetDate")} />
        <MultiSelect
          value={labelIds}
          options={labelOptions(projectLabels)}
          onChange={setLabelIds}
          placeholder={
            <span className="inline-flex items-center gap-1.5">
              <Tag className="size-3.5" />
              {t("common.labels")}
            </span>
          }
        />
      </div>

      <textarea
        value={description}
        placeholder={t("project.descPlaceholder")}
        onChange={(e) => setDescription(e.target.value)}
        className="min-h-36 w-full resize-none bg-transparent text-sm text-foreground placeholder:text-ink-tertiary focus-visible:outline-none"
      />
    </FormDialog>
  )
}
