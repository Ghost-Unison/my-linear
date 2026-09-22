// P2 视图持久化前端状态层（P2.md §1.8/§1.9/§4.2）：config 编解码 + display 反序列化容错。
// 三层状态：saved（服务端 config）/ transient（每 tab 浏览 filters/display，URL f= 仅临时条件）/ draft（每 View 暂存编辑）。
// 浏览取数 = saved.filters AND transient，编辑预览仅用 draft；两种会话缓存互不覆盖，卸载清空，刷新按保存值/URL 初始化。
// config 后端 opaque（jsonb 归一化键序/空白，api.md §10 注）：偏离比对必须解析后对象深比较，禁字符串比对（页面侧用 isSameDisplay 完成）。
//
// 三个页面级 surface 共用过滤条件解码；projects_page 使用项目 display，
// tasks_page / project_issues 共用任务 display，filters 按各自 surface 白名单解码。
import type { ViewConfig } from "@/api/types"
import {
  DEFAULT_DISPLAY,
  GROUP_FIELDS,
  ORDER_FIELDS,
  TIMEFRAMES,
  type ProjectDisplayState,
} from "@/lib/display-state"
import { parseConds, writeConds, type FilterCond, type Surface } from "@/lib/filter-state"
import {
  DEFAULT_TASK_DISPLAY,
  TASK_GROUP_FIELDS,
  TASK_ORDER_FIELDS,
  newTaskDisplay,
  type TaskDisplayState,
} from "@/lib/task-display-state"

/** projects_page 面 config.display 的前端形状 = ProjectDisplayState（P2.md §4.2） */
export interface ProjectViewSnapshot {
  filters: FilterCond[]
  display: ProjectDisplayState
}

/** tasks_page / project_issues 面 config.display 的前端形状 = TaskDisplayState */
export interface TaskViewSnapshot {
  filters: FilterCond[]
  display: TaskDisplayState
}

/** config.filters → 条件列表（按列表面白名单过滤，返回独立快照） */
export function decodeViewFilters(
  config: ViewConfig | null | undefined,
  surface: Surface,
): FilterCond[] {
  // 后端仅校验 config 为对象；读回时按 URL 同一白名单过滤，避免摘要/编辑器被未知字段打断。
  const candidates = Array.isArray(config?.filters) ? config.filters : []
  const valid = candidates.filter((f) =>
    f && typeof f.field === "string" && typeof f.op === "string" &&
    Array.isArray(f.values) && f.values.every((v) => typeof v === "string"),
  )
  const params = new URLSearchParams()
  writeConds(params, valid)
  return parseConds(params, surface)
}

/** config → 前端快照（缺字段回退默认，容错旧 config / 手改 / 空 config） */
export function decodeProjectConfig(config: ViewConfig | null | undefined): ProjectViewSnapshot {
  return { filters: decodeViewFilters(config, "projects_page"), display: decodeProjectDisplay(config?.display) }
}

/** 任务 config → 前端快照（与任务 URL 过滤白名单一致） */
export function decodeTaskConfig(
  config: ViewConfig | null | undefined,
  surface: "tasks_page" | "project_issues" = "tasks_page",
): TaskViewSnapshot {
  return { filters: decodeViewFilters(config, surface), display: decodeTaskDisplay(config?.display) }
}

/** display 反序列化：与 DEFAULT_DISPLAY 合并（缺键回默认；visible 子对象深合并防旧 config 缺列） */
export function decodeProjectDisplay(raw: unknown): ProjectDisplayState {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_DISPLAY, visible: { ...DEFAULT_DISPLAY.visible } }
  const d = raw as Partial<ProjectDisplayState>
  const grouping = GROUP_FIELDS.includes(d.grouping!) ? d.grouping! : DEFAULT_DISPLAY.grouping
  const subGrouping = GROUP_FIELDS.includes(d.subGrouping!) ? d.subGrouping! : "none"
  const visible = { ...DEFAULT_DISPLAY.visible }
  for (const key of Object.keys(visible) as (keyof typeof visible)[]) {
    if (typeof d.visible?.[key] === "boolean") visible[key] = d.visible[key]
  }
  return {
    grouping,
    subGrouping: grouping === "none" || subGrouping === grouping ? "none" : subGrouping,
    timeframe: TIMEFRAMES.includes(d.timeframe!) ? d.timeframe! : DEFAULT_DISPLAY.timeframe,
    orderField: ORDER_FIELDS.includes(d.orderField!) ? d.orderField! : DEFAULT_DISPLAY.orderField,
    orderDir: d.orderDir === "desc" ? "desc" : "asc",
    showClosed: d.showClosed === "all" ? "all" : "none",
    showEmptyGroups: typeof d.showEmptyGroups === "boolean" ? d.showEmptyGroups : false,
    visible,
  }
}

/** 任务 display 反序列化：缺键回默认；子任务双开关独立记忆，visible 仅合并已知布尔列。 */
export function decodeTaskDisplay(raw: unknown): TaskDisplayState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return newTaskDisplay()
  const d = raw as Partial<TaskDisplayState>
  const grouping = TASK_GROUP_FIELDS.includes(d.grouping!) ? d.grouping! : DEFAULT_TASK_DISPLAY.grouping
  const subGrouping = TASK_GROUP_FIELDS.includes(d.subGrouping!) ? d.subGrouping! : DEFAULT_TASK_DISPLAY.subGrouping
  const orderField = TASK_ORDER_FIELDS.includes(d.orderField!) ? d.orderField! : DEFAULT_TASK_DISPLAY.orderField
  const visible = { ...DEFAULT_TASK_DISPLAY.visible }
  for (const key of Object.keys(visible) as (keyof typeof visible)[]) {
    if (typeof d.visible?.[key] === "boolean") visible[key] = d.visible[key]
  }
  return {
    grouping,
    subGrouping: grouping === "none" || subGrouping === grouping ? "none" : subGrouping,
    orderField,
    orderDir: orderField !== "manual" && d.orderDir === "desc" ? "desc" : "asc",
    showCompleted: d.showCompleted === "none" ? "none" : DEFAULT_TASK_DISPLAY.showCompleted,
    showSubIssues: typeof d.showSubIssues === "boolean" ? d.showSubIssues : DEFAULT_TASK_DISPLAY.showSubIssues,
    nestedSubIssues: typeof d.nestedSubIssues === "boolean" ? d.nestedSubIssues : DEFAULT_TASK_DISPLAY.nestedSubIssues,
    showEmptyGroups: typeof d.showEmptyGroups === "boolean" ? d.showEmptyGroups : DEFAULT_TASK_DISPLAY.showEmptyGroups,
    visible,
  }
}

/** 前端快照 → config（写入 view.config；深拷贝防引用共享） */
export function encodeProjectConfig(
  filters: FilterCond[],
  display: ProjectDisplayState,
): ViewConfig {
  return {
    filters: filters.map((f) => ({ field: f.field, op: f.op, values: [...f.values] })),
    display: { ...display, visible: { ...display.visible } },
  }
}

/** 任务快照 → config（条件值与列开关均深拷贝，避免保存基准被草稿改写） */
export function encodeTaskConfig(
  filters: FilterCond[],
  display: TaskDisplayState,
): ViewConfig {
  return {
    filters: filters.map((f) => ({ field: f.field, op: f.op, values: [...f.values] })),
    display: { ...display, visible: { ...display.visible } },
  }
}
