import { useMemo, type CSSProperties, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { ArrowDown, ArrowUp, Box } from "lucide-react"
import type { ProjectRow } from "@/api/types"
import { colorFor } from "@/lib/color"
import {
  applyShowClosed,
  buildGroups,
  gridTemplateCols,
  orderFieldColumn,
  sortRows,
  tableMinRem,
  visibleColumns,
  type ColumnDef,
  type OrderField,
  type ProjectColumn,
  type ProjectDisplayState,
} from "@/lib/display-state"
import { cn } from "@/lib/utils"
import { MemberAvatar } from "@/components/ui/avatar"
import { LabelDot } from "@/components/ui/label-options"
import { PriorityIcon, usePriorityLabel } from "@/components/ui/priority-icon"
import { fmtDay, ProjectGroupTree, useGroupValueMeta } from "@/components/display/project-groups"
import type { CreateProjectInitial } from "@/components/project/CreateProjectDialog"
import { ProjectStatusIcon, useProjectStatusLabel } from "@/components/project/project-status"

export interface ProjectViewListProps {
  projects: ProjectRow[]
  state: ProjectDisplayState
  workspaceId: string
  onChange: (state: ProjectDisplayState) => void
  onOpenProject: (id: string) => void
  onNewProject?: (initial?: CreateProjectInitial) => void
  /** 覆盖表体但保留表头；仅 undefined 渲染正常列表，null 可用于隐藏表体。 */
  content?: ReactNode
  /** 同 Display、同完整组路径的计数基准；只用于组头，不补入当前列表。 */
  baselineProjects?: ProjectRow[]
}

/** 项目共享展示层：只管理表格最小宽度，滚动、取数、空态及创建生命周期由调用方持有。 */
export function ProjectViewList({
  projects,
  state,
  workspaceId,
  onChange,
  onOpenProject,
  onNewProject,
  content,
  baselineProjects,
}: ProjectViewListProps) {
  const { t, i18n } = useTranslation()
  // 列配置单源：可见列 → 网格模板 / 保底宽（inline style，Tailwind JIT 编译不到动态 arbitrary class）
  const cols = useMemo(() => visibleColumns(state), [state])
  const gridStyle = useMemo<CSSProperties>(
    () => ({ gridTemplateColumns: gridTemplateCols(cols) }),
    [cols],
  )
  const minWStyle = useMemo<CSSProperties>(
    () => ({ minWidth: `${tableMinRem(cols)}rem` }),
    [cols],
  )

  const { ready, ctx, meta } = useGroupValueMeta(workspaceId, state)
  // 基底管线：showClosed（基底 AND：filter 取回但关闭态前端隐藏）→ ordering → 分组
  const baseRows = useMemo(
    () => applyShowClosed(projects, state.showClosed),
    [projects, state.showClosed],
  )
  const orderedRows = useMemo(
    () => sortRows(baseRows, state.orderField, state.orderDir),
    [baseRows, state.orderField, state.orderDir],
  )
  const groups = useMemo(
    () => state.grouping !== "none" && ready ? buildGroups(orderedRows, state, ctx) : [],
    [orderedRows, state, ctx, ready],
  )
  const baselineGroups = useMemo(() => {
    if (baselineProjects === undefined) return undefined
    if (state.grouping === "none" || !ready) return []
    return buildGroups(applyShowClosed(baselineProjects, state.showClosed), state, ctx)
  }, [baselineProjects, state, ctx, ready])

  // 表头排序联动（用户定案 6）：点列头 = 写 ordering 状态；同列翻方向，新列复位 asc + 自动勾选对应列
  const toggleOrder = (field: OrderField) => {
    if (state.orderField === field) {
      onChange({
        ...state,
        orderDir: state.orderDir === "asc" ? "desc" : "asc",
      })
    } else {
      const col = orderFieldColumn(field)
      onChange({
        ...state,
        orderField: field,
        orderDir: "asc",
        ...(col && !state.visible[col]
          ? { visible: { ...state.visible, [col]: true } }
          : {}),
      })
    }
  }

  const renderRows = (rows: ProjectRow[], depth: number) =>
    rows.map((p) => (
      <ProjectListRow
        key={p.id}
        project={p}
        cols={cols}
        gridStyle={gridStyle}
        depth={depth}
        lang={i18n.language}
        onOpen={() => onOpenProject(p.id)}
      />
    ))

  const headerCell = (c: ColumnDef) => {
    const label = t(c.labelKey)
    // 无 ordering 映射的列（Lead/Members/Labels/Issues）不可点
    if (!c.orderField) {
      return (
        <span key={c.key} className={c.alignRight ? "text-right" : undefined}>
          {label}
        </span>
      )
    }
    const active = state.orderField === c.orderField
    return (
      <button
        key={c.key}
        onClick={() => toggleOrder(c.orderField!)}
        className={cn(
          "flex items-center gap-1 text-left transition-colors hover:text-foreground",
          active && "text-foreground",
          c.alignRight && "justify-end",
        )}
      >
        {label}
        {active &&
          (state.orderDir === "asc" ? (
            <ArrowUp className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          ))}
      </button>
    )
  }

  return (
    <div style={minWStyle} className="pb-6">
      <div
        style={gridStyle}
        className="mt-2 grid gap-4 pb-2 text-xs font-medium text-muted-foreground"
      >
        {/* Name 列头：可点 = ordering name（Linear 同位箭头联动） */}
        <button
          onClick={() => toggleOrder("name")}
          className={cn(
            "flex items-center gap-1 text-left transition-colors hover:text-foreground",
            state.orderField === "name" && "text-foreground",
          )}
        >
          {t("common.name")}
          {state.orderField === "name" &&
            (state.orderDir === "asc" ? (
              <ArrowUp className="size-3" />
            ) : (
              <ArrowDown className="size-3" />
            ))}
        </button>
        {cols.map(headerCell)}
      </div>

      {/* 分组值集（成员/标签清单）未就绪时不渲染分组，避免组序闪变 */}
      {content !== undefined ? content : state.grouping === "none" ? (
        renderRows(orderedRows, 0)
      ) : ready ? (
        <ProjectGroupTree
          groups={groups}
          baselineGroups={baselineGroups}
          meta={meta}
          renderRows={renderRows}
          onAdd={onNewProject}
        />
      ) : (
        <p className="py-4 text-sm text-muted-foreground">{t("common.loading")}</p>
      )}
    </div>
  )
}

/** 行内缩进：不分组 0 / 一级组内 1 / 二级组内 2（name 单元格 padding 递增） */
const DEPTH_PL = ["", "pl-6", "pl-10"]

function ProjectListRow({
  project: p,
  cols,
  gridStyle,
  depth,
  lang,
  onOpen,
}: {
  project: ProjectRow
  cols: ColumnDef[]
  gridStyle: CSSProperties
  depth: number
  lang: string
  onOpen: () => void
}) {
  return (
    <div
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      tabIndex={0}
      title={p.name}
      style={gridStyle}
      className={cn(
        "group grid cursor-pointer items-center gap-4 py-2 transition-colors hover:bg-accent/50",
      )}
    >
      {/* 项目无 icon/color 字段，图标底色按名字散列取确定性颜色（同头像约定） */}
      <span className={cn("flex min-w-0 items-center gap-2.5", DEPTH_PL[depth])}>
        <span
          className="flex size-5 shrink-0 items-center justify-center rounded"
          style={{ backgroundColor: colorFor(p.name) }}
        >
          <Box className="size-3 text-white" />
        </span>
        <span className="truncate text-sm">{p.name}</span>
      </span>
      {cols.map((c) => (
        <ProjectCell key={c.key} column={c.key} project={p} lang={lang} />
      ))}
    </div>
  )
}

/** 列单元格渲染（配置化单源）：与 COLUMNS 定义一一对应 */
function ProjectCell({
  column,
  project: p,
  lang,
}: {
  column: ProjectColumn
  project: ProjectRow
  lang: string
}) {
  const statusLabel = useProjectStatusLabel()
  const priorityLabel = usePriorityLabel()
  switch (column) {
    case "status":
      return (
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <ProjectStatusIcon status={p.status} />
          {statusLabel(p.status)}
        </span>
      )
    case "priority":
      return (
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <PriorityIcon value={p.priority} />
          {priorityLabel(p.priority)}
        </span>
      )
    case "lead":
      return (
        <span className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
          {p.lead ? (
            <>
              <MemberAvatar name={p.lead.name} color={p.lead.avatarColor || undefined} />
              <span className="truncate">{p.lead.name}</span>
            </>
          ) : (
            "—"
          )}
        </span>
      )
    case "members": {
      if (p.members.length === 0)
        return <span className="text-sm text-muted-foreground">—</span>
      // 头像叠放最多 3 枚，其余折叠 +N（列定宽防溢出）
      const shown = p.members.slice(0, 3)
      const rest = p.members.length - shown.length
      return (
        <span className="flex items-center text-sm text-muted-foreground">
          {shown.map((m, i) => (
            <span key={m.id} className={i > 0 ? "-ml-1.5" : undefined}>
              <MemberAvatar name={m.name} color={m.avatarColor || undefined} />
            </span>
          ))}
          {rest > 0 && <span className="ml-1.5 text-xs">+{rest}</span>}
        </span>
      )
    }
    case "labels": {
      if (p.labels.length === 0)
        return <span className="text-sm text-muted-foreground">—</span>
      // 最多完整展示 2 枚，其余折叠 +N
      const shown = p.labels.slice(0, 2)
      const rest = p.labels.length - shown.length
      return (
        <span className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
          {shown.map((l) => (
            <span key={l.id} className="flex min-w-0 items-center gap-1">
              <LabelDot color={l.color} />
              <span className="truncate">{l.name}</span>
            </span>
          ))}
          {rest > 0 && <span className="shrink-0 text-xs">+{rest}</span>}
        </span>
      )
    }
    case "startDate":
      return (
        <span className="text-sm text-muted-foreground">{p.startDate ?? "—"}</span>
      )
    case "targetDate":
      return (
        <span className="text-sm text-muted-foreground">{p.targetDate ?? "—"}</span>
      )
    case "createdAt":
      return (
        <span className="text-sm text-muted-foreground">{fmtDay(p.createdAt, lang)}</span>
      )
    case "updatedAt":
      return (
        <span className="text-sm text-muted-foreground">{fmtDay(p.updatedAt, lang)}</span>
      )
    case "taskCount":
      return (
        <span className="text-right text-sm text-muted-foreground">{p.taskCount}</span>
      )
  }
}
