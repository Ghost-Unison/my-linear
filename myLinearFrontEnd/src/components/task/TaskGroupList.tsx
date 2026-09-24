// 任务列表通用组件（任务列表页 / 项目详情页 Tasks tab 共用），P2-B 任务切片重构为 display 状态驱动：
// 三模渲染（用户定案 2026-09 图5-10）：
// - showSubIssues 关 = 仅一级行（父不在结果集的孤儿仍展示，平铺无面包屑形态同图5/7）；
// - showSubIssues 开 + nestedSubIssues 关 = 平铺 + "› 父标题" 面包屑（图6/8，原 Active tab 逻辑）；
// - showSubIssues 开 + nestedSubIssues 开 = 树形（跨组值置灰，图10，原 All tab 逻辑）；
//   树形渲染集 = 锚点祖先链 ∪ 锚点完整子树（2026-09-14 修订④，用户 Linear 验证定稿）：锚点子树内
//   任意深度非锚点后代保留置灰（子树展开权仅属锚点）；链条节点旁侧分支（子树无锚点）整体剪枝；
//   completed=none 时已完成任务仅作为锚点祖先的灰链条节点保留，锚点子树内已完成后代不渲染；
//   tree 孤儿（父不在结果集）提根置灰；平铺模式不插父行（链条仅面包屑体现，用户定案）。
// 分组两级组头形态对齐 project-groups（一级灰底圆角行 / 二级值名 + 右延伸横线）；
// 组头计数 = 展示行集自身值命中（含组路径祖先值），flat/tree 同口径（图7 Todo 5 / 图8、10 Todo 8）。
// 行内（对齐 Linear）：左 = 优先级 + 状态 + 标题（+ 子树进度 x/y + 父面包屑仅平铺）；
// 右 = label chip 簇 + project chip（可选）+ dueDate 胶囊 + assignee 头像 + created + updated；
// 各元素随 Display properties 列开关显隐（Title 恒展示）。
import { useMemo, useState, type ReactNode } from "react"
import { Box, Calendar, ChevronRight, Plus } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { ProjectRef, TaskRow, TaskStatus } from "@/api/types"
import { formatTimestamp, formatYmd, todayLocal } from "@/lib/date"
import { NONE } from "@/lib/filter-state"
import {
  applyShowCompleted,
  buildTaskGroupsFlat,
  buildTaskGroupsTree,
  buildTaskTreeIndex,
  sortTaskRows,
  taskChildVisible,
  taskDisplayRows,
  taskGroupCountText,
  taskKeptRoots,
  taskNeedsLabels,
  taskNeedsMembers,
  taskNeedsProjects,
  taskSpanKeptSet,
  taskTreeRowDimmed,
  type TaskDisplayState,
  type TaskGroupContext,
  type TaskGroupField,
  type TaskGroupNode,
} from "@/lib/task-display-state"
import { cn } from "@/lib/utils"
import { displayedTaskRows } from "@/lib/views-task-stats"
import { useLabels } from "@/hooks/useLabels"
import { useMembers } from "@/hooks/useMembers"
import { useProjects } from "@/hooks/useProjects"
import { MemberAvatar } from "@/components/ui/avatar"
import { LabelChips, LabelDot } from "@/components/ui/label-options"
import { priorityLabel, PriorityIcon } from "@/components/ui/priority-icon"
import { taskStatusLabel, TaskStatusIcon } from "./task-status"

/** 行内 chip 统一规格（对齐 Linear：固定高度圆角小矩形 + 边框；project / dueDate 共用） */
const ROW_CHIP = "flex h-5 shrink-0 items-center gap-1 rounded border px-1.5 text-xs"

/** 非当前分组值的行整体置灰（对齐 Linear：树跨组展示时，非本组值的行灰一点）；tree 孤儿同置灰 */
const DIM = "opacity-60"

interface TaskGroupListProps {
  /** 平铺任务数组（含子任务），后端基底序（status 枚举序 + created_at 升序，api.md §4） */
  tasks: TaskRow[]
  /** 已按 display 和独立钻取计算的锚点 ID；基础任务仍保留树上下文，空集合表示无匹配。 */
  matchIds?: ReadonlySet<string>
  /** 保存基准任务，仅用于同 display、同组路径的组头计数，不得补入当前任务树。 */
  baselineTasks?: TaskRow[]
  /** display 状态（页面内存，每 tab 一份）；分组值集异步清单未就绪时分组渲染暂缓 */
  state: TaskDisplayState
  workspaceId: string
  onOpenTask: (taskId: string) => void
  /** 组头 "+"：以该组状态/项目为默认值新建任务（路径含对应值时预填） */
  onNewTask: (status: TaskStatus, project?: ProjectRef) => void
  /** 传入时行内渲染 project chip（任务列表页；项目详情页任务同属一项，无需展示） */
  onOpenProject?: (projectId: string) => void
}

export function TaskGroupList({
  tasks,
  matchIds,
  baselineTasks,
  state,
  workspaceId,
  onOpenTask,
  onNewTask,
  onOpenProject,
}: TaskGroupListProps) {
  // 别名 tr：避免与下方多处 tasks.map((t) => ...) 的 TaskRow 循环变量遮蔽
  const { t: tr } = useTranslation()
  // 分组值集清单按 open 惰性启用（同 filter 面板约定）：未选对应分组不发请求
  const { data: members } = useMembers(workspaceId, taskNeedsMembers(state))
  const { data: labels } = useLabels(workspaceId, "task", taskNeedsLabels(state))
  const { data: projects } = useProjects(workspaceId, [], taskNeedsProjects(state))
  const ready =
    (!taskNeedsMembers(state) || members !== undefined) &&
    (!taskNeedsLabels(state) || labels !== undefined) &&
    (!taskNeedsProjects(state) || projects !== undefined)
  const ctx = useMemo<TaskGroupContext>(
    () => ({
      memberIds: (members ?? []).map((m) => m.id),
      projectIds: [...(projects ?? [])]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => p.id),
      labelIds: (labels ?? []).map((l) => l.id),
    }),
    [members, labels, projects],
  )

  // 全量行集：tree 链条节点/孤儿判定需要 completed 行在场；completed 档只作用于锚点与展示行集
  const base = tasks
  const visibleScope = useMemo(
    () => applyShowCompleted(tasks, state.showCompleted),
    [tasks, state.showCompleted],
  )
  // 展示行集（flat 行 / 组头计数 / tree 锚点集同源于此）：completed 档 + showSub 档前端渲染层过滤
  const displayRows = useMemo(
    () => taskDisplayRows(visibleScope, state.showSubIssues, matchIds),
    [visibleScope, state.showSubIssues, matchIds],
  )
  const treeMode = state.showSubIssues && state.nestedSubIssues

  // 树索引一次构建，分组引擎与渲染器共享；parentOf 兼作孤儿判定（父 id 不在 parentOf = 父不在基础行集）
  const treeIndex = useMemo(() => buildTaskTreeIndex(base), [base])
  // parentId → 直接子任务（tree 视图用）；组内按 createdAt 重排：平铺数组是（status, createdAt）全局序，
  // 子任务状态互异时相对顺序会错乱（done 的子任务被排后），树的展示应以创建序为准（manual 序同）
  const childrenOf = useMemo(() => {
    for (const list of treeIndex.childrenOf.values())
      list.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    return treeIndex.childrenOf
  }, [treeIndex])

  const groups = useMemo(() => {
    if (state.grouping === "none" || !ready) return []
    return treeMode
      ? buildTaskGroupsTree(base, displayRows, state, ctx, treeIndex)
      : buildTaskGroupsFlat(displayRows, state, ctx)
  }, [base, displayRows, state, ctx, treeMode, ready, treeIndex])

  // 基准只需锚点计数，flat/tree 口径相同；绝不用于补全 base、树索引或渲染行。
  const baselineGroups = useMemo(() => {
    if (baselineTasks === undefined || state.grouping === "none" || !ready) return []
    return buildTaskGroupsFlat(displayedTaskRows(baselineTasks, state), state, ctx)
  }, [baselineTasks, state, ctx, ready])

  // 不分组 tree：锚点 = 展示行集本身（无组条件），同走渲染集剪枝（completed=none 剪纯已完成子树）
  const noneTree = useMemo(() => {
    if (state.grouping !== "none" || !treeMode) return null
    const kept = taskSpanKeptSet(
      treeIndex,
      new Set(displayRows.map((r) => r.id)),
      taskChildVisible(state.showCompleted),
    )
    return { roots: taskKeptRoots(base, kept), kept }
  }, [treeIndex, base, displayRows, state.grouping, state.showCompleted, treeMode])

  // 折叠状态：组（按组路径键）与任务节点（按 id 键）共用一个集合，键空间不冲突
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  if (matchIds !== undefined && displayRows.length === 0)
    return <p className="py-4 text-sm text-muted-foreground">{tr("filter.emptyResult")}</p>
  if (tasks.length === 0) return null
  // 取回有行但展示作用域清空（All tab completed 档位隐藏全部）：专属空态提示
  if (visibleScope.length === 0)
    return <p className="py-4 text-sm text-muted-foreground">{tr("display.emptyHiddenTasks")}</p>

  const ordered = (rows: TaskRow[]) => sortTaskRows(rows, state.orderField, state.orderDir)

  // 组值回显（icon/文案）与 filter 同值源（成员/标签/项目清单、枚举）
  const meta = (field: TaskGroupField, value: string): { label: string; icon?: ReactNode } => {
    switch (field) {
      case "status":
        return {
          label: taskStatusLabel(tr, value as TaskStatus),
          icon: <TaskStatusIcon status={value as TaskStatus} />,
        }
      case "priority":
        return { label: tr(`enums.priority.p${value}`), icon: <PriorityIcon value={Number(value)} /> }
      case "assignee": {
        if (value === NONE) return { label: tr("filter.noAssignee") }
        const m = members?.find((x) => x.id === value)
        return {
          label: m?.name ?? value,
          icon: m ? <MemberAvatar name={m.name} color={m.avatarColor || undefined} /> : undefined,
        }
      }
      case "project": {
        if (value === NONE) return { label: tr("task.noProject") }
        const p = projects?.find((x) => x.id === value)
        return {
          label: p?.name ?? value,
          icon: <Box className="size-3.5 shrink-0 text-muted-foreground" />,
        }
      }
      default: {
        if (value === NONE) return { label: tr("filter.noLabels") }
        const l = labels?.find((x) => x.id === value)
        return { label: l?.name ?? value, icon: l ? <LabelDot color={l.color} /> : undefined }
      }
    }
  }

  // 组路径预填（组头 "+"）：status → 默认状态；project → 锁定项目；其余属性弹窗内自选
  const pathInitial = (path: { field: TaskGroupField; value: string }[]) => {
    const status = path.find((p) => p.field === "status" && p.value !== NONE)
    const project = path.find((p) => p.field === "project" && p.value !== NONE)
    return {
      status: (status?.value as TaskStatus) ?? "todo",
      project: project ? projects?.find((p) => p.id === project.value) : undefined,
    }
  }

  const renderRows = (
    rows: TaskRow[],
    path: { field: TaskGroupField; value: string }[],
    kept: ReadonlySet<string> | undefined,
  ) =>
    treeMode
      ? ordered(rows).map((root) => (
          <TaskTreeItem
            key={root.id}
            task={root}
            childrenOf={childrenOf}
            parentOf={treeIndex.parentOf}
            kept={kept}
            collapsed={collapsed}
            onToggle={toggle}
            dimPath={path}
            matchIds={matchIds}
            state={state}
            onOpenTask={onOpenTask}
            onOpenProject={onOpenProject}
          />
        ))
      : ordered(rows).map((task) => (
          <FlatRow
            key={task.id}
            task={task}
            hasChildren={(childrenOf.get(task.id) ?? []).length > 0}
            childrenOf={childrenOf}
            state={state}
            onOpenTask={onOpenTask}
            onOpenProject={onOpenProject}
          />
        ))

  const renderGroups = (
    nodes: TaskGroupNode[],
    depth: 1 | 2,
    path: { field: TaskGroupField; value: string }[],
    parentKey: string,
    baselineNodes: TaskGroupNode[],
  ): ReactNode =>
    nodes.map((g) => {
      const m = meta(g.field, g.value)
      const key = `${parentKey}${g.field}:${g.value}`
      const isCollapsed = collapsed.has(key)
      const here = [...path, { field: g.field, value: g.value }]
      const initial = pathInitial(here)
      const addLabel = tr("task.newTaskInGroup", { status: m.label })
      const baseline = baselineNodes.find((node) => node.field === g.field && node.value === g.value)
      const countText = taskGroupCountText(g.count, baseline?.count)
      return (
        <div key={key} className={depth === 1 ? "mt-3 first:mt-0" : "mt-1"}>
          {depth === 1 ? (
            <div
              role="button"
              tabIndex={0}
              aria-expanded={!isCollapsed}
              onClick={() => toggle(key)}
              onKeyDown={(e) => e.key === "Enter" && toggle(key)}
              className="group flex cursor-pointer items-center gap-2 rounded-md bg-surface-2 px-2 py-1.5 transition-colors hover:bg-surface-3"
            >
              <ChevronButton collapsed={isCollapsed} onClick={() => toggle(key)} />
              {m.icon}
              <span className="truncate text-xs font-medium text-foreground">{m.label}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{countText}</span>
              {/* 新建入口常驻显示（对齐 Linear 组头右侧 +） */}
              <button
                type="button"
                aria-label={addLabel}
                onClick={(e) => {
                  e.stopPropagation()
                  onNewTask(initial.status, initial.project)
                }}
                className="ml-auto flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-[background-color,color] hover:bg-surface-4 hover:text-foreground"
              >
                <Plus className="size-3.5" />
              </button>
            </div>
          ) : (
            <div
              role="button"
              tabIndex={0}
              aria-expanded={!isCollapsed}
              onClick={() => toggle(key)}
              onKeyDown={(e) => e.key === "Enter" && toggle(key)}
              className="group flex cursor-pointer items-center gap-2 px-2 py-1"
            >
              <ChevronButton collapsed={isCollapsed} onClick={() => toggle(key)} />
              {m.icon}
              <span className="shrink-0 truncate text-xs font-medium text-foreground">{m.label}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{countText}</span>
              <span className="mx-2 h-px flex-1 bg-border" />
              <button
                type="button"
                aria-label={addLabel}
                onClick={(e) => {
                  e.stopPropagation()
                  onNewTask(initial.status, initial.project)
                }}
                className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-[background-color,color] hover:bg-surface-3 hover:text-foreground"
              >
                <Plus className="size-3.5" />
              </button>
            </div>
          )}
          {!isCollapsed &&
            (g.children.length > 0
              ? renderGroups(g.children, 2, here, `${key}/`, baseline?.children ?? [])
              : renderRows(g.rows, here, g.kept))}
        </div>
      )
    })

  return (
    <div className="flex flex-col gap-0">
      {state.grouping === "none" ? (
        renderRows(
          treeMode && noneTree ? noneTree.roots : displayRows,
          [],
          treeMode && noneTree ? noneTree.kept : undefined,
        )
      ) : !ready ? (
        <p className="py-4 text-sm text-muted-foreground">{tr("common.loading")}</p>
      ) : (
        <div className="flex flex-col">{renderGroups(groups, 1, [], "", baselineGroups)}</div>
      )}
    </div>
  )
}

/** 组头折叠 chevron（点击不冒泡到组头行双击切换） */
function ChevronButton({ collapsed, onClick }: { collapsed: boolean; onClick: () => void }) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      aria-label={t("display.toggleCollapse")}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-surface-4 hover:text-foreground"
    >
      <ChevronRight className={cn("size-3.5 transition-transform", !collapsed && "rotate-90")} />
    </button>
  )
}

/** 后代子树统计：x = done 节点数，y = 节点总数（api.md §4 徽标口径，任意深度） */
function subtreeStats(rootId: string, childrenOf: Map<string, TaskRow[]>) {
  let done = 0
  let total = 0
  const walk = (id: string) => {
    for (const child of childrenOf.get(id) ?? []) {
      total++
      if (child.status === "done") done++
      walk(child.id)
    }
  }
  walk(rootId)
  return { done, total }
}

/** 行右侧元信息（随 Display properties 显隐）：labels / project / dueDate / assignee / created / updated。
 *  固定列宽槽位（Linear 实测同位列）：无值行留空槽、列位不逐行漂移（流式 flex 下 "Sep 3"/"Sep 14"
 *  宽差与 chip 有无会推斜左邻列）；日期槽内左对齐（Linear 同款，右缘自然参差） */
function RowMeta({
  task,
  state,
  onOpenProject,
}: {
  task: TaskRow
  state: TaskDisplayState
  onOpenProject?: (projectId: string) => void
}) {
  const { t } = useTranslation()
  // 逾期 = dueDate 早于今天且未完结（done/canceled 不再催）
  const overdue =
    !!task.dueDate && task.dueDate < todayLocal() && task.status !== "done" && task.status !== "canceled"
  return (
    <span className="ml-auto flex shrink-0 items-center gap-4 pl-4">
      {state.visible.labels && (
        <span className="flex w-36 shrink-0 items-center justify-end overflow-hidden">
          <LabelChips labels={task.labels} />
        </span>
      )}
      {state.visible.project &&
        onOpenProject &&
        (
          <span className="flex w-28 shrink-0 items-center justify-end">
            {task.project && (
              <button
                type="button"
                title={task.project.name}
                onClick={(e) => {
                  e.stopPropagation()
                  onOpenProject(task.project!.id)
                }}
                className={cn(
                  ROW_CHIP,
                  "max-w-full min-w-0 border-border text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground",
                )}
              >
                <Box className="size-3 shrink-0" />
                <span className="truncate">{task.project.name}</span>
              </button>
            )}
          </span>
        )}
      {state.visible.dueDate && (
        <span className="flex w-24 shrink-0 items-center justify-end">
          {task.dueDate && (
            <span
              className={cn(
                ROW_CHIP,
                "max-w-full min-w-0",
                overdue ? "border-destructive/50 text-destructive" : "border-border text-muted-foreground",
              )}
            >
              <Calendar className="size-3 shrink-0" />
              <span className="truncate">{formatYmd(task.dueDate)}</span>
            </span>
          )}
        </span>
      )}
      {state.visible.assignee && (
        <span className="flex w-6 shrink-0 items-center justify-end">
          {task.assignee ? (
            <MemberAvatar name={task.assignee.name} color={task.assignee.avatarColor || undefined} />
          ) : (
            <span
              title={t("task.unassigned")}
              className="size-5 shrink-0 rounded-full border border-dashed border-ink-subtle/60"
            />
          )}
        </span>
      )}
      {state.visible.createdAt && (
        <span className="w-24 shrink-0 text-left text-xs text-muted-foreground">
          {formatTimestamp(task.createdAt)}
        </span>
      )}
      {state.visible.updatedAt && (
        <span className="w-24 shrink-0 text-left text-xs text-muted-foreground">
          {formatTimestamp(task.updatedAt)}
        </span>
      )}
    </span>
  )
}

/** 行左公共部分：优先级 + 状态图标（随 Display properties 显隐）+ 标题 + 子树进度徽标 */
function RowLead({
  task,
  state,
  hasChildren,
  childrenOf,
}: {
  task: TaskRow
  state: TaskDisplayState
  hasChildren: boolean
  childrenOf: Map<string, TaskRow[]>
}) {
  const { t } = useTranslation()
  const stats = hasChildren ? subtreeStats(task.id, childrenOf) : null
  return (
    <>
      {state.visible.priority && (
        <span title={priorityLabel(t, task.priority)} className="flex shrink-0 items-center">
          <PriorityIcon value={task.priority} />
        </span>
      )}
      {state.visible.status && <TaskStatusIcon status={task.status} />}
      <span className="truncate text-sm">{task.title}</span>
      {stats && (
        <span className="shrink-0 text-xs text-muted-foreground">
          {stats.done}/{stats.total}
        </span>
      )}
    </>
  )
}

interface TaskTreeItemProps {
  task: TaskRow
  childrenOf: Map<string, TaskRow[]>
  /** 基础行集 id→parentId 映射（树索引）：仅用 has 判定孤儿（父不在基础行集） */
  parentOf: ReadonlyMap<string, string>
  /** 组剪枝集（kept = 锚点 + 链条祖先）：children 按其过滤；undefined = 不剪枝 */
  kept: ReadonlySet<string> | undefined
  collapsed: ReadonlySet<string>
  onToggle: (id: string) => void
  /** 组路径（field+value）：行值未命中任一路径值则置灰；tree 孤儿（父不在结果集）追加置灰 */
  dimPath: { field: TaskGroupField; value: string }[]
  matchIds?: ReadonlySet<string>
  state: TaskDisplayState
  onOpenTask: (taskId: string) => void
  onOpenProject?: (projectId: string) => void
}

function TaskTreeItem({
  task,
  childrenOf,
  parentOf,
  kept,
  collapsed,
  onToggle,
  dimPath,
  matchIds,
  state,
  onOpenTask,
  onOpenProject,
}: TaskTreeItemProps) {
  const { t } = useTranslation()
  // 剪枝：无锚点分支整体不渲染（生成林外节点）
  const children = (childrenOf.get(task.id) ?? []).filter((c) => !kept || kept.has(c.id))
  const isCollapsed = collapsed.has(task.id)
  // 链条节点（completed 档隐藏但作为锚点祖先保留）同置灰（用户定案 2026-09-14）
  const dim = taskTreeRowDimmed(task, state, parentOf, dimPath, matchIds)

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpenTask(task.id)}
        onKeyDown={(e) => e.key === "Enter" && onOpenTask(task.id)}
        title={task.title}
        className={cn(
          "group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/50",
          dim && DIM,
        )}
      >
        {/* 展开槽：有子任务 = 折叠箭头，否则占位保证同层图标对齐 */}
        {children.length > 0 ? (
          <button
            type="button"
            aria-label={isCollapsed ? t("task.expandSubtasks") : t("task.collapseSubtasks")}
            aria-expanded={!isCollapsed}
            onClick={(e) => {
              e.stopPropagation()
              onToggle(task.id)
            }}
            className="flex size-4 shrink-0 items-center justify-center rounded text-ink-subtle transition-colors hover:bg-surface-3 hover:text-foreground"
          >
            <ChevronRight className={cn("size-3.5 transition-transform", !isCollapsed && "rotate-90")} />
          </button>
        ) : (
          <span className="size-4 shrink-0" aria-hidden />
        )}
        <RowLead task={task} state={state} hasChildren={children.length > 0} childrenOf={childrenOf} />
        <RowMeta task={task} state={state} onOpenProject={onOpenProject} />
      </div>
      {children.length > 0 && !isCollapsed && (
        // 树线：缩进 + 左侧 hairline；更深层数据递归兼容
        <div className="ml-6 border-l border-border pl-3">
          {sortTaskRows(children, state.orderField, state.orderDir).map((child) => (
            <TaskTreeItem
              key={child.id}
              task={child}
              childrenOf={childrenOf}
              parentOf={parentOf}
              kept={kept}
              collapsed={collapsed}
              onToggle={onToggle}
              dimPath={dimPath}
              matchIds={matchIds}
              state={state}
              onOpenTask={onOpenTask}
              onOpenProject={onOpenProject}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** 平铺视图行：不渲染树；有父任务时标题后跟灰字 "› 父标题" 面包屑（对齐 Linear Active / 图6、8） */
function FlatRow({
  task,
  hasChildren,
  childrenOf,
  state,
  onOpenTask,
  onOpenProject,
}: {
  task: TaskRow
  hasChildren: boolean
  childrenOf: Map<string, TaskRow[]>
  state: TaskDisplayState
  onOpenTask: (taskId: string) => void
  onOpenProject?: (projectId: string) => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpenTask(task.id)}
      onKeyDown={(e) => e.key === "Enter" && onOpenTask(task.id)}
      title={task.title}
      className="group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/50"
    >
      {/* 与 tree 行同宽的左占位，保证优先级/状态图标纵向对齐 */}
      <span className="size-4 shrink-0" aria-hidden />
      <RowLead task={task} state={state} hasChildren={hasChildren} childrenOf={childrenOf} />
      {task.parentId && task.parentTitle && (
        <span className="flex min-w-0 shrink-0 items-center gap-0.5 text-xs text-muted-foreground">
          <ChevronRight className="size-3 shrink-0" />
          <span className="truncate">{task.parentTitle}</span>
        </span>
      )}
      <RowMeta task={task} state={state} onOpenProject={onOpenProject} />
    </div>
  )
}
