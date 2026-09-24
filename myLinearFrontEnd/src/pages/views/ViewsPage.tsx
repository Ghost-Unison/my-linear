import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { Tabs } from "radix-ui"
import { ArrowDown, ArrowUp, Layers, Plus } from "lucide-react"
import { useViews } from "@/hooks/useViews"
import { useWorkspaces } from "@/hooks/useWorkspaces"
import { newTaskDisplay } from "@/lib/task-display-state"
import { writeConds } from "@/lib/filter-state"
import { PageHeader } from "@/components/layout/PageHeader"
import { Breadcrumb } from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import {
  VIEWS_DIRECTORY_COLUMNS,
  ViewsDisplayButton,
  orderViewsDirectory,
} from "@/components/display/views-display-menu"
import { useViewsSession, type ViewDirectoryDisplay } from "./ViewsLayout"

/** 目录设置只写父级会话，不参与任何视图的 config 或任务 Display。 */
export function ViewsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const session = useViewsSession()
  const [searchParams, setSearchParams] = useSearchParams()
  const urlTab = searchParams.get("tab")
  const tab = urlTab === "tasks" ? "task" : urlTab === "projects" ? "project" : session.tab
  const [display, setDisplay] = useState(() => session.directory)
  const { data: workspaces } = useWorkspaces()
  const query = useViews(tab === "task" ? workspaceId : undefined, "views_page", undefined, "task")
  const workspaceName = workspaces?.find((workspace) => workspace.id === workspaceId)?.name ??
    t("common.workspaceFallback")

  useEffect(() => {
    session.tab = tab
    const expected = tab === "task" ? "tasks" : "projects"
    if (urlTab !== expected) {
      setSearchParams((current) => {
        const next = new URLSearchParams(current)
        next.set("tab", expected)
        return next
      }, { replace: true })
    }
  }, [session, tab, urlTab, setSearchParams])

  const changeTab = (value: string) => {
    if (value !== "task" && value !== "project") return
    session.tab = value
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.set("tab", value === "task" ? "tasks" : "projects")
      return next
    })
  }
  const changeDisplay = (next: ViewDirectoryDisplay) => {
    session.directory = next
    setDisplay(next)
  }
  const create = () => {
    if (tab !== "task" || !workspaceId || session.pending.new) return
    session.creation = { draft: { name: "", description: "", filters: [], display: newTaskDisplay() } }
    navigate(`/w/${workspaceId}/views/new`)
  }
  const viewUrl = (id: string) => {
    const sp = new URLSearchParams()
    writeConds(sp, session.browses[id]?.filters ?? [])
    return `/w/${workspaceId}/views/${id}${sp.size ? `?${sp}` : ""}`
  }
  const columns = VIEWS_DIRECTORY_COLUMNS.filter((column) =>
    column.key === "name" || column.key === display.orderField || display.visible[column.key])
  const rows = useMemo(() => {
    const result = (query.data ?? []).filter((view) =>
      view.workspaceId === workspaceId && view.surface === "views_page" && view.entityType === "task")
    const field = display.orderField
    const direction = display.orderDir === "asc" ? 1 : -1
    return result.sort((a, b) => {
      const compare = field === "name"
        ? a.name.localeCompare(b.name, i18n.language)
        : (Date.parse(a[field]) || 0) - (Date.parse(b[field]) || 0)
      return compare * direction || a.id.localeCompare(b.id)
    })
  }, [query.data, workspaceId, display.orderField, display.orderDir, i18n.language])
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(i18n.language, {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  }), [i18n.language])
  const formatDate = (value: string) => {
    const time = Date.parse(value)
    return Number.isNaN(time) ? "—" : dateFormatter.format(time)
  }

  return (
    <Tabs.Root value={tab} onValueChange={changeTab} className="flex h-full min-h-0 flex-1 flex-col">
      <PageHeader
        title={<Breadcrumb items={[
          { label: workspaceName, to: `/w/${workspaceId}/home` },
          { label: t("nav.views") },
        ]} />}
        tabs={
          <Tabs.List aria-label={t("nav.views")} className="flex items-center gap-1">
            {(["task", "project"] as const).map((value) => (
              <Tabs.Trigger
                key={value}
                value={value}
                className="rounded-full px-3 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=active]:bg-accent data-[state=active]:text-foreground"
              >
                {t(value === "task" ? "viewsPage.typeTasks" : "viewsPage.typeProjects")}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        }
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={create} disabled={tab !== "task" || !workspaceId || !!session.pending.new}>
              <Plus data-icon="inline-start" />
              {t("view.newView")}
            </Button>
            {tab === "task" && <ViewsDisplayButton state={display} onChange={changeDisplay} />}
          </>
        }
      />
      <Tabs.Content value="task" className="min-h-0 flex-1 overflow-auto outline-none">
        {query.isPending ? (
          <p role="status" className="px-6 py-10 text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : query.isError ? (
          <div role="alert" className="flex flex-col items-start gap-3 px-6 py-10">
            <p className="text-sm text-destructive">{t("viewsPage.loadFailed")}</p>
            <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>{t("viewsPage.retry")}</Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-20 text-center">
            <Layers className="size-8 text-muted-foreground" aria-hidden="true" />
            <h2 className="text-sm font-medium">{t("viewsPage.emptyTitle")}</h2>
            <p className="max-w-md text-sm text-muted-foreground">{t("viewsPage.emptyDescription")}</p>
            <Button size="sm" variant="secondary" onClick={create} disabled={!!session.pending.new}>
              <Plus data-icon="inline-start" />{t("view.newView")}
            </Button>
          </div>
        ) : (
          <table className="w-full min-w-[32rem] table-fixed border-collapse text-left text-sm" aria-label={t("nav.views")}>
            <thead className="sticky top-0 bg-background text-xs text-muted-foreground">
              <tr className="border-b border-border">
                {columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className={column.key === "name" ? "px-6 py-2 font-normal" : "w-48 px-4 py-2 font-normal"}
                    aria-sort={column.key === display.orderField ? (display.orderDir === "asc" ? "ascending" : "descending") : "none"}
                  >
                    <button
                      type="button"
                      onClick={() => changeDisplay(orderViewsDirectory(display, column.key))}
                      className="inline-flex items-center gap-1.5 rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      {t(column.labelKey)}
                      {column.key === display.orderField && (display.orderDir === "asc"
                        ? <ArrowUp className="size-3" aria-hidden="true" />
                        : <ArrowDown className="size-3" aria-hidden="true" />)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((view) => (
                <tr
                  key={view.id}
                  className="cursor-pointer border-b border-border/50 hover:bg-accent/40"
                  onClick={(event) => {
                    if (!(event.target as HTMLElement).closest("a")) navigate(viewUrl(view.id))
                  }}
                >
                  <td className="px-6 py-3">
                    <Link to={viewUrl(view.id)} className="flex min-w-0 items-center gap-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                      <Layers className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate font-medium" title={view.name}>{view.name}</span>
                        <span className="truncate text-xs text-muted-foreground" title={view.description}>
                          {view.description || t("viewsPage.noDescription")}
                        </span>
                      </span>
                    </Link>
                  </td>
                  {columns.filter((column) => column.key !== "name").map((column) => (
                    <td key={column.key} className="px-4 py-3 text-xs text-muted-foreground">
                      <time dateTime={view[column.key]}>{formatDate(view[column.key])}</time>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Tabs.Content>
      <Tabs.Content value="project" className="min-h-0 flex-1 overflow-auto px-6 py-20 text-center text-sm text-muted-foreground outline-none">
        {t("viewsPage.comingSoon")}
      </Tabs.Content>
    </Tabs.Root>
  )
}
