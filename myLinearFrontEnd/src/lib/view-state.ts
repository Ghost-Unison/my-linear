// P2 视图持久化前端状态层（P2.md §1.8/§1.9/§4.2）：config 编解码 + display 反序列化容错。
// 三层状态：saved（服务端 config）/ transient（每 tab 浏览 filters/display，URL f= 仅临时条件）/ draft（每 View 暂存编辑）。
// 浏览取数 = saved.filters AND transient，编辑预览仅用 draft；两种会话缓存互不覆盖，卸载清空，刷新按保存值/URL 初始化。
// config 后端 opaque（jsonb 归一化键序/空白，api.md §10 注）：偏离比对必须解析后对象深比较，禁字符串比对（页面侧用 isSameDisplay 完成）。
//
// 本文件当前仅覆盖 projects_page 面（V2 首接面）；tasks_page / project_issues 面 display 形状不同，
// 后续切片按同构模式扩展（decode/encode/isEqual 三件套 per surface）。
import type { ViewConfig } from "@/api/types"
import {
  DEFAULT_DISPLAY,
  GROUP_FIELDS,
  ORDER_FIELDS,
  TIMEFRAMES,
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
