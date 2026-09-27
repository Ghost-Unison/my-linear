import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { Plus } from "lucide-react"
import type { View } from "@/api/types"
import { useProjects } from "@/hooks/useProjects"
import { useWorkspaces } from "@/hooks/useWorkspaces"
import { useCreateView, useDeleteView, useUpdateView, useViews } from "@/hooks/useViews"
import { displayError } from "@/lib/errors"
import { resolveListEmptyState } from "@/lib/list-empty-state"
import { encodeConds, parseConds, writeConds, type FilterCond } from "@/lib/filter-state"
import { applyShowClosed, isSameDisplay, type ProjectDisplayState } from "@/lib/display-state"
import {
  decodeProjectConfig,
  encodeProjectConfig,
  type ProjectViewSnapshot,
} from "@/lib/view-state"
import { Breadcrumb } from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/dialog"
import { PageHeader } from "@/components/layout/PageHeader"
import { FilterButton } from "@/components/filter/filter-menu"
import { FilterChipRow } from "@/components/filter/filter-chips"
import { DisplayButton } from "@/components/display/display-menu"
import { ViewTabs } from "@/components/view/ViewTabs"
import { ViewEditPanel } from "@/components/view/ViewEditPanel"
import { ListEmptyState } from "@/components/view/ListEmptyState"
import { ProjectViewList } from "@/components/project/ProjectViewList"
import { CreateProjectDialog, type CreateProjectInitial } from "@/components/project/CreateProjectDialog"

/** 当前编辑沙箱（P2.md §1.9）：已有 View 草稿按 id 暂存；新建草稿仅随当前 panel 存活。 */
interface ViewDraft {
  mode: "new" | "edit"
  viewId?: string
  name: string
  description: string
  filters: FilterCond[]
  display: ProjectDisplayState
}

type ViewPanel = "filter" | "display" | "chips-filter"
const PRESET_TAB = "all"
const EMPTY_FILTERS: FilterCond[] = []

// /w/:workspaceId/projects → 项目列表（P0.md §2：行只读，点击进详情页；不做行内编辑）
// P2-B：display options 接通——filter 决定取数（进 URL），display 纯内存（总决策 2）：
// 基底管线 = showClosed 作用域 → ordering 排序 → 两级分组；表头/行网格由可见列配置单源驱动
export function ProjectListPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  // 工作区切换时清空本页面的 tab 会话，防止草稿和 display 跨工作区串用。
  return <ProjectListContent key={workspaceId} workspaceId={workspaceId!} />
}

function ProjectListContent({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  // 浏览 URL 的 f= 仅承载临时条件；view= 指向保存的基底，取数时才合成 AND。
  const conds = useMemo(() => parseConds(searchParams, "projects_page"), [searchParams])
  const [draft, setActiveDraft] = useState<ViewDraft | null>(null)
  // 暂存草稿不驱动浏览展示；统一在编辑写入时缓存，切 tab（含历史导航）只关闭 panel。
  const editDrafts = useRef<Record<string, ViewDraft>>({})
  const setDraft = (next: ViewDraft) => {
    if (next.mode === "edit" && next.viewId) editDrafts.current[next.viewId] = next
    setActiveDraft(next)
  }
  const { data: workspaces } = useWorkspaces()
  const [createOpen, setCreateOpen] = useState(false)
  // ⑤ 分组头 “+” 预填：undefined = 页头 New project（全默认）
  const [createInitial, setCreateInitial] = useState<CreateProjectInitial | undefined>(undefined)
  const openCreate = (initial?: CreateProjectInitial) => {
    setCreateInitial(initial)
    setCreateOpen(true)
  }
  const workspaceName =
    workspaces?.find((w) => w.id === workspaceId)?.name ?? t("common.workspaceFallback")
  const viewQuery = useViews(workspaceId, "projects_page")
  const views = viewQuery.data
  const createView = useCreateView(workspaceId)
  const updateView = useUpdateView(workspaceId)
  const deleteView = useDeleteView(workspaceId)
  const busy = createView.isPending || updateView.isPending || deleteView.isPending
  const [viewError, setViewError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<View | null>(null)
  const activeViewId = searchParams.get("view")
  const tabKey = activeViewId ?? PRESET_TAB
  const activeView = views?.find((v) => v.id === activeViewId) ?? null
  const saved = useMemo(() => decodeProjectConfig(activeView?.config), [activeView])
  // 每个 tab 保存自己的 transient filters/display；保存的 view.config 从不被自动修改。
  const [tabs, setTabs] = useState<Record<string, ProjectViewSnapshot>>({})
  // 保存基底缓存与 URL 临时层的更新并非原子操作；提交期间固定取数快照，直到两层完成交接。
  const [absorbing, setAbsorbing] = useState<{
    viewId: string
    filters: FilterCond[]
    settled: boolean
  } | null>(null)
  const display = tabs[tabKey]?.display ?? saved.display
  const viewReady = !activeViewId || !!activeView
  // 浏览与编辑期仅挂载一组 Filter/Display，共用浮层标识；临时条的添加菜单仍独立互斥。
  const [openPanel, setOpenPanel] = useState<ViewPanel | null>(null)
  const panelControl = (id: ViewPanel) => ({
    open: openPanel === id,
    onOpenChange: (open: boolean) => setOpenPanel((current) =>
      open ? id : current === id ? null : current),
  })
  // 防止请求完成时把用户拉回已经离开的编辑会话。
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
  const fParams = useMemo(() => encodeConds(effectiveConds), [effectiveConds])
  const { data: projects, isPending, isSuccess, isFetching, isError, error } = useProjects(workspaceId, fParams, viewReady)
  const displayChanged = !isSameDisplay(display, saved.display)
  const deviatedViewIds = useMemo(() => new Set((views ?? []).filter((view) => {
    const state = view.id === activeViewId ? { filters: conds, display } : tabs[view.id]
    return state && (state.filters.length > 0 ||
      !isSameDisplay(state.display, decodeProjectConfig(view.config).display))
  }).map((view) => view.id)), [views, activeViewId, tabs, conds, display])

  const writeLocation = (id: string | null, filters: FilterCond[], replace = true) => {
    const sp = new URLSearchParams(searchParams)
    if (id) sp.set("view", id)
    else sp.delete("view")
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
  const setEffectiveDisplay = (next: ProjectDisplayState) => {
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
  const activateTab = (id: string | null) => {
    closeEditor()
    const key = id ?? PRESET_TAB
    selectedTab.current = key
    const filters = key === tabKey ? conds : tabs[key]?.filters ?? EMPTY_FILTERS
    writeLocation(id, filters, false)
  }
  const activatePreset = () => activateTab(null)
  const activateView = (id: string) => activateTab(id)
  const startNewView = (fromCurrent = false) => {
    if (busy || !viewQuery.isSuccess || !viewReady) return
    // 继承点击前生效的 Display；已有 View 草稿留在缓存，新建草稿可替换，普通 "+" 不带 filters。
    const snapshot = decodeProjectConfig(encodeProjectConfig(fromCurrent ? browseFilters : [], effectiveDisplay))
    closeEditor()
    setDraft({ mode: "new", name: "", description: "", ...snapshot })
  }
  const editView = (id: string) => {
    const view = views?.find((v) => v.id === id)
    if (!view || busy) return
    activateTab(id)
    setDraft(editDrafts.current[id] ?? {
      mode: "edit", viewId: id, name: view.name, description: view.description,
      ...decodeProjectConfig(view.config),
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
    const snapshot = decodeProjectConfig(view.config)
    setDraft({ ...draft, name: view.name, description: view.description, ...snapshot })
    setOpenPanel(null)
  }
  const saveDraft = () => {
    if (!draft || !draft.name.trim() || busy) return
    const version = transition.current
    // 每次提交读取本次浏览临时层，避免恢复的旧草稿携带过时的浏览条件。
    const resumeFilters = draft.mode === "edit" ? conds : EMPTY_FILTERS
    setOpenPanel(null)
    setViewError(null)
    const input = { name: draft.name.trim(), description: draft.description.trim(),
      config: encodeProjectConfig(draft.filters, draft.display) }
    const onSuccess = (view: View) => {
      // 即使提交期间已切 tab，保存成功也要清掉该 View 的暂存草稿。
      delete editDrafts.current[view.id]
      const next = { filters: resumeFilters, display: decodeProjectConfig(view.config).display }
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
      createView.mutate({ ...input, surface: "projects_page", entityType: "project" }, { onSuccess, onError })
    }
  }
  const saveToThisView = () => {
    if (!activeView || busy) return
    const id = activeView.id
    const version = transition.current
    setOpenPanel(null)
    setViewError(null)
    setAbsorbing({ viewId: id, filters: browseFilters, settled: false })
    updateView.mutate({ viewId: id, input: { config: encodeProjectConfig(browseFilters, display) } }, {
      onSuccess: (view) => {
        delete editDrafts.current[id]
        // 已吸收的临时条件转入保存基底，必须清空临时层，防止重复 AND。
        setTabs((old) => ({ ...old, [id]: { filters: [], display: decodeProjectConfig(view.config).display } }))
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
        if (selectedTab.current === id) activatePreset()
      },
      onError: (err) => {
        setDeleting(null)
        setViewError(displayError(t, err, "view.deleteFailed"))
      },
    })
  }

  // 基底管线：showClosed（基底 AND：filter 取回但关闭态前端隐藏）→ ordering → 分组
  const baseRows = useMemo(
    () => applyShowClosed(projects ?? [], effectiveDisplay.showClosed),
    [projects, effectiveDisplay.showClosed],
  )
  const visibleCount = useMemo(() => new Set(baseRows.map((row) => row.id)).size, [baseRows])
  const listLoading = isPending || (isFetching && visibleCount === 0)
  // 仅浏览临时筛选后的展示为空时查询保存基底；Display 与当前展示一致，计数不累加分组。
  const baselineParams = useMemo(() => encodeConds(saved.filters), [saved.filters])
  const needsBaseline = !draft && viewReady && !viewQuery.isError && conds.length > 0 &&
    isSuccess && !isFetching && visibleCount === 0 && !busy && !absorbing
  const baselineQuery = useProjects(workspaceId, baselineParams, needsBaseline)
  const baseline = useMemo(() => {
    // 未成功、刷新中或保存交接期间不将缺失基底当作 0；空态先使用无数字的泛化提示。
    if (!needsBaseline || !baselineQuery.isSuccess || baselineQuery.isFetching || !baselineQuery.data) return undefined
    return {
      rawCount: new Set(baselineQuery.data.map((row) => row.id)).size,
      visibleCount: new Set(applyShowClosed(baselineQuery.data, effectiveDisplay.showClosed).map((row) => row.id)).size,
    }
  }, [needsBaseline, baselineQuery.isSuccess, baselineQuery.isFetching, baselineQuery.data, effectiveDisplay.showClosed])
  const emptyState = viewReady && !viewQuery.isError && isSuccess && !listLoading
    ? resolveListEmptyState({
        editor: !!draft,
        savedView: !!activeView,
        hasTemporaryFilters: !draft && conds.length > 0,
        rawCount: new Set((projects ?? []).map((row) => row.id)).size,
        visibleCount,
        baseline,
      })
    : null

  return (
    <div className="flex h-full flex-col">
      {/* 页头：预设/view tab 与 New project 始终保留；新建/编辑视图时 Filter/Display 仅在 panel 中展示。 */}
      <PageHeader
        title={
          <Breadcrumb
            items={[
              { label: workspaceName, to: `/w/${workspaceId}/home` },
              { label: t("nav.projects") },
            ]}
          />
        }
        tabs={
          <ViewTabs
            workspaceId={workspaceId}
            busy={busy || !viewQuery.isSuccess || !viewReady}
            onEditView={editView}
            onDeleteView={requestDeleteView}
            presets={[{ key: PRESET_TAB, label: t("project.allProjects"), active: true, onSelect: activatePreset }]}
            views={views ?? []}
            activeViewId={activeViewId}
            editing={draft ? { mode: draft.mode, viewId: draft.viewId, name: draft.name } : null}
            deviatedViewIds={deviatedViewIds}
            onSelectView={activateView}
            onNewView={() => startNewView()}
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
                  surface="projects_page"
                  conds={conds}
                  onChange={setEffectiveConds}
                />
                <DisplayButton
                  {...panelControl("display")}
                  state={display}
                  onChange={setEffectiveDisplay}
                  resetTarget={saved.display}
                />
              </fieldset>
            )}
            <Button variant="ghost" size="sm" onClick={() => openCreate()}>
              <Plus />
              {t("project.newProject")}
            </Button>
          </>
        }
      />

      {/* 新建/编辑期 = 行内 panel（条件与 Filter/Display 入口只落 panel，预览仅用 draft）；
          浏览期 = 临时条（有临时条件或 display 改动时渲染，view 激活时 Save 升级分裂下拉，§1.9） */}
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
          workspaceId={workspaceId!}
          surface="projects_page"
          filters={draft.filters}
          displayButton={
            <DisplayButton
              {...panelControl("display")}
              state={draft.display}
              onChange={setEffectiveDisplay}
              resetTarget={draft.mode === "new" ? null : saved.display}
            />
          }
          saving={busy}
          filterControl={panelControl("filter")}
          onNameChange={(v) => setDraft({ ...draft, name: v })}
          onDescriptionChange={(v) => setDraft({ ...draft, description: v })}
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
            surface="projects_page"
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

      <div className="flex-1 min-h-0 px-6" hidden={!viewReady}>
        {/* 横向滚动容器 = 撑满到视口底的 h-full 层：列溢出时横向滚动条贴在右侧内容区（视口）
            底部而非表格底部（对齐 Linear）；min-w 撑开 grid 防 Name 列被压成 0 宽，pb-6 留底部呼吸 */}
        <div className="h-full overflow-auto">
          <ProjectViewList
            projects={projects ?? []}
            state={effectiveDisplay}
            workspaceId={workspaceId}
            onChange={setEffectiveDisplay}
            onOpenProject={(id) => navigate(`/w/${workspaceId}/projects/${id}`)}
            onNewProject={openCreate}
            content={viewReady && !viewQuery.isError && isSuccess && !listLoading && !emptyState &&
              baseRows.length > 0 ? undefined : (
              <>
                {!viewQuery.isError && !isError && listLoading && (
                  <p className="py-4 text-sm text-muted-foreground">{t("common.loading")}</p>
                )}
                {isError && (
                  <p role="alert" className="py-4 text-sm text-destructive">
                    {displayError(t, error, "errors.loadFailed")}
                  </p>
                )}
                {/* 原始结果为空或关闭态全隐藏均由页面解释，仅基础空态提供创建入口。 */}
                {emptyState && (
                  <ListEmptyState
                    state={emptyState}
                    entity="project"
                    disabled={busy || !!absorbing}
                    onCreate={() => openCreate()}
                    onEditFilters={activeView && !draft ? () => {
                      if (busy || absorbing) return
                      editView(activeView.id)
                      setOpenPanel("filter")
                    } : undefined}
                    onAdjustFilters={() => setOpenPanel("filter")}
                    onClearTemporary={() => { if (!draft && !busy && !absorbing) setConds([]) }}
                    onAdjustDisplay={() => setOpenPanel("display")}
                  />
                )}
              </>
            )}
          />
        </div>
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
      <CreateProjectDialog
        open={createOpen}
        workspaceId={workspaceId!}
        initial={createInitial}
        onClose={() => setCreateOpen(false)}
      />
    </div>
  )
}
