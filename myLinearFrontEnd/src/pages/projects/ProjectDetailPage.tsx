import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { PanelRight, Plus, X } from "lucide-react"
import type { ProjectDetail, TaskRow, TaskStatus, UpdateProjectInput } from "@/api/types"
import { ApiError } from "@/api/client"
import { displayError, translateError } from "@/lib/errors"
import { RoundIconButton } from "@/components/ui/round-icon-button"
import { useWorkspaces } from "@/hooks/useWorkspaces"
import { useSetProjectLabels } from "@/hooks/useLabels"
import { useDeleteProject, useProject, useUpdateProject } from "@/hooks/useProjects"
import { useProjectTasks } from "@/hooks/useTasks"
import { cn } from "@/lib/utils"
import { encodeConds, parseConds, writeConds, type FilterCond } from "@/lib/filter-state"
import { newTaskDisplay, type TaskDisplayState } from "@/lib/task-display-state"
import { PageHeader, tabPill } from "@/components/layout/PageHeader"
import { Breadcrumb } from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/dialog"
import { FieldRow } from "@/components/ui/field-row"
import { CreateTaskDialog } from "@/components/task/CreateTaskDialog"
import { TaskGroupList } from "@/components/task/TaskGroupList"
import { FilterButton } from "@/components/filter/filter-menu"
import { FilterChipRow } from "@/components/filter/filter-chips"
import { TaskDisplayButton } from "@/components/display/task-display-menu"
import { ProjectPropertiesPanel } from "@/components/project/ProjectPropertiesPanel"
import {
  ProjectDatesEditor,
  ProjectLabelsEditor,
  ProjectLeadEditor,
  ProjectMembersEditor,
  ProjectPriorityEditor,
  ProjectStatusEditor,
} from "@/components/project/ProjectPropertyEditors"

const TABS = [
  { key: "overview", labelKey: "common.tabs.overview" },
  { key: "tasks", labelKey: "nav.tasks" },
] as const

// 面板开合记忆跨项目共享（Linear 同款抽屉交互）；隐私模式等写入失败静默忽略
const PANEL_KEY = "myLinear:project-panel-open"

// /w/:workspaceId/projects/:projectId → 项目详情（属性 + 该项目任务，见 P0.md §2）
// 结构对齐 Linear 项目页：顶部只到面包屑，下方 Overview/Tasks 双 tab，右侧可收起的属性面板
export function ProjectDetailPage() {
  const { t } = useTranslation()
  const { workspaceId, projectId } = useParams<{
    workspaceId: string
    projectId: string
  }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: workspaces } = useWorkspaces()
  // P2 filter 条件列表镜像进 URL（?f= 重复参数，project_issues 面）；
  // 与后端同规则丢弃非法条目，保证 chip 行显示与后端求值一致；project 字段在本面隐含
  const conds = useMemo(() => parseConds(searchParams, "project_issues"), [searchParams])
  const fParams = useMemo(() => encodeConds(conds), [conds])
  const setConds = (next: FilterCond[]) => {
    const sp = new URLSearchParams(searchParams)
    writeConds(sp, next)
    setSearchParams(sp, { replace: true })
  }
  const { data: project, isLoading, isError, error } = useProject(workspaceId, projectId)
  const {
    data: tasks,
    isLoading: tasksLoading,
    isError: tasksError,
    error: tasksErrorMessage,
  } = useProjectTasks(workspaceId, projectId, fParams)
  const updateProject = useUpdateProject(workspaceId!)
  const deleteProject = useDeleteProject(workspaceId!)
  const setProjectLabels = useSetProjectLabels(workspaceId!)

  // Tab 状态放 URL（?tab=），刷新/分享后仍停留在当前 tab；保留 f= 等其余参数（切 tab 不丢 filter）
  const tab = searchParams.get("tab") ?? "overview"
  const setTab = (key: string) => {
    const sp = new URLSearchParams(searchParams)
    sp.set("tab", key)
    setSearchParams(sp, { replace: true })
  }

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

  // display 状态本面一份（project_tasks 切片，P2.md §3 注）：纯内存，切项目/刷新复位；
  // 默认态同 tasks_page（Status 分组 + sub/nested 双开）；过渡期 fixedDisplay（有过滤自动平铺）
  // 已退役——过滤下孤儿/链条由规则④孤儿提根置灰与平铺面包屑兜底，tree/flat 交还用户双开关
  const [display, setDisplay] = useState<TaskDisplayState>(newTaskDisplay)

  const [confirmDelete, setConfirmDelete] = useState(false)

  // chip/标题/描述编辑共用的 PATCH 入口：统一错误上浮到页内横幅
  const [editError, setEditError] = useState<unknown>(null)
  const patch = (input: UpdateProjectInput) => {
    setEditError(null)
    updateProject.mutate(
      { projectId: projectId!, input },
      { onError: (err) => setEditError(err) },
    )
  }
  // 打标走 PUT 子资源（全量替换，api.md §9），错误同路上浮到页内横幅
  const setLabels = (labelIds: string[]) => {
    setEditError(null)
    setProjectLabels.mutate(
      { projectId: projectId!, labelIds },
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
  if (isError || !project) {
    const notFound = !error || (error instanceof ApiError && error.status === 404)
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {notFound
          ? t("errors.notFound.project")
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
      {/* 页头（Linear 风格，吸顶）：面包屑行 → 分割线 → tab 行（胶囊 tab + 右侧面板开关） */}
      <PageHeader
        title={
          <Breadcrumb
            items={[
              { label: workspaceName, to: `/w/${workspaceId}/home` },
              { label: t("nav.projects"), to: `/w/${workspaceId}/projects` },
              { label: project.name },
            ]}
          />
        }
        tabs={TABS.map((tb) => (
          <button key={tb.key} onClick={() => setTab(tb.key)} className={tabPill(tab === tb.key)}>
            {t(tb.labelKey)}
          </button>
        ))}
        actions={
          <>
            {/* filter/display 按钮：对齐 tasks_page（页头 actions，Filter 右侧），置于折叠面板按钮左侧；
                仅 Issues tab 显示（Overview 无列表上下文），条件仍由 URL ?f= 承载；
                本面无 tab 基底作用域排除，Completed tasks 行恒展示 */}
            {tab === "tasks" && (
              <>
                <FilterButton
                  workspaceId={workspaceId!}
                  surface="project_issues"
                  conds={conds}
                  onChange={setConds}
                />
                <TaskDisplayButton state={display} onChange={setDisplay} showCompletedRow />
              </>
            )}
            <RoundIconButton
              label={panelOpen ? t("common.collapsePanel") : t("common.expandPanel")}
              onClick={togglePanel}
            >
              <PanelRight className="size-4" />
            </RoundIconButton>
          </>
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
          {/* 内容列限宽居中（Linear 式）：面板开合时可用宽度变化，居中容器自然产生“被面板推挤”的位移；
              overview 与任务详情页同宽（max-w-3xl），两页推挤前后几何一致；tasks 列表占满可用宽 */}
          {tab === "overview" ? (
            <div className="mx-auto w-full max-w-3xl">
              <OverviewContent
                project={project}
                workspaceId={workspaceId!}
                onPatch={patch}
                onLabelsChange={setLabels}
              />
            </div>
          ) : (
            <TasksContent
              tasks={tasks ?? []}
              tasksLoading={tasksLoading}
              tasksError={tasksError ? displayError(t, tasksErrorMessage, "task.loadFailed") : null}
              workspaceId={workspaceId!}
              conds={conds}
              onChange={setConds}
              display={display}
              onOpenTask={(id) => navigate(`/w/${workspaceId}/tasks/${id}`)}
              onNewTask={openCreate}
            />
          )}
        </div>

        {/* 右侧属性面板：常驻渲染 + 宽度过渡（w-0 ↔ w-96），内容区随 flex 逐帧收窄/推挤，
            与面板开合天然同步（条件渲染会导致内容区宽度瞬跳、只有面板自己有动画，观感“不丝滑”）。
            内层固定 w-96 防动画期间面板内容被压缩换行（也保证 Dates 行两枚日期 chip 单行容下）；
            invisible 在关闭动画结束后生效
            （visibility 过渡规则：隐藏延迟到结束、显示立即），避免关闭态仍可 tab 聚焦 */}
        <aside
          aria-hidden={!panelOpen}
          className={cn(
            "shrink-0 overflow-hidden border-border transition-[width,visibility] duration-200 ease-out",
            panelOpen ? "w-96 border-l" : "invisible w-0",
          )}
        >
          <div className="h-full w-96 overflow-y-auto px-4 py-4 scrollbar-gutter-stable">
            <ProjectPropertiesPanel
              project={project}
              workspaceId={workspaceId!}
              onPatch={patch}
              onLabelsChange={setLabels}
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
        title={t("project.deleteConfirmTitle", { name: project.name })}
        description={t("project.deleteConfirmDesc")}
        confirmText={t("project.deleteConfirmButton")}
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

// ---- Overview tab：标题 / 属性 chip 行 / 描述（对齐 Linear project overview，裁剪 Resources、Milestones 等；Labels 行 P1 已补）----

function OverviewContent({
  project,
  workspaceId,
  onPatch,
  onLabelsChange,
}: {
  project: ProjectDetail
  workspaceId: string
  onPatch: (input: UpdateProjectInput) => void
  onLabelsChange: (labelIds: string[]) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-7">
      <ProjectTitleEditor project={project} onPatch={onPatch} />

      <FieldRow label={t("common.properties")}>
        <div className="flex flex-wrap items-center gap-2">
          <ProjectStatusEditor project={project} onPatch={onPatch} />
          <ProjectPriorityEditor project={project} onPatch={onPatch} />
          <ProjectLeadEditor project={project} workspaceId={workspaceId} onPatch={onPatch} />
          <ProjectMembersEditor project={project} workspaceId={workspaceId} onPatch={onPatch} />
          <ProjectDatesEditor project={project} onPatch={onPatch} />
        </div>
      </FieldRow>

      {/* Labels 独立成行（对齐 Linear）：已打标签逐个 chip + “+” 添加入口，见 ui/label-picker */}
      <FieldRow label={t("common.labels")}>
        <ProjectLabelsEditor
          project={project}
          workspaceId={workspaceId}
          onLabelsChange={onLabelsChange}
        />
      </FieldRow>

      <FieldRow label={t("common.description")}>
        <ProjectDescriptionEditor project={project} onPatch={onPatch} />
      </FieldRow>
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
  workspaceId,
  conds,
  onChange,
  display,
  onOpenTask,
  onNewTask,
}: {
  tasks: TaskRow[]
  tasksLoading: boolean
  tasksError: string | null
  workspaceId: string
  conds: FilterCond[]
  onChange: (next: FilterCond[]) => void
  /** display 状态由页面持有（页头 TaskDisplayButton 写、本列表读，P2.md §3 project_tasks 注） */
  display: TaskDisplayState
  onOpenTask: (taskId: string) => void
  onNewTask: (status: TaskStatus) => void
}) {
  const { t } = useTranslation()
  // 有过滤条件但空 = 无匹配；无过滤条件且空 = 项目暂无任务（对齐 Linear 空态文案）
  const emptyMsg = conds.length > 0 ? t("filter.emptyResult") : t("project.noTasks")
  return (
    <div className="flex flex-col">
      {conds.length > 0 && (
        // bare：本容器已在 px-6 内容区内，去掉 FilterChipRow 自带 mx-6 避免双重内边距
        <FilterChipRow
          bare
          workspaceId={workspaceId}
          surface="project_issues"
          conds={conds}
          onChange={onChange}
        />
      )}
      {tasksLoading && <p className="py-4 text-sm text-muted-foreground">{t("common.loading")}</p>}
      {tasksError && <p className="py-4 text-sm text-destructive">{tasksError}</p>}
      {!tasksLoading && !tasksError && tasks.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-10 text-center">
          <p className="text-sm text-muted-foreground">{emptyMsg}</p>
          <Button variant="secondary" size="sm" className="mt-4" onClick={() => onNewTask("todo")}>
            <Plus />
            {t("task.newTask")}
          </Button>
        </div>
      )}
      {tasks.length > 0 && (
        <TaskGroupList
          tasks={tasks}
          state={display}
          workspaceId={workspaceId}
          onOpenTask={onOpenTask}
          onNewTask={onNewTask}
        />
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
  const { t } = useTranslation()
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
        aria-label={t("project.nameAria")}
        className="w-full bg-transparent text-2xl font-medium tracking-tight text-foreground focus-visible:outline-none"
      />
    )
  }
  return (
    <h1
      onClick={() => setEditing(true)}
      title={t("project.clickEditName")}
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
  const { t } = useTranslation()
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
        placeholder={t("common.addDescription")}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") revert()
        }}
        aria-label={t("project.descAria")}
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
      {project.description || (
        <span className="text-muted-foreground">{t("common.addDescription")}</span>
      )}
    </div>
  )
}
