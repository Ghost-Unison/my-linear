import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react"
import type { UseQueryResult } from "@tanstack/react-query"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { Tabs } from "radix-ui"
import { PanelRight } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { ProjectRef, ProjectRow, TaskRow, TaskStatus, View } from "@/api/types"
import { displayError } from "@/lib/errors"
import { cn } from "@/lib/utils"
import { resolveListEmptyState } from "@/lib/list-empty-state"
import { ApiError } from "@/api/client"
import { encodeConds, parseConds, writeConds, type FilterCond } from "@/lib/filter-state"
import type { TaskDisplayState } from "@/lib/task-display-state"
import type { ProjectDisplayState } from "@/lib/display-state"
import { remainingViewFilters } from "@/lib/view-state"
import {
  browseFrom, newWorkspaceViewDraft, PROJECT_VIEW_ENTITY, TASK_VIEW_ENTITY,
  type ViewBrowseState, type WorkspaceViewDraft, type WorkspaceViewEntity, type WorkspaceViewDimension,
} from "@/lib/workspace-view-state"
import { useWorkspaces } from "@/hooks/useWorkspaces"
import { useWorkspaceTasks } from "@/hooks/useTasks"
import { useProjects } from "@/hooks/useProjects"
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
import { DisplayButton } from "@/components/display/display-menu"
import { CreateProjectDialog, type CreateProjectInitial } from "@/components/project/CreateProjectDialog"
import { ProjectViewList } from "@/components/project/ProjectViewList"
import { CreateTaskDialog } from "@/components/task/CreateTaskDialog"
import { TaskGroupList } from "@/components/task/TaskGroupList"
import { ViewActions, ViewDetailsSidebar } from "./ViewDetailsSidebar"
import { notifyViewsSession, useViewsSession, type ViewEntitySession } from "./ViewsLayout"

type Mode = "browse" | "new" | "edit"
type Panel = "filter" | "display" | "chips-filter"
interface EntityDisplayProps<Display> {
  state: Display
  resetTarget?: Display | null
  onChange: (display: Display) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface EntityListProps<Display, Row> {
  workspaceId: string
  rows: Row[]
  selectedRows: Row[]
  baselineRows?: Row[]
  matchIds?: ReadonlySet<string>
  state: Display
  onChange: (display: Display) => void
  content?: ReactNode
  disabled: boolean
}

interface EntityRenderer<Display, Row> {
  useRows: (workspaceId: string, filters: readonly string[], enabled?: boolean) => UseQueryResult<Row[], Error>
  Display: ComponentType<EntityDisplayProps<Display>>
  List: ComponentType<EntityListProps<Display, Row>>
}

const TASK_RENDERER: EntityRenderer<TaskDisplayState, TaskRow> = {
  useRows: useWorkspaceTasks,
  Display: (props) => <TaskDisplayButton {...props} showCompletedRow />,
  List: TaskViewRows,
}
const PROJECT_RENDERER: EntityRenderer<ProjectDisplayState, ProjectRow> = {
  useRows: useProjects,
  Display: DisplayButton,
  List: ProjectViewRows,
}

/** 单条视图先验证归属与类型，再挂载取任务的内容；错误 ID 绝不退化成全量任务查询。 */
export function ViewDetailPage({ mode = "browse" }: { mode?: Mode }) {
  const { workspaceId, viewId } = useParams<{ workspaceId: string; viewId: string }>()
  const { t } = useTranslation()
  const session = useViewsSession()
  const [params] = useSearchParams()
  const query = useView(workspaceId, mode === "new" ? undefined : viewId)
  const { data: workspaces } = useWorkspaces()
  const workspaceName = workspaces?.find((w) => w.id === workspaceId)?.name ?? t("common.workspaceFallback")
  const view = query.data
  const valid = !!view && view.workspaceId === workspaceId && view.surface === "views_page" &&
    (view.entityType === "task" || view.entityType === "project")
  if (workspaceId && (mode === "new" || (valid && !query.isError))) {
    const entityType = mode === "new" ? (params.get("type") === "project" ? "project" : "task") : view!.entityType
    const props = { workspaceId, workspaceName, view: mode === "new" ? null : view!, mode }
    const key = `${workspaceId}:${mode}:${viewId ?? "new"}:${entityType}`
    return entityType === "project"
      ? <ViewContent key={key} {...props} entity={PROJECT_VIEW_ENTITY} renderer={PROJECT_RENDERER} session={session.project} />
      : <ViewContent key={key} {...props} entity={TASK_VIEW_ENTITY} renderer={TASK_RENDERER} session={session.task} />
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

function ViewContent<Display, Row extends { id: string }, Dimension extends WorkspaceViewDimension>({
  workspaceId, workspaceName, view, mode, entity, renderer, session,
}: {
  workspaceId: string; workspaceName: string; view: View | null; mode: Mode
  entity: WorkspaceViewEntity<Display, Row, Dimension>
  renderer: EntityRenderer<Display, Row>
  session: ViewEntitySession<Display, Dimension>
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const owner = useViewsSession()
  const notify = (committedId?: string) => notifyViewsSession(owner, session, committedId)
  const [params, setParams] = useSearchParams()
  const id = view?.id ?? "new"
  const root = `/w/${workspaceId}/views`
  const editor = mode !== "browse"
  const saved = useMemo(() => entity.decode(view?.config), [entity, view?.config])
  const commit = session.commits[id] ?? 0
  const [browseState, setBrowseState] = useState(() => {
    const initial = structuredClone(session.browses[id] ?? browseFrom(saved, entity.defaultDimension))
    initial.filters = parseConds(params, entity.surface)
    return { value: initial, commit }
  })
  // 提交通知到达的新实例立即采用交接快照，不能先用旧临时层渲染一次重复 AND。
  const browse = !editor && commit !== browseState.commit ? session.browses[id] ?? browseState.value : browseState.value
  const [creation] = useState<NonNullable<ViewEntitySession<Display, Dimension>["creation"]>>(
    () => session.creation ?? { draft: newWorkspaceViewDraft(entity) },
  )
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
    owner.tab = entity.entityType
    if (mode === "new") session.creation = creation
    return () => {
      alive.current = false
      if (mode === "browse" && session.browses[id]) {
        session.browses[id] = { ...session.browses[id], selection: null }
      }
    }
  }, [session, owner, entity, creation, id, mode])

  // 目录链接及取消入口显式携带会话条件；浏览器历史始终按 URL 还原临时层。
  useEffect(() => {
    if (!editor) session.browses[id] = browseRef.current
  }, [editor, id, session])
  useEffect(() => {
    const nextSearch = params.toString()
    if (editor || commit !== browseState.commit || lastSearch.current === nextSearch) return
    lastSearch.current = nextSearch
    const next = { ...browseRef.current, filters: parseConds(params, entity.surface), selection: null }
    session.browses[id] = next
    setBrowseState({ value: next, commit })
    setOpenPanel(null)
  }, [params, editor, session, entity, id, commit, browseState.commit])
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
    setEditSource(structuredClone(session.browses[id] ?? browseFrom(savedDraft, entity.defaultDimension)))
    setOpenPanel(null)
  }, [commit, draftState.commit, mode, session, entity, id, savedDraft])
  useEffect(() => {
    if (mode !== "new" || !creation.resultId) return
    navigate(`${root}/${creation.resultId}`, { replace: true })
  }, [mode, creation.resultId, root, navigate])

  const changeBrowse = (next: ViewBrowseState<Display, Dimension>, writeUrl = false) => {
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
  const changeDraft = (next: WorkspaceViewDraft<Display>) => {
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
  const changeDisplay = (display: Display) => {
    if (busy) return
    if (editor) changeDraft({ ...draft, display })
    else changeBrowse({ ...browse, display, selection: null })
  }
  const browseBaseFilters = session.pending[id]?.baseFilters ?? saved.filters
  const browseFilters = useMemo(() => [...browseBaseFilters, ...browse.filters], [browseBaseFilters, browse.filters])
  const effectiveFilters = editor ? draft.filters : browseFilters
  const effectiveDisplay = editor ? draft.display : browse.display
  const f = useMemo(() => encodeConds(effectiveFilters), [effectiveFilters])
  const savedF = useMemo(() => encodeConds(browseBaseFilters), [browseBaseFilters])
  const query = renderer.useRows(workspaceId, f)
  const baselineQuery = renderer.useRows(workspaceId, savedF, !editor && browse.filters.length > 0)
  const rows = query.data ?? entity.emptyRows
  const displayRows = useMemo(() => entity.displayedRows(rows, effectiveDisplay), [entity, rows, effectiveDisplay])
  const selection = editor ? null : browse.selection
  const selectedRows = useMemo(() => entity.selectRows(displayRows, selection), [entity, displayRows, selection])
  const matchIds = useMemo(() => selection ? new Set(selectedRows.map((r) => r.id)) : undefined, [selection, selectedRows])
  const buckets = useMemo(() => entity.buildStats(displayRows, browse.dimension), [entity, displayRows, browse.dimension])
  const displayChanged = !entity.sameDisplay(browse.display, saved.display)
  const baselineRows = editor ? undefined : browse.filters.length > 0
    ? baselineQuery.isSuccess ? baselineQuery.data : undefined : selection ? rows : undefined
  const rawCount = useMemo(() => new Set(rows.map((row) => row.id)).size, [rows])
  const emptyBaseline = useMemo(() => {
    // 组头继续使用原基准；空态仅接受稳定成功的数据，未知不能用空数组伪造零。
    if (editor || browse.filters.length === 0 || busy || !baselineQuery.isSuccess || baselineQuery.isFetching
      || baselineQuery.data === undefined) return undefined
    return {
      rawCount: new Set(baselineQuery.data.map((task) => task.id)).size,
      visibleCount: entity.displayedRows(baselineQuery.data, effectiveDisplay).length,
    }
  }, [editor, browse.filters.length, busy, baselineQuery.isSuccess, baselineQuery.isFetching, baselineQuery.data, effectiveDisplay, entity])
  const listLoading = query.isPending || (query.isFetching && selectedRows.length === 0)
  const emptyState = query.isSuccess && !listLoading ? resolveListEmptyState({
    editor, savedView: !!view, hasTemporaryFilters: !editor && browse.filters.length > 0,
    rawCount, visibleCount: displayRows.length, selectedCount: selectedRows.length, baseline: emptyBaseline,
  }) : null

  const urlFor = (viewId: string, state: ViewBrowseState<Display, Dimension>) => {
    const sp = new URLSearchParams()
    writeConds(sp, state.filters)
    return `${root}/${viewId}${sp.size ? `?${sp}` : ""}`
  }
  const restore = (viewId: string, state: ViewBrowseState<Display, Dimension>) => {
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
      draft: { name: "", description: "", ...entity.decode(entity.encode(browseFilters, browse.display)) },
      source: { viewId: id, browse: structuredClone(browse) },
    }
    changeBrowse({ ...browse, selection: null })
    navigate(`${root}/new${entity.entityType === "project" ? "?type=project" : ""}`)
  }
  const changeType = (value: string) => {
    if (mode !== "new" || busy || creation.source || (value !== "task" && value !== "project") || value === entity.entityType) return
    owner.tab = value
    // 类型切换只改变路由，下一实例从自己的会话取草稿；不携带另一实体的 URL 条件。
    navigate(`${root}/new${value === "project" ? "?type=project" : ""}`)
  }
  const cancel = () => {
    if (busy) return
    if (mode === "new") {
      if (session.creation === creation) session.creation = null
      if (creation.source) restore(creation.source.viewId, creation.source.browse)
      else navigate(`${root}?tab=${entity.tab}`, { replace: true })
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
    const submittedLocation = owner.locationKey
    const submittedDraft = session.drafts[id]
    const submittedSource = session.editSources[id]
    session.pending[id] = {}
    notify()
    const input = { name: draft.name.trim(), description: draft.description.trim(), config: entity.encode(draft.filters, draft.display) }
    const onSuccess = (result: View) => {
      if (session.drafts[id] === submittedDraft) delete session.drafts[id]
      if (session.editSources[id] === submittedSource) delete session.editSources[id]
      if (mode === "new") {
        creation.resultId = result.id
        if (session.creation === creation) session.creation = null
      }
      const snapshot = entity.decode(result.config)
      const resume = session.browses[id] ?? editSource
      const next = mode === "new" ? browseFrom(snapshot, entity.defaultDimension) : { ...resume, display: snapshot.display, selection: null }
      session.browses[result.id] = next
      delete session.pending[id]
      notify(result.id)
      if (mode !== "new" && alive.current && owner.locationKey === submittedLocation) navigate(urlFor(result.id, next), { replace: true })
    }
    const onError = (err: unknown) => {
      delete session.pending[id]
      notify()
      if (alive.current) setError(displayError(t, err, "common.saveFailed"))
    }
    // Promise 回调在子路由卸载后仍清理目标会话；导航另受当前路由保护。
    const request = mode === "new"
      ? createView.mutateAsync({ ...input, surface: "views_page", entityType: entity.entityType })
      : updateView.mutateAsync({ viewId: id, input })
    void request.then(onSuccess, onError)
  }
  const saveCurrent = () => {
    if (!view || busy) return
    setOpenPanel(null)
    setError(null)
    const snapshot = entity.decode(entity.encode(browseFilters, browse.display))
    const submittedDraft = session.drafts[id]
    const submittedSource = session.editSources[id]
    session.pending[id] = { baseFilters: saved.filters }
    changeBrowse({ ...browse, selection: null })
    notify()
    void updateView.mutateAsync({ viewId: id, input: { config: entity.encode(snapshot.filters, snapshot.display) } }).then(
      (result) => {
        if (session.drafts[id] === submittedDraft) delete session.drafts[id]
        if (session.editSources[id] === submittedSource) delete session.editSources[id]
        const current = session.browses[id] ?? browse
        session.browses[id] = {
          ...current,
          filters: remainingViewFilters(current.filters, browse.filters),
          display: entity.sameDisplay(current.display, browse.display) ? entity.decode(result.config).display : current.display,
          selection: null,
        }
        delete session.pending[id]
        notify(id)
      },
      (err) => {
        delete session.pending[id]
        notify()
        if (!alive.current) return
        setError(displayError(t, err, "common.saveFailed"))
      },
    )
  }
  const confirmDelete = () => {
    if (!view || busy) return
    const submittedLocation = owner.locationKey
    session.pending[id] = {}
    notify()
    void deleteView.mutateAsync(id).then(
      () => {
        delete session.browses[id]
        delete session.drafts[id]
        delete session.editSources[id]
        delete session.pending[id]
        notify()
        if (owner.active && owner.locationKey === submittedLocation) navigate(`${root}?tab=${entity.tab}`, { replace: true })
      },
      (err) => {
        delete session.pending[id]
        notify()
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
  const title = editor ? draft.name || (mode === "new" ? t("view.newView") : view!.name) : view!.name

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <PageHeader title={<Breadcrumb items={[
        { label: workspaceName, to: `/w/${workspaceId}/home` },
        { label: t("nav.views"), to: `${root}?tab=${entity.tab}` }, { label: title },
      ]} />}
        tabs={!editor && <span className="text-sm text-muted-foreground" aria-live="polite">
          {query.isError ? "—" : listLoading ? t("common.loading") : t(entity.countKey, { count: selectedRows.length })}
        </span>}
        actions={!editor && <fieldset disabled={busy} className="flex items-center gap-1">
          <FilterButton {...panelControl("filter")} workspaceId={workspaceId} surface={entity.surface} conds={browse.filters}
            onChange={changeFilters} showIndicator={false} />
          <renderer.Display {...panelControl("display")} state={browse.display} resetTarget={saved.display}
            onChange={changeDisplay} />
          {!browse.sidebarOpen && <ViewActions disabled={busy} onEdit={startEdit} onDelete={() => setDeleting(true)} />}
          <RoundIconButton ref={sidebarToggleRef} label={t(browse.sidebarOpen ? "viewsPage.hideSidebar" : "viewsPage.showSidebar")}
            aria-controls={`view-details-${id}`} aria-expanded={browse.sidebarOpen}
            aria-pressed={browse.sidebarOpen} onClick={() => changeBrowse({ ...browse, sidebarOpen: !browse.sidebarOpen, selection: null })}>
            <PanelRight className="size-4" />
          </RoundIconButton>
        </fieldset>} />
      {error && <p role="alert" className="mx-6 mb-2 text-sm text-destructive">{error}</p>}
      {editor ? <ViewEditPanel mode={mode} name={draft.name} description={draft.description} workspaceId={workspaceId}
        workspaceLabel={workspaceName} surface={entity.surface} filters={draft.filters} saving={busy}
        typeTabs={<Tabs.Root value={entity.entityType} onValueChange={changeType}>
          <Tabs.List aria-label={t("nav.views")} className="flex items-center gap-1">
            {(["task", "project"] as const).map((value) => <Tabs.Trigger key={value} value={value}
              disabled={busy || ((mode === "edit" || !!creation.source) && value !== entity.entityType)}
              className="rounded-full px-3 py-1.5 text-xs text-muted-foreground data-[state=active]:bg-secondary data-[state=active]:font-medium data-[state=active]:text-foreground disabled:opacity-50">
              {t(value === "task" ? "viewsPage.typeTasks" : "viewsPage.typeProjects")}
            </Tabs.Trigger>)}
          </Tabs.List>
        </Tabs.Root>}
        filterControl={panelControl("filter")}
        displayButton={<renderer.Display {...panelControl("display")} state={draft.display} onChange={changeDisplay}
          resetTarget={mode === "new" ? null : saved.display} />}
        onNameChange={(name) => changeDraft({ ...draft, name })}
        onDescriptionChange={(description) => changeDraft({ ...draft, description })}
        onFiltersChange={changeFilters} onSave={saveDraft} onCancel={cancel}
        onReset={mode === "edit" ? () => { changeDraft({ name: view!.name, description: view!.description, ...structuredClone(saved) }); setOpenPanel(null) } : undefined}
      /> : (browse.filters.length > 0 || displayChanged) && <FilterChipRow workspaceId={workspaceId} surface={entity.surface}
        conds={browse.filters} onChange={changeFilters} activeView={view} disabled={busy}
        label={t("view.temporaryChanges")} emptyHint={displayChanged ? t("view.displayModified") : undefined}
        filterControl={panelControl("chips-filter")} onReset={resetBrowse} onSaveToView={saveCurrent} onCreateNewView={startNew} />}
      <div className="flex min-h-0 flex-1 px-6">
        <div className="min-h-0 min-w-0 flex-1 overflow-auto pb-6 pt-2 scrollbar-gutter-stable">
          <renderer.List rows={rows} selectedRows={selectedRows} state={effectiveDisplay} workspaceId={workspaceId}
            matchIds={matchIds} baselineRows={baselineRows} onChange={changeDisplay} disabled={busy}
            content={query.isError ? <p role="alert" className="py-4 text-sm text-destructive">{displayError(t, query.error, entity.loadErrorKey)}</p>
              : listLoading ? <p role="status" className="py-4 text-sm text-muted-foreground">{t("common.loading")}</p>
                : emptyState ? <ListEmptyState state={emptyState} entity={entity.entityType} disabled={busy}
                  onEditFilters={startEdit} onAdjustFilters={() => setOpenPanel("filter")}
                  onClearTemporary={() => changeFilters([])} onAdjustDisplay={() => setOpenPanel("display")}
                  onClearSelection={() => changeBrowse({ ...browse, selection: null })} /> : undefined} />
        </div>
        {!editor && view && <div ref={sidebarRef} id={`view-details-${id}`}
          className={cn("shrink-0 overflow-hidden transition-[width,visibility] duration-200 ease-out motion-reduce:transition-none",
            browse.sidebarOpen ? "w-[21rem] xl:w-[25rem]" : "invisible w-0 pointer-events-none")}>
          <div className="h-full w-[21rem] pl-4 xl:w-[25rem]">
            <ViewDetailsSidebar view={view} entityType={entity.entityType} workspaceName={workspaceName} active={browse.sidebarOpen}
              onInactiveFocus={() => sidebarToggleRef.current?.focus({ preventScroll: true })}
              dimension={browse.dimension} selection={browse.selection} buckets={buckets} loading={query.isPending} failed={query.isError}
              onDimension={(dimension) => {
                if (!busy && entity.isDimension(dimension)) changeBrowse({ ...browse, dimension, selection: null })
              }}
              onSelection={(selection) => {
                if (busy) return
                if (!selection) changeBrowse({ ...browse, selection: null })
                else if (entity.isDimension(selection.dimension)) changeBrowse({
                  ...browse, selection: { dimension: selection.dimension, value: selection.value },
                })
              }}
              onEdit={startEdit} onDelete={() => setDeleting(true)} disabled={busy} />
          </div>
        </div>}
      </div>
      <ConfirmDialog open={deleting} title={t("view.deleteTitle", { name: view?.name ?? "" })}
        description={t("view.deleteDescription")} confirmText={t("view.delete")} destructive pending={deleteView.isPending}
        onConfirm={confirmDelete} onClose={() => { if (!deleteView.isPending) setDeleting(false) }} />
    </div>
  )
}

function TaskViewRows({ rows, state, workspaceId, baselineRows, matchIds, content, disabled }: EntityListProps<TaskDisplayState, TaskRow>) {
  const navigate = useNavigate()
  const [createTask, setCreateTask] = useState<{ status: TaskStatus; project?: ProjectRef } | null>(null)
  return <>
    {content !== undefined ? content : <TaskGroupList tasks={rows} state={state} workspaceId={workspaceId}
      matchIds={matchIds} baselineTasks={baselineRows}
      onOpenTask={(id) => navigate(`/w/${workspaceId}/tasks/${id}`)}
      onOpenProject={(id) => navigate(`/w/${workspaceId}/projects/${id}`)}
      onNewTask={(status, project) => { if (!disabled) setCreateTask({ status, project }) }} />}
    <CreateTaskDialog open={createTask !== null} workspaceId={workspaceId} defaultStatus={createTask?.status ?? "todo"}
      project={createTask?.project} onClose={() => setCreateTask(null)} />
  </>
}

function ProjectViewRows({ selectedRows, state, workspaceId, baselineRows, onChange, content, disabled }: EntityListProps<ProjectDisplayState, ProjectRow>) {
  const navigate = useNavigate()
  const [createProject, setCreateProject] = useState<CreateProjectInitial | null>(null)
  return <>
    <ProjectViewList projects={selectedRows} state={state} workspaceId={workspaceId} onChange={onChange}
      baselineProjects={baselineRows} content={content}
      onOpenProject={(id) => navigate(`/w/${workspaceId}/projects/${id}`)}
      onNewProject={disabled ? undefined : (initial) => setCreateProject(initial ?? {})} />
    <CreateProjectDialog open={createProject !== null} workspaceId={workspaceId}
      initial={createProject ?? undefined} onClose={() => setCreateProject(null)} />
  </>
}
