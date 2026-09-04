import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { Box, Calendar, ChevronRight, Circle, PanelRight, Plus, User, X } from "lucide-react"
import type { ParentRef, TaskDetail, TaskNode, TaskStatus, UpdateTaskInput } from "@/api/types"
import { ApiError } from "@/api/client"
import { displayError, translateError } from "@/lib/errors"
import { useWorkspaces } from "@/hooks/useWorkspaces"
import { useMembers } from "@/hooks/useMembers"
import { useCreateTask, useDeleteTask, useTask, useTaskSubtree, useUpdateTask } from "@/hooks/useTasks"
import { formatYmd, todayLocal } from "@/lib/date"
import { cn } from "@/lib/utils"
import { PageHeader } from "@/components/layout/PageHeader"
import { Breadcrumb } from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { MemberAvatar } from "@/components/ui/avatar"
import { DatePicker } from "@/components/ui/date-picker"
import { ConfirmDialog } from "@/components/ui/dialog"
import { memberOptions } from "@/components/ui/member-options"
import { PriorityIcon, usePriorityLabel, usePriorityOptions } from "@/components/ui/priority-icon"
import { Select } from "@/components/ui/select"
import { TaskPropertiesPanel } from "@/components/task/TaskPropertiesPanel"
import {
  TaskAssigneeEditor,
  TaskDueDateEditor,
  TaskPriorityEditor,
  TaskProjectEditor,
  TaskStatusEditor,
} from "@/components/task/TaskPropertyEditors"
import { TaskStatusIcon, useTaskStatusOptions } from "@/components/task/task-status"

/** 行内 chip 统一规格（对齐 Linear，与 TaskGroupList 一致） */
const ROW_CHIP = "flex h-5 shrink-0 items-center gap-1 rounded border px-1.5 text-xs"

// 面板开合记忆跨任务共享（对齐项目详情页抽屉交互）；隐私模式等写入失败静默忽略
const PANEL_KEY = "myLinear:task-panel-open"

// /w/:workspaceId/tasks/:taskId → 任务详情（P0.md §3）：
// 标题/描述就地编辑 + 属性 chip 行（与右侧面板双呈现）+ Sub-issues 子任务区（树形 + 行内创建）
export function TaskDetailPage() {
  const { t } = useTranslation()
  const { workspaceId, taskId } = useParams<{ workspaceId: string; taskId: string }>()
  const navigate = useNavigate()
  const { data: workspaces } = useWorkspaces()
  const { data: task, isLoading, isError, error } = useTask(workspaceId, taskId)
  const { data: subtree } = useTaskSubtree(workspaceId, taskId)
  const updateTask = useUpdateTask(workspaceId!)
  const deleteTask = useDeleteTask(workspaceId!)

  const [panelOpen, setPanelOpen] = useState(() => {
    try {
      return localStorage.getItem(PANEL_KEY) !== "0"
    } catch {
      return true
    }
  })
  const togglePanel = () =>
    setPanelOpen((prev) => {
      const next = !prev
      try {
        localStorage.setItem(PANEL_KEY, next ? "1" : "0")
      } catch {
        /* 静默忽略 */
      }
      return next
    })

  const [confirmDelete, setConfirmDelete] = useState(false)

  // chip/标题/描述编辑共用的 PATCH 入口：统一错误上浮到页内横幅
  const [editError, setEditError] = useState<unknown>(null)
  const patch = (input: UpdateTaskInput) => {
    setEditError(null)
    updateTask.mutate(
      { taskId: taskId!, input },
      { onError: (err) => setEditError(err) },
    )
  }
  const editErrorText = displayError(t, editError, "common.saveFailed")

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t("common.loading")}
      </div>
    )
  }
  if (isError || !task) {
    const notFound = !error || (error instanceof ApiError && error.status === 404)
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {notFound
          ? t("errors.notFound.task")
          : t("errors.loadFailedWithReason", {
              reason: translateError(t, error, "errors.loadFailed"),
            })}
      </div>
    )
  }

  const workspaceName =
    workspaces?.find((w) => w.id === workspaceId)?.name ?? t("common.workspaceFallback")

  return (
    <div className="flex h-full flex-col">
      {/* 页头（Linear 风格）：面包屑行 → 操作行（无 tab，仅右侧面板开关） */}
      <PageHeader
        title={
          <Breadcrumb
            items={[
              { label: workspaceName, to: `/w/${workspaceId}/home` },
              { label: t("nav.tasks"), to: `/w/${workspaceId}/tasks` },
              { label: task.title },
            ]}
          />
        }
        actions={
          <button
            type="button"
            onClick={togglePanel}
            aria-label={panelOpen ? t("common.collapsePanel") : t("common.expandPanel")}
            title={panelOpen ? t("common.collapsePanel") : t("common.expandPanel")}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <PanelRight className="size-4" />
          </button>
        }
      />

      {/* 编辑失败横幅（chip 即点即存的统一错误出口） */}
      {editErrorText && (
        <div className="flex shrink-0 items-center justify-between border-b border-destructive/30 bg-destructive/10 px-6 py-1.5 text-xs text-destructive">
          <span>{editErrorText}</span>
          <button
            type="button"
            aria-label={t("common.closeError")}
            onClick={() => setEditError(null)}
            className="flex size-5 items-center justify-center rounded hover:bg-destructive/20"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto px-6 py-6 scrollbar-gutter-stable">
          {/* 内容列限宽居中（Linear issue 页形态）；面板开合时居中容器自然推挤 */}
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-7">
            <div className="flex flex-col gap-2">
              <TaskTitleEditor task={task} onPatch={patch} />
              {task.parent && (
                <SubIssueOfLine
                  parent={task.parent}
                  onOpen={() => navigate(`/w/${workspaceId}/tasks/${task.parent!.id}`)}
                />
              )}
            </div>

            <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-start gap-4">
              <span className="pt-1.5 text-xs font-medium text-muted-foreground">
                {t("common.properties")}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <TaskStatusEditor task={task} onPatch={patch} />
                <TaskPriorityEditor task={task} onPatch={patch} />
                <TaskAssigneeEditor task={task} workspaceId={workspaceId!} onPatch={patch} />
                <TaskDueDateEditor task={task} onPatch={patch} />
                <TaskProjectEditor task={task} workspaceId={workspaceId!} onPatch={patch} />
              </div>
            </div>

            <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-start gap-4">
              <span className="pt-1.5 text-xs font-medium text-muted-foreground">
                {t("common.description")}
              </span>
              <TaskDescriptionEditor task={task} onPatch={patch} />
            </div>

            <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-start gap-4">
              <span className="pt-1.5 text-xs font-medium text-muted-foreground">
                {t("task.subIssues")}
              </span>
              <SubIssuesSection
                task={task}
                subtree={subtree ?? []}
                workspaceId={workspaceId!}
                onOpenTask={(id) => navigate(`/w/${workspaceId}/tasks/${id}`)}
                onOpenProject={(id) => navigate(`/w/${workspaceId}/projects/${id}`)}
              />
            </div>
          </div>
        </div>

        {/* 右侧属性面板：常驻渲染 + 宽度过渡（同项目详情页抽屉方案），invisible 防关闭态聚焦 */}
        <aside
          aria-hidden={!panelOpen}
          className={cn(
            "shrink-0 overflow-hidden border-border transition-[width,visibility] duration-200 ease-out",
            panelOpen ? "w-80 border-l" : "invisible w-0",
          )}
        >
          <div className="h-full w-80 overflow-y-auto px-4 py-4 scrollbar-gutter-stable">
            <TaskPropertiesPanel
              task={task}
              workspaceId={workspaceId!}
              onPatch={patch}
              onDelete={() => setConfirmDelete(true)}
            />
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={t("task.deleteConfirmTitle", { title: task.title })}
        description={t("task.deleteConfirmDesc")}
        confirmText={t("task.deleteConfirmButton")}
        destructive
        pending={deleteTask.isPending}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() =>
          deleteTask.mutate(task.id, {
            // 对齐 Linear：删除后统一回任务列表；列表页缺参默认 All 视图（与侧栏 Tasks 入口同一落点）。
            // 列表页与详情页是不同路由组件，TaskDetailPage 整体卸载，确认弹窗随之关闭，无需手动关
            onSuccess: () => {
              navigate(`/w/${workspaceId}/tasks`)
            },
          })
        }
      />
    </div>
  )
}

// ---- 标题/描述：Linear 式就地编辑（点击进入，失焦/Enter 保存，Esc 还原）----

/** 子任务详情页标题下 "Sub-issue of" 行（对齐 Linear）：父任务状态图标 + 标题（点击跳转）+ 后代完成徽标 */
function SubIssueOfLine({ parent, onOpen }: { parent: ParentRef; onOpen: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="shrink-0">{t("task.subIssueOf")}</span>
      <button
        type="button"
        onClick={onOpen}
        title={parent.title}
        className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors hover:bg-accent/50 hover:text-foreground"
      >
        <TaskStatusIcon status={parent.status} />
        <span className="truncate text-sm font-medium">{parent.title}</span>
      </button>
      <span className="flex h-5 shrink-0 items-center gap-1 rounded border border-border px-1.5 text-xs">
        <Circle className="size-3" />
        {parent.doneCount}/{parent.totalCount}
      </span>
    </div>
  )
}

function TaskTitleEditor({
  task,
  onPatch,
}: {
  task: TaskDetail
  onPatch: (input: UpdateTaskInput) => void
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(task.title)
  useEffect(() => setValue(task.title), [task.title])

  const revert = () => {
    setValue(task.title)
    setEditing(false)
  }
  const commit = () => {
    setEditing(false)
    const trimmed = value.trim()
    if (trimmed && trimmed !== task.title) onPatch({ title: trimmed })
    else setValue(task.title)
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit()
          if (e.key === "Escape") revert()
        }}
        aria-label={t("task.titleAria")}
        className="w-full bg-transparent text-2xl font-medium tracking-tight text-foreground focus-visible:outline-none"
      />
    )
  }
  return (
    <h1
      onClick={() => setEditing(true)}
      title={t("task.clickEditTitle")}
      className="cursor-text wrap-break-word text-2xl font-medium tracking-tight text-foreground"
    >
      {task.title}
    </h1>
  )
}

function TaskDescriptionEditor({
  task,
  onPatch,
}: {
  task: TaskDetail
  onPatch: (input: UpdateTaskInput) => void
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(task.description)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => setValue(task.description), [task.description])

  // 编辑态高度自适应内容（rows=1 + min-h-9 与展示态同高，进入编辑不撑开页面；输入多行才增长）
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (editing && el) {
      el.style.height = "auto"
      el.style.height = `${el.scrollHeight}px`
    }
  }, [editing, value])

  const revert = () => {
    setValue(task.description)
    setEditing(false)
  }
  const commit = () => {
    setEditing(false)
    if (value !== task.description) onPatch({ description: value })
  }

  if (editing) {
    // 编辑态无边框无底色、与展示态同 padding/字号/行高/最小高度，无缝切换（Linear 式就地编辑）
    return (
      <textarea
        ref={textareaRef}
        autoFocus
        rows={1}
        value={value}
        placeholder={t("common.addDescription")}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") revert()
        }}
        aria-label={t("task.descAria")}
        className="min-h-9 w-full resize-none overflow-hidden bg-transparent px-2 py-1.5 text-sm leading-relaxed text-foreground placeholder:text-ink-tertiary focus-visible:outline-none"
      />
    )
  }
  return (
    <div
      onClick={() => setEditing(true)}
      title={t("common.clickEditDescription")}
      className="min-h-9 cursor-text whitespace-pre-wrap wrap-break-word rounded-md px-2 py-1.5 text-sm leading-relaxed transition-colors hover:bg-accent/50"
    >
      {task.description || (
        <span className="text-muted-foreground">{t("common.addDescription")}</span>
      )}
    </div>
  )
}

// ---- Sub-issues 区：子任务树（x/y 徽标）+ 行内快速创建（P0.md §3）----

function SubIssuesSection({
  task,
  subtree,
  workspaceId,
  onOpenTask,
  onOpenProject,
}: {
  task: TaskDetail
  subtree: TaskNode[]
  workspaceId: string
  onOpenTask: (taskId: string) => void
  onOpenProject: (projectId: string) => void
}) {
  const { t } = useTranslation()
  const createTask = useCreateTask(workspaceId)
  const { data: members } = useMembers(workspaceId)
  const statusOptions = useTaskStatusOptions()
  const priorityOptions = usePriorityOptions()
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [status, setStatus] = useState<TaskStatus>("todo")
  const [priority, setPriority] = useState(0)
  const [assigneeId, setAssigneeId] = useState<string | null>(null)
  const [dueDate, setDueDate] = useState("")
  const [error, setError] = useState<unknown>(null)

  // parentId → 直接子节点；API 已按 (depth, createdAt) 排序，组内天然创建序
  const childrenOf = useMemo(() => {
    const map = new Map<string, TaskNode[]>()
    for (const n of subtree) {
      if (!n.parentId) continue
      const list = map.get(n.parentId)
      if (list) list.push(n)
      else map.set(n.parentId, [n])
    }
    return map
  }, [subtree])

  // 折叠状态按节点 id 键（复用 TaskGroupList 的交互）
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const roots = childrenOf.get(task.id) ?? []
  // 区头进度徽标：x = 后代中 done 数，y = 后代总数（api.md §4 徽标口径）
  const total = subtree.length
  const done = subtree.filter((n) => n.status === "done").length

  // 打开表单：priority / assignee / dueDate 继承父任务（对齐 Linear Add sub-issues）；
  // status 默认 todo；project 由后端强制继承（R4），表单内只读展示
  const openForm = () => {
    setTitle("")
    setDescription("")
    setStatus("todo")
    setPriority(task.priority)
    setAssigneeId(task.assignee?.id ?? null)
    setDueDate(task.dueDate ?? "")
    setError(null)
    setAdding(true)
  }
  const cancel = () => setAdding(false)
  const submit = () => {
    const trimmed = title.trim()
    if (!trimmed) return
    setError(null)
    // projectId 不传：后端继承父任务归属（R4）
    createTask.mutate(
      {
        title: trimmed,
        status,
        priority,
        parentId: task.id,
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(assigneeId ? { assigneeId } : {}),
        ...(dueDate ? { dueDate } : {}),
      },
      {
        onSuccess: () => setAdding(false),
        onError: (err) => setError(err),
      },
    )
  }

  const errorText = displayError(t, error, "common.createFailed")

  return (
    <div className="flex flex-col">
      {total > 0 && (
        <div className="mb-1 flex items-center gap-2 px-2 text-xs text-muted-foreground">
          <span>{t("task.subtreeProgress", { done, total })}</span>
        </div>
      )}
      {roots.map((node) => (
        <SubTaskItem
          key={node.id}
          node={node}
          childrenOf={childrenOf}
          collapsed={collapsed}
          onToggle={toggle}
          onOpenTask={onOpenTask}
          onOpenProject={onOpenProject}
        />
      ))}

      {/* 行内快速创建（创建类操作唯一的非弹窗例外，P0.md §3）：Linear 式卡片表单——
          title + description 无边框输入 + 属性 chip 行（可修改，初始值继承父任务）+ 右侧 Cancel/Create */}
      {adding ? (
        <form
          className="mt-1 rounded-md border border-border bg-surface-1 p-3"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <input
            autoFocus
            value={title}
            placeholder={t("task.subIssueTitlePlaceholder")}
            aria-label={t("task.subIssueTitleAria")}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") cancel()
            }}
            className="w-full bg-transparent text-sm font-medium text-foreground placeholder:text-ink-tertiary focus-visible:outline-none"
          />
          <input
            value={description}
            placeholder={t("common.addDescription")}
            aria-label={t("task.subIssueDescAria")}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1.5 w-full bg-transparent text-sm text-foreground placeholder:text-ink-tertiary focus-visible:outline-none"
          />
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <Select<TaskStatus> value={status} options={statusOptions} onChange={setStatus} />
            <Select value={priority} options={priorityOptions} onChange={setPriority} />
            <Select
              value={assigneeId ?? ""}
              options={memberOptions(members, t("task.unassigned"))}
              onChange={(id) => setAssigneeId(id || null)}
              placeholder={
                <span className="inline-flex items-center gap-1.5">
                  <User className="size-3.5" />
                  {t("task.assignee")}
                </span>
              }
            />
            <DatePicker value={dueDate} onChange={setDueDate} placeholder={t("task.dueDate")} />
            {/* project 继承父任务（R4）：只读 chip 展示 */}
            {task.project && (
              <span
                title={t("task.inheritedProject", { name: task.project.name })}
                className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 text-xs text-ink-muted"
              >
                <Box className="size-3.5" />
                {task.project.name}
              </span>
            )}
            <div className="ml-auto flex items-center gap-1.5">
              <Button type="button" variant="ghost" size="sm" onClick={cancel}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" size="sm" disabled={!title.trim() || createTask.isPending}>
                {t("common.create")}
              </Button>
            </div>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={openForm}
          className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <Plus className="size-3.5" />
          {t("task.addSubIssue")}
        </button>
      )}
      {errorText && <p className="px-2 py-1 text-xs text-destructive">{errorText}</p>}
    </div>
  )
}

/** 后代子树统计：x = done 节点数，y = 节点总数（任意深度，口径同 TaskGroupList） */
function subtreeStats(rootId: string, childrenOf: Map<string, TaskNode[]>) {
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

interface SubTaskItemProps {
  node: TaskNode
  childrenOf: Map<string, TaskNode[]>
  collapsed: ReadonlySet<string>
  onToggle: (id: string) => void
  onOpenTask: (taskId: string) => void
  onOpenProject: (projectId: string) => void
}

function SubTaskItem({
  node,
  childrenOf,
  collapsed,
  onToggle,
  onOpenTask,
  onOpenProject,
}: SubTaskItemProps) {
  const { t } = useTranslation()
  const priorityLabel = usePriorityLabel()
  const children = childrenOf.get(node.id) ?? []
  const isCollapsed = collapsed.has(node.id)
  const stats = children.length > 0 ? subtreeStats(node.id, childrenOf) : null
  // 逾期 = dueDate 早于今天且未完结（done/canceled 不再催）
  const overdue =
    !!node.dueDate && node.dueDate < todayLocal() && node.status !== "done" && node.status !== "canceled"

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpenTask(node.id)}
        onKeyDown={(e) => e.key === "Enter" && onOpenTask(node.id)}
        title={node.title}
        className="group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/50"
      >
        {/* 展开槽：有子节点 = 折叠箭头，否则占位保证同层图标对齐 */}
        {children.length > 0 ? (
          <button
            type="button"
            aria-label={isCollapsed ? t("task.expandSubtasks") : t("task.collapseSubtasks")}
            aria-expanded={!isCollapsed}
            onClick={(e) => {
              e.stopPropagation()
              onToggle(node.id)
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
        <span title={priorityLabel(node.priority)} className="flex shrink-0 items-center">
          <PriorityIcon value={node.priority} />
        </span>
        <TaskStatusIcon status={node.status} />
        <span className="truncate text-sm">{node.title}</span>
        {stats && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {stats.done}/{stats.total}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-2.5 pl-4">
          {/* project 徽标（与锚点任务一致，R4）：悬浮提示 + 点击跳项目详情 */}
          {node.project && (
            <button
              type="button"
              title={node.project.name}
              onClick={(e) => {
                e.stopPropagation()
                onOpenProject(node.project!.id)
              }}
              className={cn(
                ROW_CHIP,
                "border-border text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground",
              )}
            >
              <Box className="size-3" />
              <span className="max-w-24 truncate">{node.project.name}</span>
            </button>
          )}
          {node.dueDate && (
            <span
              className={cn(
                ROW_CHIP,
                overdue
                  ? "border-destructive/50 text-destructive"
                  : "border-border text-muted-foreground",
              )}
            >
              <Calendar className="size-3" />
              {formatYmd(node.dueDate)}
            </span>
          )}
          {/* 无 assignee 渲染虚线占位圈（对齐 Linear） */}
          {node.assignee ? (
            <MemberAvatar name={node.assignee.name} color={node.assignee.avatarColor || undefined} />
          ) : (
            <span
              title={t("task.unassigned")}
              className="size-5 shrink-0 rounded-full border border-dashed border-ink-subtle/60"
            />
          )}
        </span>
      </div>
      {children.length > 0 && !isCollapsed && (
        // 树线：缩进 + 左侧 hairline，数据不限深度（MVP 视觉对齐两层）
        <div className="ml-6 border-l border-border pl-3">
          {children.map((child) => (
            <SubTaskItem
              key={child.id}
              node={child}
              childrenOf={childrenOf}
              collapsed={collapsed}
              onToggle={onToggle}
              onOpenTask={onOpenTask}
              onOpenProject={onOpenProject}
            />
          ))}
        </div>
      )}
    </div>
  )
}
