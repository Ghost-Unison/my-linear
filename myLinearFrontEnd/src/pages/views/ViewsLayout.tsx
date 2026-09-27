import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from "react"
import { Outlet, useLocation, useParams } from "react-router-dom"
import type { TaskDisplayState } from "@/lib/task-display-state"
import type { ProjectDisplayState } from "@/lib/display-state"
import type { FilterCond } from "@/lib/filter-state"
import type { ViewTaskDimension } from "@/lib/views-task-stats"
import type { ViewProjectDimension } from "@/lib/views-project-stats"
import type { ViewBrowseState, WorkspaceViewDraft, WorkspaceViewDimension } from "@/lib/workspace-view-state"

export interface ViewDirectoryDisplay {
  orderField: "name" | "createdAt" | "updatedAt"
  orderDir: "asc" | "desc"
  visible: { createdAt: boolean; updatedAt: boolean }
}

export interface ViewEntitySession<Display, Dimension extends WorkspaceViewDimension> {
  commits: Record<string, number>
  pending: Record<string, { baseFilters?: FilterCond[] } | undefined>
  browses: Record<string, ViewBrowseState<Display, Dimension>>
  drafts: Record<string, WorkspaceViewDraft<Display>>
  editSources: Record<string, ViewBrowseState<Display, Dimension>>
  creation: {
    draft: WorkspaceViewDraft<Display>
    source?: { viewId: string; browse: ViewBrowseState<Display, Dimension> }
    resultId?: string
  } | null
  directory: ViewDirectoryDisplay
}

export interface ViewsSession {
  version: number
  listeners: Set<() => void>
  subscribe: (listener: () => void) => () => void
  getVersion: () => number
  active: boolean
  locationKey: string
  task: ViewEntitySession<TaskDisplayState, ViewTaskDimension>
  project: ViewEntitySession<ProjectDisplayState, ViewProjectDimension>
  tab: "task" | "project"
}

function newEntitySession<Display, Dimension extends WorkspaceViewDimension>(): ViewEntitySession<Display, Dimension> {
  return {
    commits: {}, pending: {}, browses: {}, drafts: {}, editSources: {}, creation: null,
    directory: { orderField: "name", orderDir: "asc", visible: { createdAt: true, updatedAt: true } },
  }
}

const SessionContext = createContext<ViewsSession | null>(null)

/** 仅 Views 子路由共享内存；切工作区或离开模块即销毁，不持久化草稿。 */
export function ViewsLayout() {
  const { workspaceId } = useParams()
  return <ViewsSessionProvider key={workspaceId} />
}

function ViewsSessionProvider() {
  const location = useLocation()
  const session = useRef<ViewsSession>({
    version: 0,
    listeners: new Set(),
    subscribe: (listener) => {
      session.current.listeners.add(listener)
      return () => { session.current.listeners.delete(listener) }
    },
    getVersion: (): number => session.current.version,
    active: true,
    locationKey: location.key,
    task: newEntitySession(),
    project: newEntitySession(),
    tab: "task",
  })
  session.current.locationKey = location.key
  useEffect(() => {
    const current = session.current
    current.active = true
    return () => { current.active = false }
  }, [])
  return <SessionContext.Provider value={session.current}><Outlet /></SessionContext.Provider>
}

export function useViewsSession() {
  const session = useContext(SessionContext)
  if (!session) throw new Error("Views session is unavailable")
  useSyncExternalStore(session.subscribe, session.getVersion, session.getVersion)
  return session
}

/** 保存交接必须通知新挂载的同一视图；普通浏览修改仍由当前页面管理。 */
export function notifyViewsSession(session: ViewsSession, entity?: { commits: Record<string, number> }, committedId?: string) {
  if (entity && committedId) entity.commits[committedId] = (entity.commits[committedId] ?? 0) + 1
  session.version++
  for (const listener of session.listeners) listener()
}
