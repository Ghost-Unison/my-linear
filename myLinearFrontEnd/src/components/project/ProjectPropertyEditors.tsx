import { ArrowRight, User, Users } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { ProjectDetail, ProjectStatus, UpdateProjectInput } from "@/api/types"
import { useMembers } from "@/hooks/useMembers"
import { DatePicker } from "@/components/ui/date-picker"
import { LabelsEditor } from "@/components/ui/label-picker"
import { memberOptions } from "@/components/ui/member-options"
import { MultiSelect, Select } from "@/components/ui/select"
import { usePriorityOptions } from "@/components/ui/priority-icon"
import { useProjectStatusOptions } from "./project-status"

/**
 * 项目属性 chip 编辑器集合：overview 的 Properties 行与右侧面板共用（Linear 式双呈现）。
 * 全部无本地状态——读当前 project、改即回调 onPatch（PATCH 只发送变更字段），
 * 保存后的回显由 useUpdateProject 的 setQueryData 即时驱动。
 */

interface ProjectEditorProps {
  project: ProjectDetail
  onPatch: (input: UpdateProjectInput) => void
}

/** 面板窄列下的宽度约束（MultiSelect 拼接文案可能超宽） */
interface ChipEditorProps extends ProjectEditorProps {
  className?: string
}

export function ProjectStatusEditor({ project, onPatch, className }: ChipEditorProps) {
  const options = useProjectStatusOptions()
  return (
    <Select<ProjectStatus>
      value={project.status}
      options={options}
      onChange={(status) => onPatch({ status })}
      className={className}
    />
  )
}

export function ProjectPriorityEditor({ project, onPatch, className }: ChipEditorProps) {
  const options = usePriorityOptions()
  return (
    <Select
      value={project.priority}
      options={options}
      onChange={(priority) => onPatch({ priority })}
      className={className}
    />
  )
}

interface LeadEditorProps extends ChipEditorProps {
  workspaceId: string
}

export function ProjectLeadEditor({ project, workspaceId, onPatch, className }: LeadEditorProps) {
  const { t } = useTranslation()
  const { data: members } = useMembers(workspaceId)
  return (
    <Select
      value={project.lead?.id ?? ""}
      options={memberOptions(members, t("project.noLead"))}
      className={className}
      onChange={(leadId) => {
        if (!leadId) {
          onPatch({ leadId: null })
          return
        }
        // R2 前端护栏：选为 lead 的成员自动移出 members（后端 400 兜底）
        const inMembers = project.members.some((m) => m.id === leadId)
        onPatch(
          inMembers
            ? {
                leadId,
                memberIds: project.members.filter((m) => m.id !== leadId).map((m) => m.id),
              }
            : { leadId },
        )
      }}
      placeholder={
        <span className="inline-flex items-center gap-1.5">
          <User className="size-3.5" />
          {t("project.lead")}
        </span>
      }
    />
  )
}

interface MembersEditorProps extends ChipEditorProps {
  workspaceId: string
}

export function ProjectMembersEditor({
  project,
  workspaceId,
  onPatch,
  className,
}: MembersEditorProps) {
  const { t } = useTranslation()
  const { data: members } = useMembers(workspaceId)
  // 选项排除 lead（R2）；value 同步过滤，防御历史脏数据触发后端 400
  return (
    <MultiSelect
      value={project.members
        .filter((m) => m.id !== project.lead?.id)
        .map((m) => m.id)}
      options={memberOptions(members?.filter((m) => m.id !== project.lead?.id))}
      onChange={(memberIds) => onPatch({ memberIds })}
      className={className}
      placeholder={
        <span className="inline-flex items-center gap-1.5">
          <Users className="size-3.5" />
          {t("project.members")}
        </span>
      }
    />
  )
}

/** 开始/截止两枚日期 chip，中间以 → 连接（对齐 Linear 日期区间观感）：清空 = 显式 null（api.md §1 PATCH 语义） */
export function ProjectDatesEditor({ project, onPatch }: ProjectEditorProps) {
  const { t } = useTranslation()
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <DatePicker
        value={project.startDate ?? ""}
        onChange={(v) => onPatch({ startDate: v || null })}
        placeholder={t("project.startDate")}
      />
      <ArrowRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <DatePicker
        value={project.targetDate ?? ""}
        onChange={(v) => onPatch({ targetDate: v || null })}
        placeholder={t("project.targetDate")}
      />
    </span>
  )
}

interface ProjectLabelsEditorProps {
  project: ProjectDetail
  workspaceId: string
  /** 标签走 PUT 子资源（全量替换，api.md §9），不走 onPatch 的 PATCH 通道 */
  onLabelsChange: (labelIds: string[]) => void
  className?: string
}

/**
 * Labels 行：chip 簇 + “+” 管理入口（交互实现见 ui/label-picker 的 LabelsEditor，
 * Project / Task 详情共用，仅 scope 与实体不同）；回显由 useSetProjectLabels 的
 * setQueryData 即时驱动
 */
export function ProjectLabelsEditor({
  project,
  workspaceId,
  onLabelsChange,
  className,
}: ProjectLabelsEditorProps) {
  return (
    <LabelsEditor
      labels={project.labels}
      workspaceId={workspaceId}
      scope="project"
      onLabelsChange={onLabelsChange}
      className={className}
    />
  )
}
