import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { PanelRight, Plus, X } from "lucide-react"
import type { ProjectDetail, TaskRow, TaskStatus, UpdateProjectInput } from "@/api/types"
import { ApiError, errorMessage } from "@/api/client"
import { useWorkspaces } from "@/hooks/useWorkspaces"
import { useDeleteProject, useProject, useUpdateProject } from "@/hooks/useProjects"
import { useProjectTasks } from "@/hooks/useTasks"
import { cn } from "@/lib/utils"
import { PageHeader, tabPill } from "@/components/layout/PageHeader"
import { Breadcrumb } from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/dialog"
import { CreateTaskDialog } from "@/components/task/CreateTaskDialog"
import { TaskGroupList } from "@/components/task/TaskGroupList"
import { ProjectPropertiesPanel } from "@/components/project/ProjectPropertiesPanel"
import {
  ProjectDatesEditor,
  ProjectLeadEditor,
  ProjectMembersEditor,
  ProjectPriorityEditor,
  ProjectStatusEditor,
} from "@/components/project/ProjectPropertyEditors"

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "tasks", label: "Tasks" },
] as const

// 面板开合记忆跨项目共享（Linear 同款抽屉交互）；隐私模式等写入失败静默忽略
const PANEL_KEY = "myLinear:project-panel-open"

// /w/:workspaceId/projects/:projectId → 项目详情（属性 + 该项目任务，见 P0.md §2）
// 结构对齐 Linear 项目页：顶部只到面包屑，下方 Overview/Tasks 双 tab，右侧可收起的属性面板
export function ProjectDetailPage() {
  const { workspaceId, projectId } = useParams<{
    workspaceId: string
    projectId: string
  }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: workspaces } = useWorkspaces()
  const { data: project, isLoading, isError, error } = useProject(workspaceId, projectId)
  const {
    data: tasks,
    isLoading: tasksLoading,
    isError: tasksError,
    error: tasksErrorMessage,
  } = useProjectTasks(workspaceId, projectId)
  const updateProject = useUpdateProject(workspaceId!)
  const deleteProject = useDeleteProject(workspaceId!)

  // Tab 状态放 URL（?tab=），刷新/分享后仍停留在当前 tab
  const tab = searchParams.get("tab") ?? "overview"
  const setTab = (key: string) => setSearchParams({ tab: key }, { replace: true })

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

  const [createOpen, setCreateOpen] = useState(false)
  const [createStatus, setCreateStatus] = useState<TaskStatus>("todo")
  const openCreate = (status: TaskStatus) => {
    setCreateStatus(status)
    setCreateOpen(true)
  }

  const [confirmDelete, setConfirmDelete] = useState(false)

  // chip/标题/描述编辑共用的 PATCH 入口：统一错误上浮到页内横幅
  const [editError, setEditError] = useState<string | null>(null)
  const patch = (input: UpdateProjectInput) => {
    setEditError(null)
    updateProject.mutate(
      { projectId: projectId!, input },
      { onError: (err) => setEditError(errorMessage(err, "保存失败")) },
    )
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        加载中…
      </div>
    )
  }
  if (isError || !project) {
    const notFound = !error || (error instanceof ApiError && error.status === 404)
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {notFound ? "项目不存在或已删除" : `加载失败：${error!.message}`}
      </div>
    )
  }

  const workspaceName = workspaces?.find((w) => w.id === workspaceId)?.name ?? "Workspace"

  return (
    <div className="flex h-full flex-col">
      {/* 页头（Linear 风格，吸顶）：面包屑行 → 分割线 → tab 行（胶囊 tab + 右侧面板开关） */}
      <PageHeader
        title={
          <Breadcrumb
            items={[
              { label: workspaceName, to: `/w/${workspaceId}/home` },
              { label: "Projects", to: `/w/${workspaceId}/projects` },
              { label: project.name },
            ]}
          />
        }
        tabs={TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={tabPill(tab === t.key)}>
            {t.label}
          </button>
        ))}
        actions={
          <button
            type="button"
            onClick={togglePanel}
            aria-label={panelOpen ? "收起属性面板" : "展开属性面板"}
            title={panelOpen ? "收起属性面板" : "展开属性面板"}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <PanelRight className="size-4" />
          </button>
        }
      />

      {/* 编辑失败横幅（chip 即点即存的统一错误出口） */}
      {editError && (
        <div className="flex shrink-0 items-center justify-between border-b border-destructive/30 bg-destructive/10 px-6 py-1.5 text-xs text-destructive">
          <span>{editError}</span>
          <button
            type="button"
            aria-label="关闭错误提示"
            onClick={() => setEditError(null)}
            className="flex size-5 items-center justify-center rounded hover:bg-destructive/20"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto px-6 py-6 scrollbar-gutter-stable">
          {/* 内容列限宽居中（Linear 式）：面板开合时可用宽度变化，居中容器自然产生“被面板推挤”的位移；
              overview 与任务详情页同宽（max-w-3xl），两页推挤前后几何一致；tasks 列表占满可用宽 */}
          {tab === "overview" ? (
            <div className="mx-auto w-full max-w-3xl">
              <OverviewContent project={project} workspaceId={workspaceId!} onPatch={patch} />
            </div>
          ) : (
            <TasksContent
              tasks={tasks ?? []}
              tasksLoading={tasksLoading}
              tasksError={tasksError ? (tasksErrorMessage?.message ?? "任务加载失败") : null}
              onOpenTask={(id) => navigate(`/w/${workspaceId}/tasks/${id}`)}
              onNewTask={openCreate}
            />
          )}
        </div>

        {/* 右侧属性面板：常驻渲染 + 宽度过渡（w-0 ↔ w-80），内容区随 flex 逐帧收窄/推挤，
            与面板开合天然同步（条件渲染会导致内容区宽度瞬跳、只有面板自己有动画，观感“不丝滑”）。
            内层固定 w-80 防动画期间面板内容被压缩换行；invisible 在关闭动画结束后生效
            （visibility 过渡规则：隐藏延迟到结束、显示立即），避免关闭态仍可 tab 聚焦 */}
        <aside
          aria-hidden={!panelOpen}
          className={cn(
            "shrink-0 overflow-hidden border-border transition-[width,visibility] duration-200 ease-out",
            panelOpen ? "w-80 border-l" : "invisible w-0",
          )}
        >
          <div className="h-full w-80 overflow-y-auto px-4 py-4 scrollbar-gutter-stable">
            <ProjectPropertiesPanel
              project={project}
              workspaceId={workspaceId!}
              onPatch={patch}
              onDelete={() => setConfirmDelete(true)}
            />
          </div>
        </aside>
      </div>

      <CreateTaskDialog
        open={createOpen}
        workspaceId={workspaceId!}
        project={{ id: project.id, name: project.name }}
        defaultStatus={createStatus}
        onClose={() => setCreateOpen(false)}
      />

      <ConfirmDialog
        open={confirmDelete}
        title={`删除项目「${project.name}」？`}
        description="项目将被软删除；其下任务保留并自动变为无项目任务。"
        confirmText="删除项目"
        destructive
        pending={deleteProject.isPending}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() =>
          deleteProject.mutate(project.id, {
            onSuccess: () => navigate(`/w/${workspaceId}/projects`),
          })
        }
      />
    </div>
  )
}

// ---- Overview tab：标题 / 属性 chip 行 / 描述（对齐 Linear project overview，裁剪 Labels P1、Resources、Milestones 等）----

function OverviewContent({
  project,
  workspaceId,
  onPatch,
}: {
  project: ProjectDetail
  workspaceId: string
  onPatch: (input: UpdateProjectInput) => void
}) {
  return (
    <div className="flex flex-col gap-7">
      <ProjectTitleEditor project={project} onPatch={onPatch} />

      <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-start gap-4">
        <span className="pt-1.5 text-xs font-medium text-muted-foreground">Properties</span>
        <div className="flex flex-wrap items-center gap-2">
          <ProjectStatusEditor project={project} onPatch={onPatch} />
          <ProjectPriorityEditor project={project} onPatch={onPatch} />
          <ProjectLeadEditor project={project} workspaceId={workspaceId} onPatch={onPatch} />
          <ProjectMembersEditor project={project} workspaceId={workspaceId} onPatch={onPatch} />
          <ProjectDatesEditor project={project} onPatch={onPatch} />
        </div>
      </div>

      <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-start gap-4">
        <span className="pt-1.5 text-xs font-medium text-muted-foreground">Description</span>
        <ProjectDescriptionEditor project={project} onPatch={onPatch} />
      </div>
    </div>
  )
}

// ---- Tasks tab：项目任务列表（复用 TaskGroupList，创建入口锁定本项目）----
// 无独立标题行（对齐 Linear：tab 下直接是分组列表，数量在各组头）；
// 新建入口 = 组头常驻 "+"（以该组状态为默认值）+ 空态按钮

function TasksContent({
  tasks,
  tasksLoading,
  tasksError,
  onOpenTask,
  onNewTask,
}: {
  tasks: TaskRow[]
  tasksLoading: boolean
  tasksError: string | null
  onOpenTask: (taskId: string) => void
  onNewTask: (status: TaskStatus) => void
}) {
  return (
    <div className="flex flex-col">
      {tasksLoading && <p className="py-4 text-sm text-muted-foreground">加载中…</p>}
      {tasksError && <p className="py-4 text-sm text-destructive">{tasksError}</p>}
      {!tasksLoading && !tasksError && tasks.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-10 text-center">
          <p className="text-sm text-muted-foreground">项目中还没有任务</p>
          <Button variant="secondary" size="sm" className="mt-4" onClick={() => onNewTask("todo")}>
            <Plus />
            New task
          </Button>
        </div>
      )}
      {tasks.length > 0 && (
        // 项目任务为全量（无状态筛选）→ 树形视图（跨状态置灰，对齐 Linear）
        <TaskGroupList tasks={tasks} view="tree" onOpenTask={onOpenTask} onNewTask={onNewTask} />
      )}
    </div>
  )
}

// ---- 标题/描述：Linear 式就地编辑（点击进入，失焦/Enter 保存，Esc 还原）----

function ProjectTitleEditor({
  project,
  onPatch,
}: {
  project: ProjectDetail
  onPatch: (input: UpdateProjectInput) => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(project.name)
  useEffect(() => setValue(project.name), [project.name])

  const revert = () => {
    setValue(project.name)
    setEditing(false)
  }
  const commit = () => {
    setEditing(false)
    const trimmed = value.trim()
    if (trimmed && trimmed !== project.name) onPatch({ name: trimmed })
    else setValue(project.name)
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
        aria-label="项目名称"
        className="w-full bg-transparent text-2xl font-medium tracking-tight text-foreground focus-visible:outline-none"
      />
    )
  }
  return (
    <h1
      onClick={() => setEditing(true)}
      title="点击编辑名称"
      className="cursor-text wrap-break-word text-2xl font-medium tracking-tight text-foreground"
    >
      {project.name}
    </h1>
  )
}

function ProjectDescriptionEditor({
  project,
  onPatch,
}: {
  project: ProjectDetail
  onPatch: (input: UpdateProjectInput) => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(project.description)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => setValue(project.description), [project.description])

  // 编辑态高度自适应内容（rows=1 + min-h-9 与展示态同高，进入编辑不撑开页面；输入多行才增长）
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (editing && el) {
      el.style.height = "auto"
      el.style.height = `${el.scrollHeight}px`
    }
  }, [editing, value])

  const revert = () => {
    setValue(project.description)
    setEditing(false)
  }
  const commit = () => {
    setEditing(false)
    if (value !== project.description) onPatch({ description: value })
  }

  if (editing) {
    // 编辑态无边框无底色、与展示态同 padding/字号/行高/最小高度，无缝切换（Linear 式就地编辑）
    return (
      <textarea
        ref={textareaRef}
        autoFocus
        rows={1}
        value={value}
        placeholder="Add description..."
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") revert()
        }}
        aria-label="项目描述"
        className="min-h-9 w-full resize-none overflow-hidden bg-transparent px-2 py-1.5 text-sm leading-relaxed text-foreground placeholder:text-ink-tertiary focus-visible:outline-none"
      />
    )
  }
  return (
    <div
      onClick={() => setEditing(true)}
      title="点击编辑描述"
      className="min-h-9 cursor-text whitespace-pre-wrap wrap-break-word rounded-md px-2 py-1.5 text-sm leading-relaxed transition-colors hover:bg-accent/50"
    >
      {project.description || <span className="text-muted-foreground">Add description...</span>}
    </div>
  )
}
