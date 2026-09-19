// P2 视图持久化前端状态层（P2.md §1.8/§1.9/§4.2）：config 编解码 + 偏离深比较。
// 三层状态模型 currentState/view/draft 的唯一真相源是 currentState（filters 进 URL、display 纯内存）；
// view 是服务端某时刻 currentState 的快照（config 深拷贝）；编辑态再叠一层 draft。
// config 后端 opaque（jsonb 归一化键序/空白，api.md §10 注）：偏离比对必须解析后对象深比较，禁字符串比对。
//
// 本文件当前仅覆盖 projects_page 面（V2 首接面）；tasks_page / project_issues 面 display 形状不同，
// 后续切片按同构模式扩展（decode/encode/isEqual 三件套 per surface）。
import type { ViewConfig } from "@/api/types"
import {
  DEFAULT_DISPLAY,
  GROUP_FIELDS,
  ORDER_FIELDS,
  TIMEFRAMES,
  isSameDisplay,
  type ProjectDisplayState,
} from "@/lib/display-state"
import { parseConds, writeConds, type FilterCond } from "@/lib/filter-state"

/** projects_page 面 config.display 的前端形状 = ProjectDisplayState（P2.md §4.2） */
export interface ProjectViewSnapshot {
  filters: FilterCond[]
  display: ProjectDisplayState
}

/** config → 前端快照（缺字段回退默认，容错旧 config / 手改 / 空 config） */
export function decodeProjectConfig(config: ViewConfig | null | undefined): ProjectViewSnapshot {
  // 后端仅校验 config 为对象；读回时按 URL 同一白名单过滤，避免摘要/编辑器被未知字段打断。
  const candidates = Array.isArray(config?.filters) ? config.filters : []
  const valid = candidates.filter((f) =>
    f && typeof f.field === "string" && typeof f.op === "string" &&
    Array.isArray(f.values) && f.values.every((v) => typeof v === "string"),
  )
  const params = new URLSearchParams()
  writeConds(params, valid)
  return { filters: parseConds(params, "projects_page"), display: decodeProjectDisplay(config?.display) }
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

/** 偏离深比较（P2.md §1.9 / api.md §10 注）：filters 有序列表逐项 + display 逐键（visible 展开） */
export function isProjectSnapshotEqual(a: ProjectViewSnapshot, b: ProjectViewSnapshot): boolean {
  return filtersEqual(a.filters, b.filters) && isSameDisplay(a.display, b.display)
}

function filtersEqual(a: FilterCond[], b: FilterCond[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].field !== b[i].field || a[i].op !== b[i].op) return false
    if (a[i].values.length !== b[i].values.length) return false
    for (let j = 0; j < a[i].values.length; j++) {
      if (a[i].values[j] !== b[i].values[j]) return false
    }
  }
  return true
}
