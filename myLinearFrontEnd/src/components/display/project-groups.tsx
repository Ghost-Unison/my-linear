// 项目列表分组渲染（P2-B）：两级组头形态对齐 Linear 实测（用户定案 3 图5）——
// 一级 = 灰底圆角行（icon + 值名 + 计数），二级 = 值名 + 右侧延伸横线；
// 组值回显（icon/文案）与 filter 同值源（成员/标签清单、枚举、日期桶）。
// 展示细节批③：两级组头均可折叠（chevron，纯内存刷新重置）；
// ⑤：组头 “+” 常显且 sticky 钉在视口右缘（横向滚动不需拖到底），打开创建弹窗预填组路径值；
// 多值属性重复入组由引擎保证，计数含跨组重复。
import { useState, type ReactNode } from "react"
import type { TFunction } from "i18next"
import { useTranslation } from "react-i18next"
import { ChevronDown, ChevronRight, Plus } from "lucide-react"
import type { ProjectRow, ProjectStatus } from "@/api/types"
import { useLabels } from "@/hooks/useLabels"
import { useMembers } from "@/hooks/useMembers"
import { isZhLocale } from "@/i18n"
import {
  needsLabels,
  needsMembers,
  type GroupContext,
  type GroupField,
  type GroupNode,
  type ProjectDisplayState,
  type Timeframe,
} from "@/lib/display-state"
import { NONE } from "@/lib/filter-state"
import { cn } from "@/lib/utils"
import type { CreateProjectInitial } from "@/components/project/CreateProjectDialog"
import { MemberAvatar } from "@/components/ui/avatar"
import { LabelDot } from "@/components/ui/label-options"
import { PriorityIcon } from "@/components/ui/priority-icon"
import { ProjectStatusIcon } from "@/components/project/project-status"

/** 日期桶 key → 展示文案：月走 Intl 短月名（en "Oct 2026" / zh "2026年10月"），
 *  季/半年走 i18n 键插值，年直接数字 */
export function bucketLabel(key: string, tf: Timeframe, lang: string, t: TFunction): string {
  if (tf === "month") {
    const [y, m] = key.split("-")
    return new Intl.DateTimeFormat(isZhLocale(lang) ? "zh-CN" : "en-US", {
      month: "short",
      year: "numeric",
    }).format(new Date(Number(y), Number(m) - 1, 1))
  }
  if (tf === "quarter") {
    const [y, q] = key.split("-Q")
    return t("display.bucketQuarter", { year: y, quarter: q })
  }
  if (tf === "half") {
    const [y, h] = key.split("-H")
    return t(h === "1" ? "display.bucketHalf1" : "display.bucketHalf2", { year: y })
  }
  return key
}

/** 时刻列短日期（Created/Updated 列）：en "Aug 26" / zh "8月26日" */
export const fmtDay = (iso: string, lang: string): string =>
  new Intl.DateTimeFormat(isZhLocale(lang) ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(iso))

export interface GroupValueMeta {
  label: string
  icon?: ReactNode
}

/** 组值回显解析器：members/labels 清单按分组属性惰性启用（staleTime Infinity 命中缓存）；
 *  ready = 组序依赖的异步值集就绪（未就绪时页面不渲染分组，避免组序闪变） */
export function useGroupValueMeta(workspaceId: string, state: ProjectDisplayState) {
  const { t, i18n } = useTranslation()
  const { data: members } = useMembers(workspaceId, needsMembers(state))
  const { data: labels } = useLabels(workspaceId, "project", needsLabels(state))
  const ready =
    (!needsMembers(state) || members !== undefined) &&
    (!needsLabels(state) || labels !== undefined)
  // 组序上下文：实体组序 = 值集清单序（P2.md §3.1），与 filter 值集合单源
  const ctx: GroupContext = {
    timeframe: state.timeframe,
    memberIds: (members ?? []).map((m) => m.id),
    labelIds: (labels ?? []).map((l) => l.id),
  }
  const meta = (field: GroupField, value: string): GroupValueMeta => {
    switch (field) {
      case "status":
        return {
          label: t(`enums.projectStatus.${value}`),
          icon: <ProjectStatusIcon status={value as ProjectStatus} />,
        }
      case "priority":
        return { label: t(`enums.priority.p${value}`), icon: <PriorityIcon value={Number(value)} /> }
      case "lead":
      case "member": {
        if (value === NONE)
          return { label: field === "lead" ? t("project.noLead") : t("display.noMember") }
        const m = members?.find((x) => x.id === value)
        return {
          label: m?.name ?? value,
          icon: m ? <MemberAvatar name={m.name} color={m.avatarColor || undefined} /> : undefined,
        }
      }
      case "label": {
        if (value === NONE) return { label: t("filter.noLabels") }
        const l = labels?.find((x) => x.id === value)
        return { label: l?.name ?? value, icon: l ? <LabelDot color={l.color} /> : undefined }
      }
      default:
        // 日期桶：NONE = No start/target date 组
        if (value === NONE)
          return {
            label: field === "startDate" ? t("filter.noStartDate") : t("display.noTargetDate"),
          }
        return { label: bucketLabel(value, state.timeframe, i18n.language, t) }
    }
  }
  return { ready, ctx, meta }
}

/** 节点计数：叶子 = 直挂行数；带二级 = 各二级子组行数合计（多值含跨组重复） */
const groupCount = (g: GroupNode): number =>
  g.children.length > 0 ? g.children.reduce((sum, c) => sum + c.rows.length, 0) : g.rows.length

/** 日期桶 key → 桶首日（⑤ 预填：新项目落进该桶）：月 YYYY-MM / 季 YYYY-Qn / 半年 YYYY-Hn / 年 YYYY */
const bucketStart = (key: string): string => {
  const [y, rest] = key.split("-")
  const month = rest?.startsWith("Q")
    ? (Number(rest.slice(1)) - 1) * 3 + 1
    : rest?.startsWith("H")
      ? rest === "H1" ? 1 : 7
      : rest
        ? Number(rest)
        : 1
  return `${y}-${String(month).padStart(2, "0")}-01`
}

/** 组值 → 创建弹窗预填（⑤）：NONE 组无自有值可预填（空对象 = 仅继承组路径，新项目天然落入 No X 组）；
 *  日期桶预填桶首日 */
const groupInitial = (field: GroupField, value: string): CreateProjectInitial => {
  switch (field) {
    case "status":
      return { status: value as ProjectStatus }
    case "priority":
      return { priority: Number(value) }
    case "lead":
      return value === NONE ? {} : { leadId: value }
    case "member":
      return value === NONE ? {} : { memberIds: [value] }
    case "label":
      return value === NONE ? {} : { labelIds: [value] }
    case "startDate":
      return value === NONE ? {} : { startDate: bucketStart(value) }
    default:
      return value === NONE ? {} : { targetDate: bucketStart(value) }
  }
}

/** 两级分组树渲染（③ 折叠 + ⑤ 组头 “+”）：renderRows 由页面注入（行网格/列配置在页面侧单源）；
 *  collapsed 键 = 组路径（一级 field:value，二级拼父路径），纯内存刷新重置 */
export function ProjectGroupTree({
  groups,
  meta,
  renderRows,
  onAdd,
}: {
  groups: GroupNode[]
  meta: (field: GroupField, value: string) => GroupValueMeta
  renderRows: (rows: ProjectRow[], depth: number) => ReactNode
  onAdd?: (initial: CreateProjectInitial) => void
}) {
  const [collapsed, setCollapsed] = useState<Record<string, true>>({})
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = { ...prev }
      if (next[key]) delete next[key]
      else next[key] = true
      return next
    })
  return (
    <GroupLevel
      groups={groups}
      depth={1}
      meta={meta}
      renderRows={renderRows}
      onAdd={onAdd}
      collapsed={collapsed}
      onToggle={toggle}
      parentKey=""
      inherited={{}}
    />
  )
}

function GroupLevel({
  groups,
  depth,
  meta,
  renderRows,
  onAdd,
  collapsed,
  onToggle,
  parentKey,
  inherited,
}: {
  groups: GroupNode[]
  depth: 1 | 2
  meta: (field: GroupField, value: string) => GroupValueMeta
  renderRows: (rows: ProjectRow[], depth: number) => ReactNode
  onAdd?: (initial: CreateProjectInitial) => void
  collapsed: Record<string, true>
  onToggle: (key: string) => void
  parentKey: string
  inherited: CreateProjectInitial
}) {
  const { t } = useTranslation()
  return (
    <>
      {groups.map((g) => {
        const m = meta(g.field, g.value)
        const key = `${parentKey}${g.field}:${g.value}`
        const isCollapsed = !!collapsed[key]
        // ⑤ 预填 = 组路径累积（二级组含一级值；NONE 组仅继承）
        const merged = { ...inherited, ...groupInitial(g.field, g.value) }
        const addLabel = t("project.newProjectIn", { group: m.label })
        return (
          <div key={key} className={depth === 1 ? "mt-3 first:mt-0" : "mt-1"}>
            {depth === 1 ? (
              <div
                onClick={() => onToggle(key)}
                className="flex cursor-pointer items-center gap-2 rounded-md bg-surface-2 px-3 py-1.5"
              >
                <ChevronButton
                  collapsed={isCollapsed}
                  label={t("display.toggleCollapse")}
                  onClick={() => onToggle(key)}
                />
                {m.icon}
                <span className="truncate text-sm font-medium text-foreground">{m.label}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{groupCount(g)}</span>
                {onAdd && (
                  <AddButton
                    className="ml-auto bg-surface-2"
                    label={addLabel}
                    onClick={() => onAdd(merged)}
                  />
                )}
              </div>
            ) : (
              <div
                onClick={() => onToggle(key)}
                className="flex cursor-pointer items-center gap-2 px-3 py-1"
              >
                <ChevronButton
                  collapsed={isCollapsed}
                  label={t("display.toggleCollapse")}
                  onClick={() => onToggle(key)}
                />
                {m.icon}
                <span className="shrink-0 truncate text-sm font-medium text-foreground">{m.label}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{groupCount(g)}</span>
                <span className="mx-2 h-px flex-1 bg-border" />
                {onAdd && (
                  <AddButton
                    className="bg-background"
                    label={addLabel}
                    onClick={() => onAdd(merged)}
                  />
                )}
              </div>
            )}
            {!isCollapsed &&
              (g.children.length > 0 ? (
                <GroupLevel
                  groups={g.children}
                  depth={2}
                  meta={meta}
                  renderRows={renderRows}
                  onAdd={onAdd}
                  collapsed={collapsed}
                  onToggle={onToggle}
                  parentKey={`${key}/`}
                  inherited={merged}
                />
              ) : (
                renderRows(g.rows, depth)
              ))}
          </div>
        )
      })}
    </>
  )
}

/** 组头折叠 chevron（③）：点击与点组头行等效（stopPropagation 防双重 toggle） */
function ChevronButton({
  collapsed,
  label,
  onClick,
}: {
  collapsed: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="flex size-4 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
    >
      {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
    </button>
  )
}

/** 组头 “+”（⑤）：常显 + sticky 钉在横向滚动视口右缘（列溢出时无需拖到内容最右）；
 *  bg 由调用方按组头底色传入，遮住行内横向滚过的文案 */
function AddButton({
  label,
  onClick,
  className,
}: {
  label: string
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={cn(
        "sticky right-0 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        className,
      )}
    >
      <Plus className="size-3.5" />
    </button>
  )
}
