import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { PanelRight, Plus, X } from "lucide-react"
import type { ProjectDetail, TaskRow, TaskStatus, UpdateProjectInput, View } from "@/api/types"
import { ApiError } from "@/api/client"
import { displayError, translateError } from "@/lib/errors"
import { RoundIconButton } from "@/components/ui/round-icon-button"
import { useWorkspaces } from "@/hooks/useWorkspaces"
import { useSetProjectLabels } from "@/hooks/useLabels"
import { useDeleteProject, useProject, useUpdateProject } from "@/hooks/useProjects"
import { useProjectTasks } from "@/hooks/useTasks"
import { useCreateView, useDeleteView, useUpdateView, useViews } from "@/hooks/useViews"
import { cn } from "@/lib/utils"
import { encodeConds, parseConds, writeConds, type FilterCond } from "@/lib/filter-state"
import { isSameTaskDisplay, type TaskDisplayState } from "@/lib/task-display-state"
import { decodeTaskConfig, encodeTaskConfig, type TaskViewSnapshot } from "@/lib/view-state"
import { PageHeader } from "@/components/layout/PageHeader"
import { Breadcrumb } from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/dialog"
import { FieldRow } from "@/components/ui/field-row"
import { CreateTaskDialog } from "@/components/task/CreateTaskDialog"
import { TaskGroupList } from "@/components/task/TaskGroupList"
import { FilterButton } from "@/components/filter/filter-menu"
import { FilterChipRow } from "@/components/filter/filter-chips"
import { TaskDisplayButton } from "@/components/display/task-display-menu"
import { ViewTabs } from "@/components/view/ViewTabs"
import { ViewEditPanel } from "@/components/view/ViewEditPanel"
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

type ProjectTab = typeof TABS[number]["key"]
interface ViewDraft extends TaskViewSnapshot {
  mode: "new" | "edit"
  viewId?: string
  name: string
  description: string
}
type ViewPanel = "filter" | "display" | "chips-filter"
const EMPTY_FILTERS: FilterCond[] = []
const VIEW_SURFACE = "project_issues"

// 面板开合记忆跨项目共享（Linear 同款抽屉交互）；隐私模式等写入失败静默忽略
const PANEL_KEY = "myLinear:project-panel-open"

// /w/:workspaceId/projects/:projectId → 项目详情（属性 + 该项目任务，见 P0.md §2）
// 结构对齐 Linear 项目页：Overview/Tasks + 项目级 views，右侧可收起的属性面板。
// 项目或工作区切换时结束页面会话，避免浏览缓存、草稿及异步回调跨项目串用。
export function ProjectDetailPage() {
  const { workspaceId, projectId } = useParams<{ workspaceId: string; projectId: string }>()
  return <ProjectDetailContent key={`${workspaceId}:${projectId}`} workspaceId={workspaceId!} projectId={projectId!} />
}

function ProjectDetailContent({ workspaceId, projectId }: { workspaceId: string; projectId: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: workspaces } = useWorkspaces()
  const { data: project, isLoading, isError, error } = useProject(workspaceId, projectId)
  const updateProject = useUpdateProject(workspaceId)
  const deleteProject = useDeleteProject(workspaceId)
  const setProjectLabels = useSetProjectLabels(workspaceId)

  // view 优先于 tab；f= 只承载浏览临时条件，项目作用域始终由任务接口路径固定。
  const tab: ProjectTab = searchParams.get("tab") === "tasks" ? "tasks" : "overview"
  const activeViewId = searchParams.get("view")
  const tabKey = activeViewId ?? tab
  const conds = useMemo(() => parseConds(searchParams, VIEW_SURFACE), [searchParams])
  const viewQuery = useViews(workspaceId, VIEW_SURFACE, projectId)
  const views = viewQuery.data
  const activeView = views?.find((view) => view.id === activeViewId) ?? null
  const saved = useMemo(() => decodeTaskConfig(activeView?.config, VIEW_SURFACE), [activeView])
  const viewReady = !activeViewId || !!activeView
  const createView = useCreateView(workspaceId)
  const updateView = useUpdateView(workspaceId)
  const deleteView = useDeleteView(workspaceId)
  const busy = createView.isPending || updateView.isPending || deleteView.isPending
  const [viewError, setViewError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<View | null>(null)
  const [draft, setActiveDraft] = useState<ViewDraft | null>(null)
  const editDrafts = useRef<Record<string, ViewDraft>>({})
  const setDraft = (next: ViewDraft) => {
    if (next.mode === "edit" && next.viewId) editDrafts.current[next.viewId] = next
    setActiveDraft(next)
  }
  // 与列表页同口径：每 tab 浏览临时层、每 View 编辑草稿独立，卸载清空。
  const [tabs, setTabs] = useState<Record<string, TaskViewSnapshot>>({})
  const display = tabs[tabKey]?.display ?? saved.display
  const [absorbing, setAbsorbing] = useState<{
    viewId: string
    filters: FilterCond[]
    settled: boolean
  } | null>(null)
  const [openPanel, setOpenPanel] = useState<ViewPanel | null>(null)
  const panelControl = (id: ViewPanel) => ({
    open: openPanel === id,
    onOpenChange: (open: boolean) => setOpenPanel((current) =>
      open ? id : current === id ? null : current),
  })
  const transition = useRef(0)
  const selectedTab = useRef(tabKey)
  useEffect(() => {
    if (selectedTab.current === tabKey) return
    selectedTab.current = tabKey
    transition.current++
    setActiveDraft(null)
    setOpenPanel(null)
    setViewError(null)
  }, [tabKey])
  useEffect(() => {
    if (!viewReady) return
    setTabs((old) => old[tabKey]?.filters === conds && old[tabKey]?.display === display
      ? old : { ...old, [tabKey]: { filters: conds, display } })
  }, [tabKey, conds, display, viewReady])
  useEffect(() => {
    if (absorbing?.settled && (activeViewId !== absorbing.viewId || conds.length === 0)) {
      setAbsorbing(null)
    }
  }, [absorbing, activeViewId, conds])
  const browseFilters = useMemo(() =>
    absorbing?.viewId === activeViewId ? absorbing.filters : [...saved.filters, ...conds],
  [absorbing, activeViewId, saved.filters, conds])
  const effectiveConds = draft?.filters ?? browseFilters
  const effectiveDisplay = draft?.display ?? display
  const showTasks = !!draft || !!activeViewId || tab === "tasks"
  const fParams = useMemo(() => encodeConds(effectiveConds), [effectiveConds])
  const {
    data: tasks,
    isLoading: tasksLoading,
    isError: tasksError,
    error: tasksErrorMessage,
  } = useProjectTasks(workspaceId, projectId, fParams, !!project && !isError && viewReady && showTasks)
  const displayChanged = !isSameTaskDisplay(display, saved.display)
  const deviatedViewIds = useMemo(() => new Set((views ?? []).filter((view) => {
    const state = view.id === activeViewId ? { filters: conds, display } : tabs[view.id]
    return state && (state.filters.length > 0 ||
      !isSameTaskDisplay(state.display, decodeTaskConfig(view.config, VIEW_SURFACE).display))
  }).map((view) => view.id)), [views, activeViewId, tabs, conds, display])

  const writeLocation = (id: string | null, filters: FilterCond[], replace = true, preset: ProjectTab = tab) => {
    const sp = new URLSearchParams(searchParams)
    if (id) {
      sp.set("view", id)
      sp.delete("tab")
    } else {
      sp.delete("view")
      sp.set("tab", preset)
    }
    writeConds(sp, filters)
    setSearchParams(sp, { replace })
  }
  const setConds = (filters: FilterCond[]) => {
    setTabs((old) => ({ ...old, [tabKey]: { filters, display } }))
    writeLocation(activeViewId, filters)
  }
  const setEffectiveConds = (filters: FilterCond[]) => {
    if (busy) return
    if (draft) setDraft({ ...draft, filters })
    else setConds(filters)
  }
  const setEffectiveDisplay = (next: TaskDisplayState) => {
    if (busy) return
    if (draft) setDraft({ ...draft, display: next })
    else setTabs((old) => ({ ...old, [tabKey]: { filters: conds, display: next } }))
  }
  const closeEditor = () => {
    transition.current++
    setActiveDraft(null)
    setOpenPanel(null)
    setViewError(null)
  }
  const cancelEdit = () => {
    if (draft?.viewId) delete editDrafts.current[draft.viewId]
    closeEditor()
  }
  const activateTab = (id: string | null, preset: ProjectTab = "tasks") => {
    closeEditor()
    const key = id ?? preset
    selectedTab.current = key
    const filters = key === tabKey ? conds : tabs[key]?.filters ?? EMPTY_FILTERS
    writeLocation(id, filters, false, preset)
  }
  const startNewView = (fromCurrent = false) => {
    if (busy || !viewQuery.isSuccess || !viewReady) return
    // Overview 没有任务展示上下文，从此入口新建时继承 Tasks 浏览 Display；取消回 Overview。
    const sourceDisplay = !draft && !activeViewId && tab === "overview"
      ? tabs.tasks?.display ?? saved.display : effectiveDisplay
    const snapshot = decodeTaskConfig(encodeTaskConfig(fromCurrent ? browseFilters : [], sourceDisplay), VIEW_SURFACE)
    closeEditor()
    setDraft({ mode: "new", name: "", description: "", ...snapshot })
  }
  const editView = (id: string) => {
    const view = views?.find((v) => v.id === id)
    if (!view || busy) return
    activateTab(id)
    setDraft(editDrafts.current[id] ?? {
      mode: "edit", viewId: id, name: view.name, description: view.description,
      ...decodeTaskConfig(view.config, VIEW_SURFACE),
    })
  }
  const resetView = () => {
    if (busy) return
    setTabs((old) => ({ ...old, [tabKey]: { filters: [], display: saved.display } }))
    writeLocation(activeViewId, [])
    setOpenPanel(null)
  }
  const resetDraft = () => {
    const view = views?.find((v) => v.id === draft?.viewId)
    if (!draft || !view || busy) return
    setDraft({ ...draft, name: view.name, description: view.description, ...decodeTaskConfig(view.config, VIEW_SURFACE) })
    setOpenPanel(null)
  }
  const saveDraft = () => {
    if (!draft || !draft.name.trim() || busy) return
    const version = transition.current
    const resumeFilters = draft.mode === "edit" ? conds : EMPTY_FILTERS
    setOpenPanel(null)
    setViewError(null)
    const input = { name: draft.name.trim(), description: draft.description.trim(),
      config: encodeTaskConfig(draft.filters, draft.display) }
    const onSuccess = (view: View) => {
      delete editDrafts.current[view.id]
      const next = { filters: resumeFilters, display: decodeTaskConfig(view.config, VIEW_SURFACE).display }
      setTabs((old) => ({ ...old, [view.id]: next }))
      if (transition.current !== version) return
      closeEditor()
      selectedTab.current = view.id
      writeLocation(view.id, next.filters)
    }
    const onError = (err: unknown) => {
      if (transition.current === version) setViewError(displayError(t, err, "common.saveFailed"))
    }
    if (draft.mode === "edit" && draft.viewId) {
      updateView.mutate({ viewId: draft.viewId, input }, { onSuccess, onError })
    } else {
      createView.mutate({ ...input, surface: VIEW_SURFACE, entityType: "task", projectId }, { onSuccess, onError })
    }
  }
  const saveToThisView = () => {
    if (!activeView || busy) return
    const id = activeView.id
    const version = transition.current
    setOpenPanel(null)
    setViewError(null)
    // 保存缓存与 URL 临时层交接前固定取数快照，避免短暂重复 AND。
    setAbsorbing({ viewId: id, filters: browseFilters, settled: false })
    updateView.mutate({ viewId: id, input: { config: encodeTaskConfig(browseFilters, display) } }, {
      onSuccess: (view) => {
        delete editDrafts.current[id]
        setTabs((old) => ({ ...old, [id]: { filters: [], display: decodeTaskConfig(view.config, VIEW_SURFACE).display } }))
        if (selectedTab.current === id) writeLocation(id, [])
        setAbsorbing((current) => current?.viewId === id ? { ...current, settled: true } : current)
      },
      onError: (err) => {
        setAbsorbing(null)
        if (transition.current === version) setViewError(displayError(t, err, "common.saveFailed"))
      },
    })
  }
  const requestDeleteView = (id: string) => {
    if (busy) return
    setOpenPanel(null)
    setViewError(null)
    setDeleting(views?.find((v) => v.id === id) ?? null)
  }
  const confirmDeleteView = () => {
    if (!deleting || busy) return
    const id = deleting.id
    deleteView.mutate(id, {
      onSuccess: () => {
        setDeleting(null)
        delete editDrafts.current[id]
        setTabs((old) => { const next = { ...old }; delete next[id]; return next })
        if (selectedTab.current === id) activateTab(null)
      },
      onError: (err) => {
        setDeleting(null)
        setViewError(displayError(t, err, "view.deleteFailed"))
      },
    })
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
        tabs={
          <ViewTabs
            workspaceId={workspaceId}
            presets={TABS.map((preset) => ({
              key: preset.key, label: t(preset.labelKey), active: tab === preset.key,
              onSelect: () => activateTab(null, preset.key),
            }))}
            views={views ?? []}
            activeViewId={activeViewId}
            editing={draft ? { mode: draft.mode, viewId: draft.viewId, name: draft.name } : null}
            deviatedViewIds={deviatedViewIds}
            busy={busy || !viewQuery.isSuccess || !viewReady}
            onSelectView={(id) => activateTab(id)}
            onNewView={() => startNewView()}
            onEditView={editView}
            onDeleteView={requestDeleteView}
          />
        }
        actions={
          <>
            {/* Overview 无列表入口；新建/编辑仅 panel 内操作草稿，Completed tasks 恒可配置。 */}
            {showTasks && !draft && (
              <fieldset disabled={busy || !viewReady} className="flex items-center gap-1">
                <FilterButton
                  {...panelControl("filter")}
                  showIndicator={false}
                  workspaceId={workspaceId}
                  surface={VIEW_SURFACE}
                  conds={conds}
                  onChange={setEffectiveConds}
                />
                <TaskDisplayButton
                  {...panelControl("display")}
                  state={display}
                  onChange={setEffectiveDisplay}
                  resetTarget={saved.display}
                  showCompletedRow
                />
              </fieldset>
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
        <div className="flex min-w-0 flex-1 flex-col">
          {viewError && <p role="alert" className="mx-6 mb-2 text-sm text-destructive">{viewError}</p>}
          {viewQuery.isError && (
            <p role="alert" className="mx-6 mb-2 text-sm text-destructive">
              {displayError(t, viewQuery.error, "errors.loadFailed")}
            </p>
          )}
          {!viewReady && viewQuery.isSuccess && (
            <p role="alert" className="mx-6 mb-2 text-sm text-destructive">{t("view.notFound")}</p>
          )}
          {!viewReady && viewQuery.isPending && (
            <p className="mx-6 mb-2 text-sm text-muted-foreground">{t("common.loading")}</p>
          )}
          {draft ? (
            <ViewEditPanel
              mode={draft.mode}
              name={draft.name}
              description={draft.description}
              workspaceId={workspaceId}
              surface={VIEW_SURFACE}
              filters={draft.filters}
              displayButton={
                <TaskDisplayButton
                  {...panelControl("display")}
                  state={draft.display}
                  onChange={setEffectiveDisplay}
                  resetTarget={draft.mode === "new" ? null : saved.display}
                  showCompletedRow
                />
              }
              saving={busy}
              filterControl={panelControl("filter")}
              onNameChange={(name) => setDraft({ ...draft, name })}
              onDescriptionChange={(description) => setDraft({ ...draft, description })}
              onFiltersChange={setEffectiveConds}
              onReset={draft.mode === "edit" ? resetDraft : undefined}
              onDelete={draft.viewId ? () => requestDeleteView(draft.viewId!) : undefined}
              onSave={saveDraft}
              onCancel={cancelEdit}
            />
          ) : (
            showTasks && viewReady && (conds.length > 0 || displayChanged) && (
              <FilterChipRow
                workspaceId={workspaceId}
                surface={VIEW_SURFACE}
                conds={conds}
                onChange={setEffectiveConds}
                activeView={activeView}
                disabled={busy}
                label={t("view.temporaryChanges")}
                emptyHint={displayChanged ? t("view.displayModified") : undefined}
                filterControl={panelControl("chips-filter")}
                onReset={resetView}
                onSaveToView={activeView ? saveToThisView : undefined}
                onCreateNewView={() => startNewView(true)}
              />
            )
          )}
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 scrollbar-gutter-stable">
            {/* 内容列限宽居中（Linear 式）：面板开合时可用宽度变化，居中容器自然产生“被面板推挤”的位移；
                overview 与任务详情页同宽（max-w-3xl），两页推挤前后几何一致；tasks 列表占满可用宽 */}
            {!showTasks ? (
              <div className="mx-auto w-full max-w-3xl">
                <OverviewContent
                  project={project}
                  workspaceId={workspaceId}
                  onPatch={patch}
                  onLabelsChange={setLabels}
                />
              </div>
            ) : viewReady && (
              <TasksContent
                tasks={tasks ?? []}
                tasksLoading={tasksLoading}
                tasksError={tasksError ? displayError(t, tasksErrorMessage, "task.loadFailed") : null}
                workspaceId={workspaceId}
                filtered={!!draft || !!activeViewId || effectiveConds.length > 0}
                display={effectiveDisplay}
                onOpenTask={(id) => navigate(`/w/${workspaceId}/tasks/${id}`)}
                onNewTask={openCreate}
              />
            )}
          </div>
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
        open={deleting !== null}
        title={t("view.deleteTitle", { name: deleting?.name ?? "" })}
        description={t("view.deleteDescription")}
        confirmText={t("view.delete")}
        destructive
        pending={deleteView.isPending}
        onConfirm={confirmDeleteView}
        onClose={() => { if (!deleteView.isPending) setDeleting(null) }}
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
  filtered,
  display,
  onOpenTask,
  onNewTask,
}: {
  tasks: TaskRow[]
  tasksLoading: boolean
  tasksError: string | null
  workspaceId: string
  filtered: boolean
  /** display 由页面视图状态驱动，任务列表仅负责渲染。 */
  display: TaskDisplayState
  onOpenTask: (taskId: string) => void
  onNewTask: (status: TaskStatus) => void
}) {
  const { t } = useTranslation()
  // 有过滤条件但空 = 无匹配；无过滤条件且空 = 项目暂无任务（对齐 Linear 空态文案）
  const emptyMsg = filtered ? t("filter.emptyResult") : t("project.noTasks")
  return (
    <div className="flex flex-col">
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
