import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from "react"
import { Outlet, useLocation, useParams } from "react-router-dom"
import type { TaskViewSnapshot } from "@/lib/view-state"
import type { FilterCond } from "@/lib/filter-state"
import type { ViewTaskSelection, ViewTaskDimension } from "@/lib/views-task-stats"

export interface ViewBrowseState extends TaskViewSnapshot {
  sidebarOpen: boolean
  dimension: ViewTaskDimension
  selection: ViewTaskSelection | null
}

export interface WorkspaceViewDraft extends TaskViewSnapshot {
  name: string
  description: string
}

export interface ViewDirectoryDisplay {
  orderField: "name" | "createdAt" | "updatedAt"
  orderDir: "asc" | "desc"
  visible: { createdAt: boolean; updatedAt: boolean }
}

export interface ViewsSession {
  version: number
  listeners: Set<() => void>
  subscribe: (listener: () => void) => () => void
  getVersion: () => number
  commits: Record<string, number>
  pending: Record<string, { baseFilters?: FilterCond[] } | undefined>
  active: boolean
  locationKey: string
  browses: Record<string, ViewBrowseState>
  drafts: Record<string, WorkspaceViewDraft>
  editSources: Record<string, ViewBrowseState>
  creation: { draft: WorkspaceViewDraft; source?: { viewId: string; browse: ViewBrowseState }; resultId?: string } | null
  directory: ViewDirectoryDisplay
  tab: "task" | "project"
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
    commits: {}, pending: {},
    active: true,
    locationKey: location.key,
    browses: {}, drafts: {}, editSources: {}, creation: null,
    directory: { orderField: "name", orderDir: "asc", visible: { createdAt: true, updatedAt: true } },
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
export function notifyViewsSession(session: ViewsSession, committedId?: string) {
  if (committedId) session.commits[committedId] = (session.commits[committedId] ?? 0) + 1
  session.version++
  for (const listener of session.listeners) listener()
}
