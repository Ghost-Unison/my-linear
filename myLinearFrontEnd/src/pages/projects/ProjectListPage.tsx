import { useMemo, useState, type CSSProperties } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { ArrowDown, ArrowUp, Box, Plus } from "lucide-react"
import type { ProjectRow } from "@/api/types"
import { useProjects } from "@/hooks/useProjects"
import { useWorkspaces } from "@/hooks/useWorkspaces"
import { colorFor } from "@/lib/color"
import { displayError } from "@/lib/errors"
import { encodeConds, parseConds, writeConds, type FilterCond } from "@/lib/filter-state"
import {
  applyShowClosed,
  buildGroups,
  DEFAULT_DISPLAY,
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
import { Breadcrumb } from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { LabelDot } from "@/components/ui/label-options"
import { PriorityIcon, usePriorityLabel } from "@/components/ui/priority-icon"
import { PageHeader, tabPill } from "@/components/layout/PageHeader"
import { FilterButton } from "@/components/filter/filter-menu"
import { FilterChipRow } from "@/components/filter/filter-chips"
import { DisplayButton } from "@/components/display/display-menu"
import { fmtDay, ProjectGroupTree, useGroupValueMeta } from "@/components/display/project-groups"
import { CreateProjectDialog, type CreateProjectInitial } from "@/components/project/CreateProjectDialog"
import {
  ProjectStatusIcon,
  useProjectStatusLabel,
} from "@/components/project/project-status"

// /w/:workspaceId/projects → 项目列表（P0.md §2：行只读，点击进详情页；不做行内编辑）
// P2-B：display options 接通——filter 决定取数（进 URL），display 纯内存（总决策 2）：
// 基底管线 = showClosed 作用域 → ordering 排序 → 两级分组；表头/行网格由可见列配置单源驱动
export function ProjectListPage() {
  const { t, i18n } = useTranslation()
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  // P2 条件列表镜像进 URL（?f= 重复参数，方案 A）；与后端 Parse 同规则丢弃非法条目，
  // 保证 chip 行显示与后端求值永远一致
  const conds = useMemo(() => parseConds(searchParams, "projects_page"), [searchParams])
  const fParams = useMemo(() => encodeConds(conds), [conds])
  const setConds = (next: FilterCond[]) => {
    const sp = new URLSearchParams(searchParams)
    writeConds(sp, next)
    setSearchParams(sp, { replace: true })
  }
  const { data: projects, isLoading, isError, error } = useProjects(workspaceId, fParams)
  const { data: workspaces } = useWorkspaces()
  const [createOpen, setCreateOpen] = useState(false)
  // ⑤ 分组头 “+” 预填：undefined = 页头 New project（全默认）
  const [createInitial, setCreateInitial] = useState<CreateProjectInitial | undefined>(undefined)
  const openCreate = (initial?: CreateProjectInitial) => {
    setCreateInitial(initial)
    setCreateOpen(true)
  }
  // display 状态纯内存：不进 URL，刷新/切页重置默认（总决策 2）
  const [display, setDisplay] = useState<ProjectDisplayState>(DEFAULT_DISPLAY)
  const workspaceName =
    workspaces?.find((w) => w.id === workspaceId)?.name ?? t("common.workspaceFallback")

  // 列配置单源：可见列 → 网格模板 / 保底宽（inline style，Tailwind JIT 编译不到动态 arbitrary class）
  const cols = useMemo(() => visibleColumns(display), [display])
  const gridStyle = useMemo<CSSProperties>(
    () => ({ gridTemplateColumns: gridTemplateCols(cols) }),
    [cols],
  )
  const minWStyle = useMemo<CSSProperties>(
    () => ({ minWidth: `${tableMinRem(cols)}rem` }),
    [cols],
  )

  const { ready, ctx, meta } = useGroupValueMeta(workspaceId!, display)
  // 基底管线：showClosed（基底 AND：filter 取回但关闭态前端隐藏）→ ordering → 分组
  const baseRows = useMemo(
    () => applyShowClosed(projects ?? [], display.showClosed),
    [projects, display.showClosed],
  )
  const orderedRows = useMemo(
    () => sortRows(baseRows, display.orderField, display.orderDir),
    [baseRows, display.orderField, display.orderDir],
  )
  const groups = useMemo(
    () => (display.grouping !== "none" && ready ? buildGroups(orderedRows, display, ctx) : []),
    [orderedRows, display, ctx, ready],
  )

  // 表头排序联动（用户定案 6）：点列头 = 写 ordering 状态；同列翻方向，新列复位 asc + 自动勾选对应列
  const toggleOrder = (field: OrderField) => {
    if (display.orderField === field) {
      setDisplay({ ...display, orderDir: display.orderDir === "asc" ? "desc" : "asc" })
    } else {
      const col = orderFieldColumn(field)
      setDisplay({
        ...display,
        orderField: field,
        orderDir: "asc",
        ...(col && !display.visible[col] ? { visible: { ...display.visible, [col]: true } } : {}),
      })
    }
  }

  const openRow = (p: ProjectRow) => navigate(`/w/${workspaceId}/projects/${p.id}`)
  const renderRows = (rows: ProjectRow[], depth: number) =>
    rows.map((p) => (
      <ProjectListRow
        key={p.id}
        project={p}
        cols={cols}
        gridStyle={gridStyle}
        depth={depth}
        lang={i18n.language}
        onOpen={() => openRow(p)}
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
    const active = display.orderField === c.orderField
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
          (display.orderDir === "asc" ? (
            <ArrowUp className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          ))}
      </button>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* 页头（Linear 风格）：面包屑行 → 分割线 → tab 行（All projects + 右上 Display/Filter/New project）。
          All projects 为选中态胶囊占位（当前只有一个视图，未来筛选 tab 在此扩展） */}
      <PageHeader
        title={
          <Breadcrumb
            items={[
              { label: workspaceName, to: `/w/${workspaceId}/home` },
              { label: t("nav.projects") },
            ]}
          />
        }
        tabs={<span className={tabPill(true)}>{t("project.allProjects")}</span>}
        actions={
          <>
            <FilterButton
              workspaceId={workspaceId!}
              surface="projects_page"
              conds={conds}
              onChange={setConds}
            />
            <DisplayButton state={display} onChange={setDisplay} />
            <Button variant="ghost" size="sm" onClick={() => openCreate()}>
              <Plus />
              {t("project.newProject")}
            </Button>
          </>
        }
      />

      {/* 条件 chip 行（tab 行与表头之间）：仅存在条件时渲染 */}
      {conds.length > 0 && (
        <FilterChipRow
          workspaceId={workspaceId!}
          surface="projects_page"
          conds={conds}
          onChange={setConds}
        />
      )}

      <div className="flex-1 min-h-0 px-6">
        {/* 横向滚动容器 = 撑满到视口底的 h-full 层：列溢出时横向滚动条贴在右侧内容区（视口）
            底部而非表格底部（对齐 Linear）；min-w 撑开 grid 防 Name 列被压成 0 宽，pb-6 留底部呼吸 */}
        <div className="h-full overflow-auto">
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
                  display.orderField === "name" && "text-foreground",
                )}
              >
                {t("common.name")}
                {display.orderField === "name" &&
                  (display.orderDir === "asc" ? (
                    <ArrowUp className="size-3" />
                  ) : (
                    <ArrowDown className="size-3" />
                  ))}
              </button>
              {cols.map(headerCell)}
            </div>

            {isLoading && (
              <p className="py-4 text-sm text-muted-foreground">{t("common.loading")}</p>
            )}
            {isError && (
              <p className="py-4 text-sm text-destructive">
                {displayError(t, error, "errors.loadFailed")}
              </p>
            )}
            {!isLoading && !isError && projects?.length === 0 && (
              <p className="py-4 text-sm text-muted-foreground">
                {conds.length > 0 ? t("filter.emptyResult") : t("project.empty")}
              </p>
            )}
            {/* 取回有行但基底作用域清空（关闭态全隐藏）：专属空态提示 */}
            {!isLoading && !isError && (projects?.length ?? 0) > 0 && baseRows.length === 0 && (
              <p className="py-4 text-sm text-muted-foreground">{t("display.emptyHidden")}</p>
            )}
            {/* 分组值集（成员/标签清单）未就绪时不渲染分组，避免组序闪变 */}
            {!isLoading &&
              !isError &&
              baseRows.length > 0 &&
              (display.grouping === "none" ? (
                renderRows(orderedRows, 0)
              ) : ready ? (
                <ProjectGroupTree
                  groups={groups}
                  meta={meta}
                  renderRows={renderRows}
                  onAdd={openCreate}
                />
              ) : (
                <p className="py-4 text-sm text-muted-foreground">{t("common.loading")}</p>
              ))}
          </div>
        </div>
      </div>

      <CreateProjectDialog
        open={createOpen}
        workspaceId={workspaceId!}
        initial={createInitial}
        onClose={() => setCreateOpen(false)}
      />
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
