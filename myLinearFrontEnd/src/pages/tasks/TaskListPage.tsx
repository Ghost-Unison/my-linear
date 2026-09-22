import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { Plus } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { ProjectRef, TaskStatus, TaskTab, View } from "@/api/types"
import { displayError } from "@/lib/errors"
import { encodeConds, parseConds, writeConds, type FilterCond } from "@/lib/filter-state"
import { isSameTaskDisplay, type TaskDisplayState } from "@/lib/task-display-state"
import { decodeTaskConfig, encodeTaskConfig, type TaskViewSnapshot } from "@/lib/view-state"
import { useWorkspaces } from "@/hooks/useWorkspaces"
import { useWorkspaceTasks } from "@/hooks/useTasks"
import { useCreateView, useDeleteView, useUpdateView, useViews } from "@/hooks/useViews"
import { PageHeader } from "@/components/layout/PageHeader"
import { Breadcrumb } from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/dialog"
import { ViewTabs } from "@/components/view/ViewTabs"
import { ViewEditPanel } from "@/components/view/ViewEditPanel"
import { FilterButton } from "@/components/filter/filter-menu"
import { FilterChipRow } from "@/components/filter/filter-chips"
import { TaskDisplayButton } from "@/components/display/task-display-menu"
import { CreateTaskDialog } from "@/components/task/CreateTaskDialog"
import { TaskGroupList } from "@/components/task/TaskGroupList"

// 顶部 tab（P0.md §3）：纯前端隐式基底作用域，请求时合成 f= status 条件（后端 filter= 已退役）
const TAB_KEYS: TaskTab[] = ["active", "backlog", "all"]

// tab → 基底条件（不显示为 chip）：Active = todo + in_progress、Backlog = backlog、All = 不附加
const TAB_CONDS: Record<TaskTab, FilterCond[]> = {
  active: [{ field: "status", op: "isAnyOf", values: ["todo", "in_progress"] }],
  backlog: [{ field: "status", op: "is", values: ["backlog"] }],
  all: [],
}

interface ViewDraft extends TaskViewSnapshot {
  mode: "new" | "edit"
  viewId?: string
  name: string
  description: string
}

type ViewPanel = "filter" | "display" | "chips-filter"
const EMPTY_FILTERS: FilterCond[] = []

// 工作区切换即结束当前页面会话，避免浏览临时层与编辑草稿跨工作区串用。
export function TaskListPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  return <TaskListContent key={workspaceId} workspaceId={workspaceId!} />
}

function TaskListContent({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: workspaces } = useWorkspaces()
  // view 优先于 tab；预设缺省为 All。f= 仅承载当前 tab 的浏览临时条件。
  const rawTab = searchParams.get("tab")
  const tab: TaskTab = rawTab === "active" || rawTab === "backlog" ? rawTab : "all"
  const activeViewId = searchParams.get("view")
  const tabKey = activeViewId ?? tab
  const conds = useMemo(() => parseConds(searchParams, "tasks_page"), [searchParams])
  const viewQuery = useViews(workspaceId, "tasks_page")
  const views = viewQuery.data
  const activeView = views?.find((v) => v.id === activeViewId) ?? null
  const saved = useMemo(() => {
    const snapshot = decodeTaskConfig(activeView?.config)
    return activeView ? snapshot : { ...snapshot, filters: TAB_CONDS[tab] }
  }, [activeView, tab])
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
  // 与 Projects 同口径：每 tab 浏览缓存与每 View 编辑缓存互不覆盖，仅页面会话内存活。
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
  // 新建/编辑仅用 draft，不叠加来源预设的 status，也不叠加浏览临时条件。
  const effectiveConds = draft?.filters ?? browseFilters
  const effectiveDisplay = draft?.display ?? display
  const fParams = useMemo(() => encodeConds(effectiveConds), [effectiveConds])
  const { data: tasks, isLoading, isError, error } = useWorkspaceTasks(workspaceId, fParams, viewReady)
  const displayChanged = !isSameTaskDisplay(display, saved.display)
  const deviatedViewIds = useMemo(() => new Set((views ?? []).filter((view) => {
    const state = view.id === activeViewId ? { filters: conds, display } : tabs[view.id]
    return state && (state.filters.length > 0 ||
      !isSameTaskDisplay(state.display, decodeTaskConfig(view.config).display))
  }).map((view) => view.id)), [views, activeViewId, tabs, conds, display])

  const writeLocation = (id: string | null, filters: FilterCond[], replace = true, preset: TaskTab = tab) => {
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
  const activateTab = (id: string | null, preset: TaskTab = "all") => {
    closeEditor()
    const key = id ?? preset
    selectedTab.current = key
    const filters = key === tabKey ? conds : tabs[key]?.filters ?? EMPTY_FILTERS
    writeLocation(id, filters, false, preset)
  }
  const startNewView = (fromCurrent = false) => {
    if (busy || !viewQuery.isSuccess || !viewReady) return
    const snapshot = decodeTaskConfig(encodeTaskConfig(fromCurrent ? browseFilters : [], effectiveDisplay))
    closeEditor()
    setDraft({ mode: "new", name: "", description: "", ...snapshot })
  }
  const editView = (id: string) => {
    const view = views?.find((v) => v.id === id)
    if (!view || busy) return
    activateTab(id)
    setDraft(editDrafts.current[id] ?? {
      mode: "edit", viewId: id, name: view.name, description: view.description,
      ...decodeTaskConfig(view.config),
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
    setDraft({ ...draft, name: view.name, description: view.description, ...decodeTaskConfig(view.config) })
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
      const next = { filters: resumeFilters, display: decodeTaskConfig(view.config).display }
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
      createView.mutate({ ...input, surface: "tasks_page", entityType: "task" }, { onSuccess, onError })
    }
  }
  const saveToThisView = () => {
    if (!activeView || busy) return
    const id = activeView.id
    const version = transition.current
    setOpenPanel(null)
    setViewError(null)
    // 固定取数快照，直到保存缓存与 URL 临时层交接完毕，避免短暂重复 AND。
    setAbsorbing({ viewId: id, filters: browseFilters, settled: false })
    updateView.mutate({ viewId: id, input: { config: encodeTaskConfig(browseFilters, display) } }, {
      onSuccess: (view) => {
        delete editDrafts.current[id]
        setTabs((old) => ({ ...old, [id]: { filters: [], display: decodeTaskConfig(view.config).display } }))
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

  const [createOpen, setCreateOpen] = useState(false)
  const [createStatus, setCreateStatus] = useState<TaskStatus>("todo")
  // 组头 "+" 预填：status 必传；project 组路径命中时锁定归属
  const [createProject, setCreateProject] = useState<ProjectRef | undefined>(undefined)
  const openCreate = (status: TaskStatus, project?: ProjectRef) => {
    setCreateStatus(status)
    setCreateProject(project)
    setCreateOpen(true)
  }

  const workspaceName =
    workspaces?.find((w) => w.id === workspaceId)?.name ?? t("common.workspaceFallback")

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={
          <Breadcrumb
            items={[{ label: workspaceName, to: `/w/${workspaceId}/home` }, { label: t("nav.tasks") }]}
          />
        }
        tabs={
          <ViewTabs
            workspaceId={workspaceId}
            presets={TAB_KEYS.map((key) => ({
              key, label: t(`enums.taskFilter.${key}`), active: tab === key,
              onSelect: () => activateTab(null, key),
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
            {!draft && (
              <fieldset disabled={busy || !viewReady} className="flex items-center gap-1">
                <FilterButton
                  {...panelControl("filter")}
                  showIndicator={false}
                  workspaceId={workspaceId}
                  surface="tasks_page"
                  conds={conds}
                  onChange={setEffectiveConds}
                />
                {/* 自定义 View 不继承预设 status 作用域，Completed tasks 始终可配置。 */}
                <TaskDisplayButton
                  {...panelControl("display")}
                  state={display}
                  onChange={setEffectiveDisplay}
                  resetTarget={saved.display}
                  showCompletedRow={!!activeViewId || tab === "all"}
                />
              </fieldset>
            )}
            {/* 与 New project / Add a member 同款 ghost 按钮 */}
            <Button variant="ghost" size="sm" onClick={() => openCreate("todo")}>
              <Plus />
              {t("task.newTask")}
            </Button>
          </>
        }
      />

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
          surface="tasks_page"
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
        viewReady && (conds.length > 0 || displayChanged) && (
          <FilterChipRow
            workspaceId={workspaceId}
            surface="tasks_page"
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

      <div hidden={!viewReady} className="min-h-0 flex-1 overflow-y-auto px-6 py-6 scrollbar-gutter-stable">
        {isLoading && <p className="py-4 text-sm text-muted-foreground">{t("common.loading")}</p>}
        {isError && (
          <p className="py-4 text-sm text-destructive">
            {displayError(t, error, "task.loadFailed")}
          </p>
        )}
        {!isLoading && !isError && (tasks?.length ?? 0) === 0 && (
          <div className="rounded-lg border border-dashed border-border p-10 text-center">
            <p className="text-sm text-muted-foreground">
              {draft || activeViewId || conds.length > 0 ? t("filter.emptyResult") : t("task.emptyFilter")}
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-4"
              onClick={() => openCreate(!draft && !activeViewId && tab === "backlog" ? "backlog" : "todo")}
            >
              <Plus />
              {t("task.newTask")}
            </Button>
          </div>
        )}
        {(tasks?.length ?? 0) > 0 && (
          <TaskGroupList
            tasks={tasks!}
            state={effectiveDisplay}
            workspaceId={workspaceId!}
            onOpenTask={(id) => navigate(`/w/${workspaceId}/tasks/${id}`)}
            onNewTask={openCreate}
            onOpenProject={(id) => navigate(`/w/${workspaceId}/projects/${id}`)}
          />
        )}
      </div>

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
      {/* 列表页入口不锁定项目（任务可不归属项目），弹窗内自选；project 组头 "+" 预填锁定 */}
      <CreateTaskDialog
        open={createOpen}
        workspaceId={workspaceId!}
        project={createProject}
        defaultStatus={createStatus}
        onClose={() => setCreateOpen(false)}
      />
    </div>
  )
}
