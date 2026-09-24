import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { Tabs } from "radix-ui"
import { PanelRight } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { ProjectRef, TaskRow, TaskStatus, View } from "@/api/types"
import { displayError } from "@/lib/errors"
import { cn } from "@/lib/utils"
import { resolveListEmptyState } from "@/lib/list-empty-state"
import { ApiError } from "@/api/client"
import { encodeConds, parseConds, writeConds, type FilterCond } from "@/lib/filter-state"
import { isSameTaskDisplay, newTaskDisplay, type TaskDisplayState } from "@/lib/task-display-state"
import { decodeTaskConfig, encodeTaskConfig, remainingViewFilters, type TaskViewSnapshot } from "@/lib/view-state"
import { buildViewTaskStats, displayedTaskRows, selectViewTaskRows } from "@/lib/views-task-stats"
import { useWorkspaces } from "@/hooks/useWorkspaces"
import { useWorkspaceTasks } from "@/hooks/useTasks"
import { useCreateView, useDeleteView, useUpdateView, useView } from "@/hooks/useViews"
import { PageHeader } from "@/components/layout/PageHeader"
import { Breadcrumb } from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/dialog"
import { RoundIconButton } from "@/components/ui/round-icon-button"
import { ViewEditPanel } from "@/components/view/ViewEditPanel"
import { ListEmptyState } from "@/components/view/ListEmptyState"
import { FilterButton } from "@/components/filter/filter-menu"
import { FilterChipRow } from "@/components/filter/filter-chips"
import { TaskDisplayButton } from "@/components/display/task-display-menu"
import { CreateTaskDialog } from "@/components/task/CreateTaskDialog"
import { TaskGroupList } from "@/components/task/TaskGroupList"
import { ViewActions, ViewDetailsSidebar } from "./ViewDetailsSidebar"
import { notifyViewsSession, useViewsSession, type ViewsSession, type ViewBrowseState, type WorkspaceViewDraft } from "./ViewsLayout"

type Mode = "browse" | "new" | "edit"
type Panel = "filter" | "display" | "chips-filter"
const EMPTY_TASKS: TaskRow[] = []
const emptyDraft = (): WorkspaceViewDraft => ({ name: "", description: "", filters: [], display: newTaskDisplay() })
const browseFrom = (snapshot: TaskViewSnapshot): ViewBrowseState => ({
  filters: [], display: snapshot.display, sidebarOpen: true, dimension: "assignee", selection: null,
})

/** 单条视图先验证归属与类型，再挂载取任务的内容；错误 ID 绝不退化成全量任务查询。 */
export function ViewDetailPage({ mode = "browse" }: { mode?: Mode }) {
  const { workspaceId, viewId } = useParams<{ workspaceId: string; viewId: string }>()
  const { t } = useTranslation()
  const query = useView(workspaceId, mode === "new" ? undefined : viewId)
  const { data: workspaces } = useWorkspaces()
  const workspaceName = workspaces?.find((w) => w.id === workspaceId)?.name ?? t("common.workspaceFallback")
  const view = query.data
  const valid = !!view && view.workspaceId === workspaceId && view.surface === "views_page" && view.entityType === "task"
  if (mode === "new" || (valid && !query.isError)) {
    return <ViewContent key={`${workspaceId}:${mode}:${viewId ?? "new"}`} workspaceId={workspaceId!}
      workspaceName={workspaceName} view={mode === "new" ? null : view!} mode={mode} />
  }
  return (
    <div className="flex h-full flex-col">
      <PageHeader title={<Breadcrumb items={[
        { label: workspaceName, to: `/w/${workspaceId}/home` },
        { label: t("nav.views"), to: `/w/${workspaceId}/views` },
      ]} />} />
      <div className="flex flex-col items-start gap-3 px-6 py-8">
        <p role={query.isPending ? "status" : "alert"} className="text-sm text-muted-foreground">
          {query.isPending ? t("common.loading") : query.isError && !(query.error instanceof ApiError && query.error.status === 404)
            ? displayError(t, query.error, "viewsPage.loadFailed") : t("viewsPage.notFound")}
        </p>
        {query.isError && <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>{t("viewsPage.retry")}</Button>}
      </div>
    </div>
  )
}

function ViewContent({ workspaceId, workspaceName, view, mode }: {
  workspaceId: string; workspaceName: string; view: View | null; mode: Mode
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const session = useViewsSession()
  const [params, setParams] = useSearchParams()
  const id = view?.id ?? "new"
  const root = `/w/${workspaceId}/views`
  const editor = mode !== "browse"
  const saved = useMemo(() => decodeTaskConfig(view?.config), [view?.config])
  const commit = session.commits[id] ?? 0
  const [browseState, setBrowseState] = useState(() => {
    const initial = structuredClone(session.browses[id] ?? browseFrom(saved))
    initial.filters = parseConds(params, "tasks_page")
    return { value: initial, commit }
  })
  // 提交通知到达的新实例立即采用交接快照，不能先用旧临时层渲染一次重复 AND。
  const browse = !editor && commit !== browseState.commit ? session.browses[id] ?? browseState.value : browseState.value
  const [creation] = useState<NonNullable<ViewsSession["creation"]>>(() => session.creation ?? { draft: emptyDraft() })
  const savedDraft = useMemo(() => ({ name: view?.name ?? "", description: view?.description ?? "", ...saved }), [view?.name, view?.description, saved])
  const [draftState, setDraftState] = useState(() => ({
    value: structuredClone(mode === "new" ? creation.draft : session.drafts[id] ?? savedDraft), commit,
  }))
  const draft = mode === "edit" && commit !== draftState.commit ? session.drafts[id] ?? savedDraft : draftState.value
  const [editSource, setEditSource] = useState(() => structuredClone(session.editSources[id] ?? browse))
  const [openPanel, setOpenPanel] = useState<Panel | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const createView = useCreateView(workspaceId)
  const updateView = useUpdateView(workspaceId)
  const deleteView = useDeleteView(workspaceId)
  const busy = createView.isPending || updateView.isPending || deleteView.isPending || !!session.pending[id]
  const alive = useRef(false)
  const lastSearch = useRef(params.toString())
  const browseRef = useRef(browse)
  browseRef.current = browse
  const sidebarRef = useRef<HTMLDivElement>(null)
  const sidebarToggleRef = useRef<HTMLButtonElement>(null)

  useLayoutEffect(() => {
    const sidebar = sidebarRef.current
    if (!sidebar) return
    // visibility 退出延迟只负责视觉；先移出焦点，再立即禁用交互和可访问树。
    if (!browse.sidebarOpen && sidebar.contains(document.activeElement)) {
      sidebarToggleRef.current?.focus({ preventScroll: true })
    }
    sidebar.inert = !browse.sidebarOpen
    sidebar.setAttribute("aria-hidden", String(!browse.sidebarOpen))
  }, [editor, browse.sidebarOpen])

  useEffect(() => {
    alive.current = true
    if (mode === "new") session.creation = creation
    return () => {
      alive.current = false
      if (mode === "browse" && session.browses[id]) {
        session.browses[id] = { ...session.browses[id], selection: null }
      }
    }
  }, [session, creation, id, mode])

  // 目录链接及取消入口显式携带会话条件；浏览器历史始终按 URL 还原临时层。
  useEffect(() => {
    if (!editor) session.browses[id] = browseRef.current
  }, [editor, id, session])
  useEffect(() => {
    const nextSearch = params.toString()
    if (editor || commit !== browseState.commit || lastSearch.current === nextSearch) return
    lastSearch.current = nextSearch
    const next = { ...browseRef.current, filters: parseConds(params, "tasks_page"), selection: null }
    session.browses[id] = next
    setBrowseState({ value: next, commit })
    setOpenPanel(null)
  }, [params, editor, session, id, commit, browseState.commit])
  useEffect(() => {
    if (editor || browseState.commit === commit) return
    const next = session.browses[id]
    if (!next) return
    // 版本与本地快照一起提交，避免 ref 已更新而 state 尚未生效的交错渲染。
    setBrowseState({ value: next, commit })
    setOpenPanel(null)
    const sp = new URLSearchParams(params)
    writeConds(sp, next.filters)
    // 路由更新尚未提交时仍认旧 URL 已消费，避免它把刚吸收的条件写回本地状态。
    lastSearch.current = params.toString()
    setParams(sp, { replace: true })
  }, [commit, browseState.commit, editor, session, id, params, setParams])
  useEffect(() => {
    if (mode !== "edit" || draftState.commit === commit) return
    setDraftState({ value: structuredClone(session.drafts[id] ?? savedDraft), commit })
    setEditSource(structuredClone(session.browses[id] ?? browseFrom(savedDraft)))
    setOpenPanel(null)
  }, [commit, draftState.commit, mode, session, id, savedDraft])
  useEffect(() => {
    if (mode !== "new" || !creation.resultId) return
    navigate(`${root}/${creation.resultId}`, { replace: true })
  }, [mode, creation.resultId, root, navigate])

  const changeBrowse = (next: ViewBrowseState, writeUrl = false) => {
    session.browses[id] = next
    browseRef.current = next
    setBrowseState({ value: next, commit })
    if (writeUrl) {
      const sp = new URLSearchParams(params)
      writeConds(sp, next.filters)
      lastSearch.current = sp.toString()
      setParams(sp, { replace: true })
    }
  }
  const changeDraft = (next: WorkspaceViewDraft) => {
    if (busy) return
    setDraftState({ value: next, commit })
    if (mode === "new") creation.draft = next
    else session.drafts[id] = next
  }
  const panelControl = (panel: Panel) => ({
    open: openPanel === panel,
    onOpenChange: (open: boolean) => setOpenPanel((current) => open ? panel : current === panel ? null : current),
  })
  const changeFilters = (filters: FilterCond[]) => {
    if (busy) return
    if (editor) changeDraft({ ...draft, filters })
    else changeBrowse({ ...browse, filters, selection: null }, true)
  }
  const changeDisplay = (display: TaskDisplayState) => {
    if (busy) return
    if (editor) changeDraft({ ...draft, display })
    else changeBrowse({ ...browse, display, selection: null })
  }
  const browseBaseFilters = session.pending[id]?.baseFilters ?? saved.filters
  const browseFilters = useMemo(() => [...browseBaseFilters, ...browse.filters], [browseBaseFilters, browse.filters])
  const effectiveFilters = editor ? draft.filters : browseFilters
  const effectiveDisplay = editor ? draft.display : browse.display
  const f = useMemo(() => encodeConds(effectiveFilters), [effectiveFilters])
  const savedF = useMemo(() => encodeConds(saved.filters), [saved.filters])
  const query = useWorkspaceTasks(workspaceId, f)
  const baselineQuery = useWorkspaceTasks(workspaceId, savedF, !editor && browse.filters.length > 0)
  const tasks = query.data ?? EMPTY_TASKS
  const displayRows = useMemo(() => displayedTaskRows(tasks, effectiveDisplay), [tasks, effectiveDisplay])
  const selection = editor ? null : browse.selection
  const selectedRows = useMemo(() => selectViewTaskRows(displayRows, selection), [displayRows, selection])
  const matchIds = useMemo(() => selection ? new Set(selectedRows.map((r) => r.id)) : undefined, [selection, selectedRows])
  const buckets = useMemo(() => buildViewTaskStats(displayRows, browse.dimension), [displayRows, browse.dimension])
  const displayChanged = !isSameTaskDisplay(browse.display, saved.display)
  const baselineTasks = editor ? undefined : browse.filters.length > 0
    ? baselineQuery.isSuccess ? baselineQuery.data : undefined : selection ? tasks : undefined
  const rawCount = useMemo(() => new Set(tasks.map((task) => task.id)).size, [tasks])
  const emptyBaseline = useMemo(() => {
    // 组头继续使用原基准；空态仅接受稳定成功的数据，未知不能用空数组伪造零。
    if (editor || browse.filters.length === 0 || busy || !baselineQuery.isSuccess || baselineQuery.isFetching
      || baselineQuery.data === undefined) return undefined
    return {
      rawCount: new Set(baselineQuery.data.map((task) => task.id)).size,
      visibleCount: displayedTaskRows(baselineQuery.data, effectiveDisplay).length,
    }
  }, [editor, browse.filters.length, busy, baselineQuery.isSuccess, baselineQuery.isFetching, baselineQuery.data, effectiveDisplay])
  const listLoading = query.isPending || (query.isFetching && selectedRows.length === 0)
  const emptyState = query.isSuccess && !listLoading ? resolveListEmptyState({
    editor, savedView: !!view, hasTemporaryFilters: !editor && browse.filters.length > 0,
    rawCount, visibleCount: displayRows.length, selectedCount: selectedRows.length, baseline: emptyBaseline,
  }) : null

  const urlFor = (viewId: string, state: ViewBrowseState) => {
    const sp = new URLSearchParams()
    writeConds(sp, state.filters)
    return `${root}/${viewId}${sp.size ? `?${sp}` : ""}`
  }
  const restore = (viewId: string, state: ViewBrowseState) => {
    session.browses[viewId] = structuredClone(state)
    navigate(urlFor(viewId, state), { replace: true })
  }
  const startEdit = () => {
    if (!view || busy) return
    session.editSources[id] = structuredClone(browse)
    changeBrowse({ ...browse, selection: null })
    const sp = new URLSearchParams()
    writeConds(sp, browse.filters)
    navigate(`${root}/${id}/edit${sp.size ? `?${sp}` : ""}`)
  }
  const startNew = () => {
    if (busy || session.pending.new) return
    session.creation = {
      draft: { name: "", description: "", ...decodeTaskConfig(encodeTaskConfig(browseFilters, browse.display)) },
      source: { viewId: id, browse: structuredClone(browse) },
    }
    changeBrowse({ ...browse, selection: null })
    navigate(`${root}/new`)
  }
  const cancel = () => {
    if (busy) return
    if (mode === "new") {
      if (session.creation === creation) session.creation = null
      if (creation.source) restore(creation.source.viewId, creation.source.browse)
      else navigate(`${root}?tab=tasks`, { replace: true })
    } else {
      delete session.drafts[id]
      delete session.editSources[id]
      restore(id, editSource)
    }
  }
  const saveDraft = () => {
    if (!draft.name.trim() || busy) return
    setOpenPanel(null)
    setError(null)
    const submittedLocation = session.locationKey
    const submittedDraft = session.drafts[id]
    const submittedSource = session.editSources[id]
    session.pending[id] = {}
    notifyViewsSession(session)
    const input = { name: draft.name.trim(), description: draft.description.trim(), config: encodeTaskConfig(draft.filters, draft.display) }
    const onSuccess = (result: View) => {
      if (session.drafts[id] === submittedDraft) delete session.drafts[id]
      if (session.editSources[id] === submittedSource) delete session.editSources[id]
      if (mode === "new") {
        creation.resultId = result.id
        if (session.creation === creation) session.creation = null
      }
      const snapshot = decodeTaskConfig(result.config)
      const resume = session.browses[id] ?? editSource
      const next = mode === "new" ? browseFrom(snapshot) : { ...resume, display: snapshot.display, selection: null }
      session.browses[result.id] = next
      delete session.pending[id]
      notifyViewsSession(session, result.id)
      if (mode !== "new" && alive.current && session.locationKey === submittedLocation) navigate(urlFor(result.id, next), { replace: true })
    }
    const onError = (err: unknown) => {
      delete session.pending[id]
      notifyViewsSession(session)
      if (alive.current) setError(displayError(t, err, "common.saveFailed"))
    }
    // Promise 回调在子路由卸载后仍清理目标会话；导航另受当前路由保护。
    const request = mode === "new"
      ? createView.mutateAsync({ ...input, surface: "views_page", entityType: "task" })
      : updateView.mutateAsync({ viewId: id, input })
    void request.then(onSuccess, onError)
  }
  const saveCurrent = () => {
    if (!view || busy) return
    setOpenPanel(null)
    setError(null)
    const snapshot = decodeTaskConfig(encodeTaskConfig(browseFilters, browse.display))
    const submittedDraft = session.drafts[id]
    const submittedSource = session.editSources[id]
    session.pending[id] = { baseFilters: saved.filters }
    changeBrowse({ ...browse, selection: null })
    notifyViewsSession(session)
    void updateView.mutateAsync({ viewId: id, input: { config: encodeTaskConfig(snapshot.filters, snapshot.display) } }).then(
      (result) => {
        if (session.drafts[id] === submittedDraft) delete session.drafts[id]
        if (session.editSources[id] === submittedSource) delete session.editSources[id]
        const current = session.browses[id] ?? browse
        session.browses[id] = {
          ...current,
          filters: remainingViewFilters(current.filters, browse.filters),
          display: isSameTaskDisplay(current.display, browse.display) ? decodeTaskConfig(result.config).display : current.display,
          selection: null,
        }
        delete session.pending[id]
        notifyViewsSession(session, id)
      },
      (err) => {
        delete session.pending[id]
        notifyViewsSession(session)
        if (!alive.current) return
        setError(displayError(t, err, "common.saveFailed"))
      },
    )
  }
  const confirmDelete = () => {
    if (!view || busy) return
    const submittedLocation = session.locationKey
    session.pending[id] = {}
    notifyViewsSession(session)
    void deleteView.mutateAsync(id).then(
      () => {
        delete session.browses[id]
        delete session.drafts[id]
        delete session.editSources[id]
        delete session.pending[id]
        notifyViewsSession(session)
        if (session.active && session.locationKey === submittedLocation) navigate(`${root}?tab=tasks`, { replace: true })
      },
      (err) => {
        delete session.pending[id]
        notifyViewsSession(session)
        if (!alive.current) return
        setDeleting(false)
        setError(displayError(t, err, "view.deleteFailed"))
      },
    )
  }
  const resetBrowse = () => {
    if (busy) return
    changeBrowse({ ...browse, filters: [], display: structuredClone(saved.display), selection: null }, true)
    setOpenPanel(null)
  }
  const [createTask, setCreateTask] = useState<{ status: TaskStatus; project?: ProjectRef } | null>(null)
  const title = editor ? draft.name || (mode === "new" ? t("view.newView") : view!.name) : view!.name

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <PageHeader title={<Breadcrumb items={[
        { label: workspaceName, to: `/w/${workspaceId}/home` },
        { label: t("nav.views"), to: `${root}?tab=tasks` }, { label: title },
      ]} />}
        tabs={!editor && <span className="text-sm text-muted-foreground" aria-live="polite">
          {query.isError ? "—" : listLoading ? t("common.loading") : t("viewsPage.tasksCount", { count: selectedRows.length })}
        </span>}
        actions={!editor && <fieldset disabled={busy} className="flex items-center gap-1">
          <FilterButton {...panelControl("filter")} workspaceId={workspaceId} surface="tasks_page" conds={browse.filters}
            onChange={changeFilters} showIndicator={false} />
          <TaskDisplayButton {...panelControl("display")} state={browse.display} resetTarget={saved.display}
            onChange={changeDisplay} showCompletedRow />
          {!browse.sidebarOpen && <ViewActions disabled={busy} onEdit={startEdit} onDelete={() => setDeleting(true)} />}
          <RoundIconButton ref={sidebarToggleRef} label={t(browse.sidebarOpen ? "viewsPage.hideSidebar" : "viewsPage.showSidebar")}
            aria-controls={`view-details-${id}`} aria-expanded={browse.sidebarOpen}
            aria-pressed={browse.sidebarOpen} onClick={() => changeBrowse({ ...browse, sidebarOpen: !browse.sidebarOpen, selection: null })}>
            <PanelRight className="size-4" />
          </RoundIconButton>
        </fieldset>} />
      {error && <p role="alert" className="mx-6 mb-2 text-sm text-destructive">{error}</p>}
      {editor ? <ViewEditPanel mode={mode} name={draft.name} description={draft.description} workspaceId={workspaceId}
        workspaceLabel={workspaceName} surface="tasks_page" filters={draft.filters} saving={busy}
        typeTabs={<Tabs.Root value="task"><Tabs.List aria-label={t("nav.views")} className="flex items-center gap-1">
          <Tabs.Trigger value="task" className="rounded-full bg-secondary px-3 py-1.5 text-xs font-medium">{t("viewsPage.typeTasks")}</Tabs.Trigger>
          <Tabs.Trigger value="project" disabled title={t("viewsPage.comingSoon")} className="rounded-full px-3 py-1.5 text-xs text-muted-foreground opacity-50">{t("viewsPage.typeProjects")}</Tabs.Trigger>
        </Tabs.List></Tabs.Root>}
        filterControl={panelControl("filter")}
        displayButton={<TaskDisplayButton {...panelControl("display")} state={draft.display} onChange={changeDisplay}
          resetTarget={mode === "new" ? null : saved.display} showCompletedRow />}
        onNameChange={(name) => changeDraft({ ...draft, name })}
        onDescriptionChange={(description) => changeDraft({ ...draft, description })}
        onFiltersChange={changeFilters} onSave={saveDraft} onCancel={cancel}
        onReset={mode === "edit" ? () => { changeDraft({ name: view!.name, description: view!.description, ...structuredClone(saved) }); setOpenPanel(null) } : undefined}
      /> : (browse.filters.length > 0 || displayChanged) && <FilterChipRow workspaceId={workspaceId} surface="tasks_page"
        conds={browse.filters} onChange={changeFilters} activeView={view} disabled={busy}
        label={t("view.temporaryChanges")} emptyHint={displayChanged ? t("view.displayModified") : undefined}
        filterControl={panelControl("chips-filter")} onReset={resetBrowse} onSaveToView={saveCurrent} onCreateNewView={startNew} />}
      <div className="flex min-h-0 flex-1 px-6">
        <div className="min-h-0 min-w-0 flex-1 overflow-auto pb-6 pt-2 scrollbar-gutter-stable">
          {query.isError ? <p role="alert" className="py-4 text-sm text-destructive">{displayError(t, query.error, "task.loadFailed")}</p>
            : listLoading ? <p role="status" className="py-4 text-sm text-muted-foreground">{t("common.loading")}</p>
              : emptyState ? <ListEmptyState state={emptyState} entity="task" disabled={busy}
                onEditFilters={startEdit} onAdjustFilters={() => setOpenPanel("filter")}
                onClearTemporary={() => changeFilters([])} onAdjustDisplay={() => setOpenPanel("display")}
                onClearSelection={() => changeBrowse({ ...browse, selection: null })} />
                : <TaskGroupList tasks={tasks} state={effectiveDisplay} workspaceId={workspaceId}
                matchIds={matchIds} baselineTasks={baselineTasks}
                onOpenTask={(taskId) => navigate(`/w/${workspaceId}/tasks/${taskId}`)}
                onOpenProject={(projectId) => navigate(`/w/${workspaceId}/projects/${projectId}`)}
                onNewTask={(status, project) => setCreateTask({ status, project })} />}
        </div>
        {!editor && view && <div ref={sidebarRef} id={`view-details-${id}`}
          className={cn("shrink-0 overflow-hidden transition-[width,visibility] duration-200 ease-out motion-reduce:transition-none",
            browse.sidebarOpen ? "w-[21rem] xl:w-[25rem]" : "invisible w-0 pointer-events-none")}>
          <div className="h-full w-[21rem] pl-4 xl:w-[25rem]">
            <ViewDetailsSidebar view={view} workspaceName={workspaceName} active={browse.sidebarOpen}
              onInactiveFocus={() => sidebarToggleRef.current?.focus({ preventScroll: true })}
              dimension={browse.dimension} selection={browse.selection} buckets={buckets} loading={query.isPending} failed={query.isError}
              onDimension={(dimension) => changeBrowse({ ...browse, dimension, selection: null })}
              onSelection={(selection) => changeBrowse({ ...browse, selection })}
              onEdit={startEdit} onDelete={() => setDeleting(true)} disabled={busy} />
          </div>
        </div>}
      </div>
      <ConfirmDialog open={deleting} title={t("view.deleteTitle", { name: view?.name ?? "" })}
        description={t("view.deleteDescription")} confirmText={t("view.delete")} destructive pending={deleteView.isPending}
        onConfirm={confirmDelete} onClose={() => { if (!deleteView.isPending) setDeleting(false) }} />
      <CreateTaskDialog open={createTask !== null} workspaceId={workspaceId} defaultStatus={createTask?.status ?? "todo"}
        project={createTask?.project} onClose={() => setCreateTask(null)} />
    </div>
  )
}
