import type { ProjectRow, TaskRow, ViewConfig, ViewEntityType } from "@/api/types"
import { isSameDisplay, type ProjectDisplayState } from "@/lib/display-state"
import type { FilterCond } from "@/lib/filter-state"
import { isSameTaskDisplay, type TaskDisplayState } from "@/lib/task-display-state"
import { decodeProjectConfig, decodeTaskConfig, encodeProjectConfig, encodeTaskConfig } from "@/lib/view-state"
import {
  buildViewTaskStats, displayedTaskRows, selectViewTaskRows,
  type ViewTaskBucket, type ViewTaskDimension, type ViewTaskSelection,
} from "@/lib/views-task-stats"
import {
  buildViewProjectStats, displayedProjectRows, selectViewProjectRows,
  type ViewProjectDimension, type ViewProjectSelection,
} from "@/lib/views-project-stats"

export type WorkspaceViewDimension = ViewTaskDimension | ViewProjectDimension

/** 将泛型会话收窄为共享侧栏的判别联合，不以类型断言跨越实体边界。 */
export function viewSidebarSelection(
  selection: { dimension: WorkspaceViewDimension; value: string } | null,
): ViewTaskSelection | ViewProjectSelection | null {
  if (!selection) return null
  const { dimension, value } = selection
  if (dimension === "lead" || dimension === "member") return { dimension, value }
  return { dimension, value }
}

export interface WorkspaceViewSnapshot<Display> {
  filters: FilterCond[]
  display: Display
}

export interface ViewBrowseState<Display, Dimension extends WorkspaceViewDimension> extends WorkspaceViewSnapshot<Display> {
  sidebarOpen: boolean
  dimension: Dimension
  selection: { dimension: Dimension; value: string } | null
}

export interface WorkspaceViewDraft<Display> extends WorkspaceViewSnapshot<Display> {
  name: string
  description: string
}

/** 仅适配实体差异；浏览/草稿/提交生命周期由独立 Views 的同一个状态机持有。 */
export interface WorkspaceViewEntity<Display, Row, Dimension extends WorkspaceViewDimension> {
  entityType: ViewEntityType
  surface: "tasks_page" | "projects_page"
  tab: "tasks" | "projects"
  countKey: "viewsPage.tasksCount" | "viewsPage.projectsCount"
  loadErrorKey: "task.loadFailed" | "project.loadFailed"
  decode: (config: ViewConfig | null | undefined) => WorkspaceViewSnapshot<Display>
  encode: (filters: FilterCond[], display: Display) => ViewConfig
  sameDisplay: (left: Display, right: Display) => boolean
  defaultDimension: Dimension
  isDimension: (value: WorkspaceViewDimension) => value is Dimension
  emptyRows: Row[]
  displayedRows: (rows: Row[], display: Display) => Row[]
  selectRows: (rows: Row[], selection: { dimension: Dimension; value: string } | null) => Row[]
  buildStats: (rows: Row[], dimension: Dimension) => ViewTaskBucket[]
}

export const TASK_VIEW_ENTITY: WorkspaceViewEntity<TaskDisplayState, TaskRow, ViewTaskDimension> = {
  entityType: "task",
  surface: "tasks_page",
  tab: "tasks",
  countKey: "viewsPage.tasksCount",
  loadErrorKey: "task.loadFailed",
  decode: decodeTaskConfig,
  encode: encodeTaskConfig,
  sameDisplay: isSameTaskDisplay,
  defaultDimension: "assignee",
  isDimension: (value): value is ViewTaskDimension => value === "assignee" || value === "label" || value === "project",
  emptyRows: [],
  displayedRows: displayedTaskRows,
  selectRows: selectViewTaskRows,
  buildStats: buildViewTaskStats,
}

export const PROJECT_VIEW_ENTITY: WorkspaceViewEntity<ProjectDisplayState, ProjectRow, ViewProjectDimension> = {
  entityType: "project",
  surface: "projects_page",
  tab: "projects",
  countKey: "viewsPage.projectsCount",
  loadErrorKey: "project.loadFailed",
  decode: decodeProjectConfig,
  encode: encodeProjectConfig,
  sameDisplay: isSameDisplay,
  defaultDimension: "lead",
  isDimension: (value): value is ViewProjectDimension => value === "lead" || value === "member" || value === "label",
  emptyRows: [],
  displayedRows: displayedProjectRows,
  selectRows: selectViewProjectRows,
  buildStats: buildViewProjectStats,
}

export function newWorkspaceViewDraft<Display>(entity: {
  decode: (config: undefined) => WorkspaceViewSnapshot<Display>
}): WorkspaceViewDraft<Display> {
  return { name: "", description: "", ...entity.decode(undefined) }
}

export function browseFrom<Display, Dimension extends WorkspaceViewDimension>(
  snapshot: WorkspaceViewSnapshot<Display>, dimension: Dimension,
): ViewBrowseState<Display, Dimension> {
  return { filters: [], display: snapshot.display, sidebarOpen: true, dimension, selection: null }
}
