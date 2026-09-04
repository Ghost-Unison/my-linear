import { useMemo, useState } from "react"
import { Box, Calendar, ChevronRight, Plus } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { TaskRow, TaskStatus } from "@/api/types"
import { formatTimestamp, formatYmd, todayLocal } from "@/lib/date"
import { cn } from "@/lib/utils"
import { MemberAvatar } from "@/components/ui/avatar"
import { priorityLabel, PriorityIcon } from "@/components/ui/priority-icon"
import { taskStatusLabel, TASK_STATUS_ORDER, TaskStatusIcon } from "./task-status"

/** 行内 chip 统一规格（对齐 Linear：固定高度圆角小矩形 + 边框；project / dueDate 共用） */
const ROW_CHIP = "flex h-5 shrink-0 items-center gap-1 rounded border px-1.5 text-xs"

/** 非当前分组状态的行整体置灰（对齐 Linear：树跨状态展示时，非本组状态的行灰一点） */
const DIM = "opacity-60"

/** 任务列表视图模式 */
export type TaskListView = "tree" | "flat"

interface TaskGroupListProps {
  /** 平铺任务数组（含子任务），按 status 枚举序、createdAt 排序（api.md §4） */
  tasks: TaskRow[]
  /**
   * tree = 全量树形（All / 项目详情页）：一棵任务树只要含某状态就出现在该状态分组下，
   *        树内非该状态的行置灰；同一棵树可同时出现在多个分组（对齐 Linear All issues）。
   * flat = 状态筛选平铺（Active / Backlog）：不展示树，仅渲染匹配当前状态的行；
   *        有父任务时行内以灰字 "› 父标题" 面包屑体现归属（对齐 Linear Active）。
   */
  view: TaskListView
  onOpenTask: (taskId: string) => void
  /** 组头 "+"：以该组状态为默认值新建任务 */
  onNewTask: (status: TaskStatus) => void
  /** 传入时行内渲染 project chip（任务列表页；项目详情页任务同属一项，无需展示），点击跳项目详情 */
  onOpenProject?: (projectId: string) => void
}

/**
 * 任务列表通用组件（项目详情页 / 任务列表页共用），按状态分组（组头可折叠 + 计数）。
 * 两种视图（对齐 Linear）：
 * - tree：根任务为树根递归渲染子任务；树跨状态出现在含该状态的分组，非本组状态行置灰。
 * - flat：仅匹配行平铺，父任务以 "› 父标题" 面包屑跟在标题后（不渲染树）。
 * 行内（对齐 Linear）：左 = 优先级 + 状态 + 标题（+ 子树进度 x/y，仅 tree）+ 父面包屑（仅 flat）；
 * 右 = project chip（可选）+ dueDate 胶囊 + assignee 头像 + createdAt。
 */
export function TaskGroupList({ tasks, view, onOpenTask, onNewTask, onOpenProject }: TaskGroupListProps) {
  // 别名 tr：避免与下方多处 tasks.map((t) => ...) / for (const t of tasks) 的 TaskRow 循环变量遮蔽
  const { t: tr } = useTranslation()
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks])

  // parentId → 直接子任务（tree 视图用）；组内按 createdAt 重排：平铺数组是（status, createdAt）全局序，
  // 子任务状态互异时相对顺序会错乱（done 的子任务被排后），树的展示应以创建序为准
  const childrenOf = useMemo(() => {
    const map = new Map<string, TaskRow[]>()
    for (const t of tasks) {
      if (!t.parentId) continue
      const list = map.get(t.parentId)
      if (list) list.push(t)
      else map.set(t.parentId, [t])
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    }
    return map
  }, [tasks])

  // 每棵根任务子树包含的状态集合（tree 视图：决定该树出现在哪些分组）
  const subtreeStatuses = useMemo(() => {
    const map = new Map<string, Set<TaskStatus>>()
    const walk = (id: string, acc: Set<TaskStatus>) => {
      const t = byId.get(id)
      if (t) acc.add(t.status)
      for (const c of childrenOf.get(id) ?? []) walk(c.id, acc)
    }
    for (const t of tasks) {
      if (t.parentId) continue
      const acc = new Set<TaskStatus>()
      walk(t.id, acc)
      map.set(t.id, acc)
    }
    return map
  }, [tasks, byId, childrenOf])

  // 组头计数 = 该状态任务总数（含子任务，对齐 Linear 组头数字）
  const countByStatus = useMemo(() => {
    const m = new Map<TaskStatus, number>()
    for (const t of tasks) m.set(t.status, (m.get(t.status) ?? 0) + 1)
    return m
  }, [tasks])

  // 分组 = 有该状态任务的状态；tree 取"子树含该状态"的根，flat 取"自身即该状态"的行
  const groups = useMemo(() => {
    return TASK_STATUS_ORDER.filter((s) => (countByStatus.get(s) ?? 0) > 0).map((status) => {
      const rows =
        view === "tree"
          ? tasks.filter((t) => !t.parentId && subtreeStatuses.get(t.id)?.has(status))
          : tasks.filter((t) => t.status === status)
      return [status, rows] as const
    })
  }, [tasks, view, countByStatus, subtreeStatuses])

  // 折叠状态：组（按 status 键）与任务节点（按 id 键）共用一个集合，键空间不冲突
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  if (tasks.length === 0) return null

  return (
    <div className="flex flex-col gap-5">
      {groups.map(([status, rows]) => {
        const isCollapsed = collapsed.has(status)
        return (
          <section key={status}>
            <div
              role="button"
              tabIndex={0}
              aria-expanded={!isCollapsed}
              onClick={() => toggle(status)}
              onKeyDown={(e) => e.key === "Enter" && toggle(status)}
              className="group flex cursor-pointer items-center gap-2 rounded-md bg-surface-2 px-2 py-1.5 transition-colors hover:bg-surface-3"
            >
              <ChevronRight
                className={cn(
                  "size-3.5 shrink-0 text-muted-foreground transition-transform",
                  !isCollapsed && "rotate-90",
                )}
              />
              <TaskStatusIcon status={status} />
              <span className="text-xs font-medium text-foreground">
                {taskStatusLabel(tr, status)}
              </span>
              {/* 计数 = 该状态任务总数（含子任务） */}
              <span className="text-xs text-muted-foreground">{countByStatus.get(status) ?? 0}</span>
              {/* 新建入口常驻显示（对齐 Linear 组头右侧 +），无标题行时它是唯一常驻入口 */}
              <button
                type="button"
                aria-label={tr("task.newTaskInGroup", { status: taskStatusLabel(tr, status) })}
                onClick={(e) => {
                  e.stopPropagation()
                  onNewTask(status)
                }}
                className="ml-auto flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-[background-color,color] hover:bg-surface-4 hover:text-foreground"
              >
                <Plus className="size-3.5" />
              </button>
            </div>
            {!isCollapsed && (
              <div className="mt-0.5">
                {view === "tree"
                  ? rows.map((root) => (
                      <TaskTreeItem
                        key={root.id}
                        task={root}
                        childrenOf={childrenOf}
                        collapsed={collapsed}
                        onToggle={toggle}
                        groupStatus={status}
                        onOpenTask={onOpenTask}
                        onOpenProject={onOpenProject}
                      />
                    ))
                  : rows.map((task) => (
                      <FlatRow
                        key={task.id}
                        task={task}
                        onOpenTask={onOpenTask}
                        onOpenProject={onOpenProject}
                      />
                    ))}
              </div>
            )}
          </section>
        )
      })}
    </div>
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

/** 行右侧元信息（project chip / dueDate / assignee / createdAt），tree 与 flat 共用 */
function RowMeta({ task, onOpenProject }: { task: TaskRow; onOpenProject?: (projectId: string) => void }) {
  const { t } = useTranslation()
  // 逾期 = dueDate 早于今天且未完结（done/canceled 不再催）
  const overdue =
    !!task.dueDate &&
    task.dueDate < todayLocal() &&
    task.status !== "done" &&
    task.status !== "canceled"

  return (
    <span className="ml-auto flex shrink-0 items-center gap-2.5 pl-4">
      {/* project chip：任务列表页展示（P0.md §3 行元素，右侧 label 预留位 P1），点击跳项目详情 */}
      {onOpenProject && task.project && (
        <button
          type="button"
          title={task.project.name}
          onClick={(e) => {
            e.stopPropagation()
            onOpenProject(task.project!.id)
          }}
          className={cn(
            ROW_CHIP,
            "border-border text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground",
          )}
        >
          <Box className="size-3" />
          <span className="max-w-24 truncate">{task.project.name}</span>
        </button>
      )}
      {task.dueDate && (
        <span
          className={cn(
            ROW_CHIP,
            overdue
              ? "border-destructive/50 text-destructive"
              : "border-border text-muted-foreground",
          )}
        >
          <Calendar className="size-3" />
          {formatYmd(task.dueDate)}
        </span>
      )}
      {/* 无 assignee 渲染虚线占位圈（对齐 Linear：位置固定，行高不抖动）；行只读（P3 才内编），纯展示 */}
      {task.assignee ? (
        <MemberAvatar name={task.assignee.name} color={task.assignee.avatarColor || undefined} />
      ) : (
        <span
          title={t("task.unassigned")}
          className="size-5 shrink-0 rounded-full border border-dashed border-ink-subtle/60"
        />
      )}
      <span className="text-xs text-muted-foreground">{formatTimestamp(task.createdAt)}</span>
    </span>
  )
}

interface TaskTreeItemProps {
  task: TaskRow
  childrenOf: Map<string, TaskRow[]>
  collapsed: ReadonlySet<string>
  onToggle: (id: string) => void
  /** 当前分组状态：行状态与之不同则置灰 */
  groupStatus: TaskStatus
  onOpenTask: (taskId: string) => void
  onOpenProject?: (projectId: string) => void
}

function TaskTreeItem({
  task,
  childrenOf,
  collapsed,
  onToggle,
  groupStatus,
  onOpenTask,
  onOpenProject,
}: TaskTreeItemProps) {
  const { t } = useTranslation()
  const children = childrenOf.get(task.id) ?? []
  const isCollapsed = collapsed.has(task.id)
  const stats = children.length > 0 ? subtreeStats(task.id, childrenOf) : null
  const dim = task.status !== groupStatus

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
            <ChevronRight
              className={cn("size-3.5 transition-transform", !isCollapsed && "rotate-90")}
            />
          </button>
        ) : (
          <span className="size-4 shrink-0" aria-hidden />
        )}
        <span title={priorityLabel(t, task.priority)} className="flex shrink-0 items-center">
          <PriorityIcon value={task.priority} />
        </span>
        <TaskStatusIcon status={task.status} />
        <span className="truncate text-sm">{task.title}</span>
        {stats && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {stats.done}/{stats.total}
          </span>
        )}
        <RowMeta task={task} onOpenProject={onOpenProject} />
      </div>
      {children.length > 0 && !isCollapsed && (
        // 树线：缩进 + 左侧 hairline，MVP 展示两层（任务 → 子任务），更深层数据递归兼容
        <div className="ml-6 border-l border-border pl-3">
          {children.map((child) => (
            <TaskTreeItem
              key={child.id}
              task={child}
              childrenOf={childrenOf}
              collapsed={collapsed}
              onToggle={onToggle}
              groupStatus={groupStatus}
              onOpenTask={onOpenTask}
              onOpenProject={onOpenProject}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** flat 视图行：不渲染树；有父任务时标题后跟灰字 "› 父标题" 面包屑（对齐 Linear Active） */
function FlatRow({
  task,
  onOpenTask,
  onOpenProject,
}: {
  task: TaskRow
  onOpenTask: (taskId: string) => void
  onOpenProject?: (projectId: string) => void
}) {
  const { t } = useTranslation()
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
      <span title={priorityLabel(t, task.priority)} className="flex shrink-0 items-center">
        <PriorityIcon value={task.priority} />
      </span>
      <TaskStatusIcon status={task.status} />
      <span className="truncate text-sm">{task.title}</span>
      {task.parentId && task.parentTitle && (
        <span className="flex min-w-0 shrink-0 items-center gap-0.5 text-xs text-muted-foreground">
          <ChevronRight className="size-3 shrink-0" />
          <span className="truncate">{task.parentTitle}</span>
        </span>
      )}
      <RowMeta task={task} onOpenProject={onOpenProject} />
    </div>
  )
}
