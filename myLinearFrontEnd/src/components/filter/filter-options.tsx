// 过滤值选项清单与 chip 值回显：选项来源由 FieldSpec.source 驱动（P2.md §2.2）。
// 调用方按 open / chip 存在条件挂载本模块组件，选项查询天然惰性启用。
import type { ReactNode } from "react"
import type { QueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { Check } from "lucide-react"
import { useLabels } from "@/hooks/useLabels"
import { useMembers } from "@/hooks/useMembers"
import { useProjects } from "@/hooks/useProjects"
import type { LabelScope } from "@/api/types"
import { prefetchLabels } from "@/hooks/useLabels"
import { prefetchMembers } from "@/hooks/useMembers"
import { prefetchProjects } from "@/hooks/useProjects"
import {
  NONE,
  OVERDUE,
  PRIORITY_VALUES,
  PROJECT_STATUSES,
  TASK_STATUSES,
  labelScopeOf,
  ladderCodesOf,
  ladderLabelKey,
  surfaceSpecs,
  type FieldSpec,
  type Surface,
} from "@/lib/filter-state"
import { cn } from "@/lib/utils"
import { MemberAvatar } from "@/components/ui/avatar"
import { LabelDot } from "@/components/ui/label-options"

/** 选项行样式对齐 select.tsx MultiSelect / label-picker（fixed 浮层 + hover 高亮行） */
export const OPTION =
  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-accent"

/** chip 段弹层样式（对齐 select.tsx / label-picker：260px = useFixedPanelStyle 的 maxWidth 上限） */
export const PANEL = "fixed z-[60] w-[260px] rounded-md border border-border bg-popover p-1 shadow-lg"

interface ValueOption {
  value: string
  label: string
  icon?: ReactNode
}

/** 二级勾选清单选项装配：枚举本地取值；members/labels/projects 走查询（staleTime Infinity，二次打开命中缓存） */
export function useValueOptions(workspaceId: string, spec: FieldSpec, enabled: boolean) {
  const { t } = useTranslation()
  const scope = labelScopeOf(spec)
  const needMembers = spec.source === "members"
  const needLabels = scope !== undefined
  const needProjects = spec.source === "projects"
  const { data: members } = useMembers(workspaceId, enabled && needMembers)
  const { data: labels } = useLabels(workspaceId, scope, enabled && needLabels)
  // 项目选项复用列表页无条件变体缓存（全量项目，本地按名称升序）
  const { data: projects } = useProjects(workspaceId, [], enabled && needProjects)

  const options: ValueOption[] = []
  // 空伪值选项置顶（Linear 同位：No assignee 在候选列表首行）
  if (spec.allowNone) options.push({ value: NONE, label: spec.noneKey ? t(spec.noneKey) : NONE })
  switch (spec.source) {
    case "projectStatus":
      for (const s of PROJECT_STATUSES)
        options.push({ value: s, label: t(`enums.projectStatus.${s}`) })
      break
    case "taskStatus":
      for (const s of TASK_STATUSES) options.push({ value: s, label: t(`enums.taskStatus.${s}`) })
      break
    case "priority":
      for (const p of PRIORITY_VALUES) options.push({ value: p, label: t(`enums.priority.p${p}`) })
      break
    case "members":
      for (const m of members ?? [])
        options.push({
          value: m.id,
          label: m.name,
          icon: <MemberAvatar name={m.name} color={m.avatarColor || undefined} />,
        })
      break
    case "projectLabels":
    case "taskLabels":
      for (const l of labels ?? [])
        options.push({ value: l.id, label: l.name, icon: <LabelDot color={l.color} /> })
      break
    case "projects":
      for (const p of [...(projects ?? [])].sort((a, b) => a.name.localeCompare(b.name)))
        options.push({ value: p.id, label: p.name })
      break
  }
  const ready =
    (!needMembers || members !== undefined) &&
    (!needLabels || labels !== undefined) &&
    (!needProjects || projects !== undefined)
  return { options, ready }
}

/** 打开 filter 菜单时统一预取本面所需值集：members / labels(按 scope) / projects。
 *  预取委托给各数据 hook 的 prefetchXxx（queryKey/queryFn/staleTime 单源），
 *  配合 staleTime: Infinity 命中缓存——之后悬浮打开任意属性面板即秒开，零 loading。
 *  仅在主动打开菜单时触发一次（由 FilterDropdown 的 open effect 驱动）：
 *  快速划过未选中的属性不再各自发请求，消除无谓查询 */
export function prefetchFilterOptions(qc: QueryClient, workspaceId: string, surface: Surface) {
  const specs = surfaceSpecs(surface)
  // members：面内任一属性来源为成员（assignee / lead / member）
  if (specs.some((s) => s.source === "members")) prefetchMembers(qc, workspaceId)
  // labels 按 scope 去重（tasks_page=task / projects_page=project 各一档，项目面无 task 标签）
  const labelScopes = new Set<LabelScope>()
  for (const s of specs) {
    const sc = labelScopeOf(s)
    if (sc) labelScopes.add(sc)
  }
  for (const scope of labelScopes) prefetchLabels(qc, workspaceId, scope)
  // projects：筛选选项用无条件变体（与 useValueOptions 一致，命中同一缓存）
  if (specs.some((s) => s.source === "projects")) prefetchProjects(qc, workspaceId, [])
}

/** 勾选清单（菜单添加会话与 chip 值编辑共用）：行分两区——checkbox 区切换勾选；其余区（默认 = 同勾选，
 * 菜单添加会话传 onPick 走「单值成 chip 并关闭菜单」）。勾选态完全由 selected 驱动，组件无内部状态 */
export function ValueCheckList({
  workspaceId,
  spec,
  selected,
  onToggle,
  onPick = onToggle,
}: {
  workspaceId: string
  spec: FieldSpec
  selected: string[]
  onToggle: (value: string) => void
  onPick?: (value: string) => void
}) {
  const { t } = useTranslation()
  const { options, ready } = useValueOptions(workspaceId, spec, true)
  if (!ready)
    return <div className="px-2 py-4 text-center text-xs text-muted-foreground">{t("common.loading")}</div>
  return (
    <div className="max-h-56 overflow-y-auto">
      {options.map((o) => {
        const checked = selected.includes(o.value)
        return (
          <div
            key={o.value}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-accent"
          >
            <button
              type="button"
              aria-label={o.label}
              title={o.label}
              onClick={() => onToggle(o.value)}
              className={cn(
                "flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border",
                checked ? "border-primary bg-primary text-white" : "border-border",
              )}
            >
              {checked && <Check className="size-2.5" />}
            </button>
            {o.icon}
            <button
              type="button"
              onClick={() => onPick(o.value)}
              className="min-w-0 flex-1 truncate text-left"
            >
              {o.label}
            </button>
          </div>
        )
      })}
    </div>
  )
}

/** 日期条件值编辑清单（chip 值段）：阶梯单选替换语义 + Overdue / none 哨兵行（字段提供时） */
export function LadderEditList({
  spec,
  selected,
  onPick,
}: {
  spec: FieldSpec
  selected: string[]
  onPick: (value: string) => void
}) {
  const { t } = useTranslation()
  const Row = ({ value, label }: { value: string; label: string }) => (
    <button type="button" className={OPTION} onClick={() => onPick(value)}>
      <span className="flex-1 truncate text-left">{label}</span>
      {selected.includes(value) && <Check className="size-3.5 shrink-0" />}
    </button>
  )
  return (
    <div className="max-h-56 overflow-y-auto">
      {spec.allowOverdue && <Row value={OVERDUE} label={t("filter.ladder.overdue")} />}
      {ladderCodesOf(spec).map((code) => (
        <Row key={code} value={code} label={t(ladderLabelKey(spec, code))} />
      ))}
      {spec.allowNone && spec.noneKey && <Row value={NONE} label={t(spec.noneKey)} />}
    </div>
  )
}

/** chip 值段回显解析器：仅按字段来源启用所需查询（枚举零查询、members/labels/projects 按需），
 *  labels 按 scope 走 scope 变体以命中预取缓存；未命中回退原值（如已删成员 id）；
 *  日期阶梯文案随字段方向切 ago / from now，overdue 谓词走专键 */
export function useValueLabel(workspaceId: string, spec: FieldSpec) {
  const { t } = useTranslation()
  const scope = labelScopeOf(spec)
  const needMembers = spec.source === "members"
  const needLabels = scope !== undefined
  const needProjects = spec.source === "projects"
  const { data: members } = useMembers(workspaceId, needMembers)
  const { data: labels } = useLabels(workspaceId, scope, needLabels)
  const { data: projects } = useProjects(workspaceId, [], needProjects)
  return (value: string): string => {
    if (value === NONE) return spec.noneKey ? t(spec.noneKey) : value
    if (value === OVERDUE) return t("filter.ladder.overdue")
    switch (spec.source) {
      case "projectStatus":
        return t(`enums.projectStatus.${value}`)
      case "taskStatus":
        return t(`enums.taskStatus.${value}`)
      case "priority":
        return t(`enums.priority.p${value}`)
      case "members":
        return members?.find((m) => m.id === value)?.name ?? value
      case "projectLabels":
      case "taskLabels":
        return labels?.find((l) => l.id === value)?.name ?? value
      case "projects":
        return projects?.find((p) => p.id === value)?.name ?? value
      default:
        return spec.kind === "day" || spec.kind === "moment" ? t(ladderLabelKey(spec, value)) : value
    }
  }
}
