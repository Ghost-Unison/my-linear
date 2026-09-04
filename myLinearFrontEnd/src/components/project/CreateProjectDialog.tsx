import { useEffect, useState, type FormEvent } from "react"
import { User, Users } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { ProjectStatus } from "@/api/types"
import { displayError } from "@/lib/errors"
import { useCreateProject } from "@/hooks/useProjects"
import { useMembers } from "@/hooks/useMembers"
import { DatePicker } from "@/components/ui/date-picker"
import { DIALOG_TITLE_INPUT, FormDialog } from "@/components/ui/form-dialog"
import { memberOptions } from "@/components/ui/member-options"
import { MultiSelect, Select } from "@/components/ui/select"
import { usePriorityOptions } from "@/components/ui/priority-icon"
import { useProjectStatusOptions } from "@/components/project/project-status"

// 选项集经 hook 复用 priority-icon / project-status（与详情属性编辑器同源，随语言切换刷新）

/**
 * 新建项目弹窗（对齐 Linear New project，见 P0.md §2）：
 * 大标题输入 + 属性 chip 行 + 描述；裁剪 Dependencies / Milestones / Labels（P1）
 * 默认值约定：status=backlog、priority=0（No priority），均为前端必传
 */
export function CreateProjectDialog({
  open,
  workspaceId,
  onClose,
}: {
  open: boolean
  workspaceId: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const statusOptions = useProjectStatusOptions()
  const priorityOptions = usePriorityOptions()
  const createProject = useCreateProject(workspaceId)
  const { data: members } = useMembers(workspaceId)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [status, setStatus] = useState<ProjectStatus>("backlog")
  const [priority, setPriority] = useState(0)
  const [leadId, setLeadId] = useState<string | null>(null)
  const [memberIds, setMemberIds] = useState<string[]>([])
  const [startDate, setStartDate] = useState("")
  const [targetDate, setTargetDate] = useState("")
  // 存储原始 error（ApiError / 校验 key 字符串），渲染期经 displayError 解析，切语言即时刷新
  const [error, setError] = useState<unknown>(null)

  // 每次打开时重置表单（默认值见上方约定）
  useEffect(() => {
    if (open) {
      setName("")
      setDescription("")
      setStatus("backlog")
      setPriority(0)
      setLeadId(null)
      setMemberIds([])
      setStartDate("")
      setTargetDate("")
      setError(null)
    }
  }, [open])

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

      {/* 属性 chip 行（对齐 Linear：Backlog / No priority / Lead / Members / Start / Target） */}
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
