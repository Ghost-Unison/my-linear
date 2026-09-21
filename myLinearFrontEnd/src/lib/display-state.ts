// P2-B display options 状态模型与纯函数引擎（projects_page 切片先行，P2.md §3 + B 切片修订注）。
// display 纯前端内存（总决策 2）：不进 URL、切换不发请求，对已取回平铺行集做内存操作（行完备 §2.9）。
// 本文件只含纯逻辑（状态形状 / 分组 / 排序 / 列配置），UI 在 components/display/ 下。
import type { ProjectRow } from "@/api/types"
import { NONE, PROJECT_STATUSES } from "@/lib/filter-state"

/** 分组属性（none = 不分组）；值集合与 filter 同属性一致（用户定案 4） */
export type GroupField =
  | "none"
  | "lead"
  | "member"
  | "status"
  | "priority"
  | "label"
  | "startDate"
  | "targetDate"

/** 排序属性（manual = 基底序，即后端 ORDER BY created_at DESC，用户定案 6） */
export type OrderField =
  | "manual"
  | "name"
  | "status"
  | "priority"
  | "updatedAt"
  | "createdAt"
  | "startDate"
  | "targetDate"

export type OrderDir = "asc" | "desc"

/** 日期分组粒度 Timeframe（用户定案 7：一级或二级按日期分组时才展示） */
export type Timeframe = "month" | "quarter" | "half" | "year"

/** 列开关（Display properties）；Name 恒展示不进开关集合 */
export type ProjectColumn =
  | "status"
  | "priority"
  | "lead"
  | "members"
  | "labels"
  | "startDate"
  | "targetDate"
  | "createdAt"
  | "updatedAt"
  | "taskCount"

export interface ProjectDisplayState {
  grouping: GroupField
  /** 二级分组：仅一级 ≠ none 时展示/生效；一级回 none 时直接清除（用户定案 3） */
  subGrouping: GroupField
  timeframe: Timeframe
  orderField: OrderField
  orderDir: OrderDir
  /** 关闭态项目（completed/canceled）展示档位：none = 隐藏（默认）/ all = 展示（用户定案 8，二值） */
  showClosed: "none" | "all"
  showEmptyGroups: boolean
  visible: Record<ProjectColumn, boolean>
}

/** 默认态：不分组 / Manual / 不展示关闭项目 / 不展示空组；默认开列 = 现状六列（Status/Priority/Lead/Start/Target/Issues） */
export const DEFAULT_DISPLAY: ProjectDisplayState = {
  grouping: "none",
  subGrouping: "none",
  timeframe: "month",
  orderField: "manual",
  orderDir: "asc",
  showClosed: "none",
  showEmptyGroups: false,
  visible: {
    status: true,
    priority: true,
    lead: true,
    members: false,
    labels: false,
    startDate: true,
    targetDate: true,
    createdAt: false,
    updatedAt: false,
    taskCount: true,
  },
}

/** 两个 display 状态是否等价（Reset 行显隐 / view 偏离判定复用，P2.md §1.9）；
 *  orderDir 在 manual 下无意义，但仍逐键比较（manual 下 setter 复位 asc，不影响等价性） */
export function isSameDisplay(a: ProjectDisplayState, b: ProjectDisplayState): boolean {
  if (
    a.grouping !== b.grouping ||
    a.subGrouping !== b.subGrouping ||
    a.timeframe !== b.timeframe ||
    a.orderField !== b.orderField ||
    a.orderDir !== b.orderDir ||
    a.showClosed !== b.showClosed ||
    a.showEmptyGroups !== b.showEmptyGroups
  )
    return false
  return (Object.keys(DEFAULT_DISPLAY.visible) as ProjectColumn[]).every(
    (k) => a.visible[k] === b.visible[k],
  )
}

/** 分组菜单顺序（Linear 同位：No grouping / Lead / Member / Status / Priority / Label / Start / Target） */
export const GROUP_FIELDS: GroupField[] = [
  "none",
  "lead",
  "member",
  "status",
  "priority",
  "label",
  "startDate",
  "targetDate",
]

/** Ordering 菜单顺序（用户定案 6） */
export const ORDER_FIELDS: OrderField[] = [
  "manual",
  "name",
  "status",
  "priority",
  "updatedAt",
  "createdAt",
  "startDate",
  "targetDate",
]

export const TIMEFRAMES: Timeframe[] = ["month", "quarter", "half", "year"]

export const isDateGroup = (f: GroupField): boolean => f === "startDate" || f === "targetDate"

/** Timeframe 行展示条件：一级或二级任一按日期分组（用户定案 7） */
export const needsTimeframe = (s: ProjectDisplayState): boolean =>
  isDateGroup(s.grouping) || isDateGroup(s.subGrouping)

/** 分组/空组展开依赖异步值集的属性（members / labels 清单顺序 = 组序） */
export const needsMembers = (s: ProjectDisplayState): boolean =>
  [s.grouping, s.subGrouping].some((f) => f === "lead" || f === "member")
export const needsLabels = (s: ProjectDisplayState): boolean =>
  [s.grouping, s.subGrouping].includes("label")

// ---- 基底作用域与排序 ----

/** 关闭态状态（用户定案 8）；showClosed=none 时前端渲染层隐藏，filter 已取回也不展示（基底 AND 语义） */
export const CLOSED_STATUSES = ["completed", "canceled"] as const

export const applyShowClosed = (rows: ProjectRow[], showClosed: "none" | "all"): ProjectRow[] =>
  showClosed === "all"
    ? rows
    : rows.filter((r) => r.status !== "completed" && r.status !== "canceled")

const STATUS_RANK: Record<string, number> = {
  backlog: 0,
  planned: 1,
  in_progress: 2,
  completed: 3,
  canceled: 4,
}
// 业务序 Urgent → High → Medium → Low → No priority（与组序同，P2.md §3.1）
const PRIORITY_RANK: Record<string, number> = { "1": 0, "2": 1, "3": 2, "4": 3, "0": 4 }

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** Ordering 引擎：稳定排序（同值保持基底序）；日期空值恒最后（不随方向翻转）；manual = 基底序原样 */
export function sortRows(rows: ProjectRow[], field: OrderField, dir: OrderDir): ProjectRow[] {
  if (field === "manual") return rows
  const sign = dir === "asc" ? 1 : -1
  if (field === "startDate" || field === "targetDate") {
    const dateOf = (r: ProjectRow): string | null =>
      field === "startDate" ? r.startDate : r.targetDate
    const withDate = rows.filter((r) => dateOf(r) !== null)
    const without = rows.filter((r) => dateOf(r) === null)
    withDate.sort((a, b) => sign * cmpStr(dateOf(a)!, dateOf(b)!))
    return [...withDate, ...without]
  }
  const cmp = (a: ProjectRow, b: ProjectRow): number => {
    switch (field) {
      case "name":
        return cmpStr(a.name, b.name)
      case "status":
        return STATUS_RANK[a.status] - STATUS_RANK[b.status]
      case "priority":
        return PRIORITY_RANK[String(a.priority)] - PRIORITY_RANK[String(b.priority)]
      case "createdAt":
        return cmpStr(a.createdAt, b.createdAt)
      default: // updatedAt
        return cmpStr(a.updatedAt, b.updatedAt)
    }
  }
  const out = [...rows]
  out.sort((a, b) => sign * cmp(a, b))
  return out
}

// ---- 分组引擎 ----

/** 日期桶 key（字典序 = 时间序：月补零 / Q1-4 / H1-2 / 年）；空日期返 null → NONE 哨兵组 */
export function dateBucket(date: string | null, tf: Timeframe): string | null {
  if (!date) return null
  const y = date.slice(0, 4)
  const m = Number(date.slice(5, 7))
  switch (tf) {
    case "month":
      return `${y}-${date.slice(5, 7)}`
    case "quarter":
      return `${y}-Q${Math.ceil(m / 3)}`
    case "half":
      return `${y}-H${m <= 6 ? 1 : 2}`
    default:
      return y
  }
}

/** 分组值集上下文：members/labels 清单顺序即组序（实体按值集序，P2.md §3.1）；日期桶按行内数据推导 */
export interface GroupContext {
  timeframe: Timeframe
  memberIds: string[]
  labelIds: string[]
}

/** 属性全值集（组序）：枚举业务序 / 实体值集序 / 日期仅命中桶按时间序；NoX 哨兵恒最后（status 无哨兵）。
 *  日期空桶永不生成——show empty groups 对日期只影响 No date 组（用户定案 9） */
export function groupAllValues(field: GroupField, rows: ProjectRow[], ctx: GroupContext): string[] {
  switch (field) {
    case "status":
      return [...PROJECT_STATUSES]
    case "priority":
      return ["1", "2", "3", "4", "0"]
    case "lead":
    case "member":
      return [...ctx.memberIds, NONE]
    case "label":
      return [...ctx.labelIds, NONE]
    case "startDate":
    case "targetDate": {
      const buckets = new Set<string>()
      for (const r of rows) {
        const b = dateBucket(field === "startDate" ? r.startDate : r.targetDate, ctx.timeframe)
        if (b) buckets.add(b)
      }
      return [...buckets].sort((a, b) => cmpStr(a, b)).concat(NONE)
    }
    default:
      return []
  }
}

/** 行归属值（多值属性返回多个 = 重复入组语义；空值归 NONE 哨兵组） */
export function rowGroupValues(row: ProjectRow, field: GroupField, tf: Timeframe): string[] {
  switch (field) {
    case "status":
      return [row.status]
    case "priority":
      return [String(row.priority)]
    case "lead":
      return [row.lead ? row.lead.id : NONE]
    case "member":
      return row.members.length > 0 ? row.members.map((m) => m.id) : [NONE]
    case "label":
      return row.labels.length > 0 ? row.labels.map((l) => l.id) : [NONE]
    case "startDate":
      return [dateBucket(row.startDate, tf) ?? NONE]
    case "targetDate":
      return [dateBucket(row.targetDate, tf) ?? NONE]
    default:
      return []
  }
}

/** 分组节点：一级（children = 二级组）或二级（叶子）。count = rows 出现次数（多值含跨组重复） */
export interface GroupNode {
  field: GroupField
  /** wire 值（NONE 哨兵 / 枚举 / id / 日期桶 key） */
  value: string
  /** 直挂本节点的行（叶子节点渲染用；一级带二级时行挂在二级叶子下） */
  rows: ProjectRow[]
  children: GroupNode[]
}

function groupOneLevel(
  rows: ProjectRow[],
  field: GroupField,
  showEmpty: boolean,
  ctx: GroupContext,
): GroupNode[] {
  const byValue = new Map<string, ProjectRow[]>()
  for (const row of rows)
    for (const v of rowGroupValues(row, field, ctx.timeframe)) {
      const list = byValue.get(v)
      if (list) list.push(row)
      else byValue.set(v, [row])
    }
  const nodes: GroupNode[] = []
  for (const v of groupAllValues(field, rows, ctx)) {
    const list = byValue.get(v)
    // show empty groups 关 = 仅有值组；开 = 全值集组（空组计数 0）
    if (!list && !showEmpty) continue
    nodes.push({ field, value: v, rows: list ?? [], children: [] })
  }
  return nodes
}

/** 两级分组引擎：一级组序 = 全值集序；二级在各一级组内按 sub 属性重分组（同规则，值集全局） */
export function buildGroups(
  rows: ProjectRow[],
  state: ProjectDisplayState,
  ctx: GroupContext,
): GroupNode[] {
  if (state.grouping === "none") return []
  const level1 = groupOneLevel(rows, state.grouping, state.showEmptyGroups, ctx)
  if (state.subGrouping === "none") return level1
  for (const g of level1) g.children = groupOneLevel(g.rows, state.subGrouping, state.showEmptyGroups, ctx)
  return level1
}

// ---- 列配置（Display properties / 表头 / 行网格单源）----

export interface ColumnDef {
  key: ProjectColumn
  labelKey: string
  width: string
  /** 可排序列对应的 ordering 字段（表头点击 = 写 ordering 状态） */
  orderField?: OrderField
  alignRight?: boolean
}

/** 列固定顺序（Linear 同位）；宽度定宽，Name 列弹性 */
export const COLUMNS: ColumnDef[] = [
  { key: "status", labelKey: "common.status", width: "9rem", orderField: "status" },
  { key: "priority", labelKey: "common.priority", width: "9rem", orderField: "priority" },
  { key: "lead", labelKey: "project.lead", width: "11rem" },
  { key: "members", labelKey: "project.members", width: "10rem" },
  { key: "labels", labelKey: "common.labels", width: "14rem" },
  { key: "startDate", labelKey: "project.startDate", width: "8rem", orderField: "startDate" },
  { key: "targetDate", labelKey: "project.targetDate", width: "8rem", orderField: "targetDate" },
  { key: "createdAt", labelKey: "filter.createdAt", width: "8rem", orderField: "createdAt" },
  { key: "updatedAt", labelKey: "filter.updatedAt", width: "8rem", orderField: "updatedAt" },
  { key: "taskCount", labelKey: "nav.tasks", width: "4rem", alignRight: true },
]

export const visibleColumns = (s: ProjectDisplayState): ColumnDef[] =>
  COLUMNS.filter((c) => s.visible[c.key])

/** 行/表头共用网格模板（inline style 消费）：Name 弹性 + 可见列定宽。
 *  列集合是运行时状态，Tailwind JIT 编译不到动态拼接的 arbitrary class，故走 style 而非 className */
export const gridTemplateCols = (cols: ColumnDef[]): string =>
  `minmax(0, 1fr) ${cols.map((c) => c.width).join(" ")}`

/** 横向滚动保底宽（rem，inline style 消费）：Name 保底 12rem + 可见列定宽合计 + gap（1rem × 列间距数） */
export const tableMinRem = (cols: ColumnDef[]): number =>
  cols.reduce((sum, c) => sum + parseFloat(c.width), 12) + cols.length

/** Ordering → Display properties 联动（用户定案 6）：排序属性自动勾选对应列（name/manual 无对应列） */
export const orderFieldColumn = (f: OrderField): ProjectColumn | undefined =>
  f === "manual" || f === "name" ? undefined : f

// ---- 菜单文案键 ----

const FIELD_LABEL_KEYS: Record<string, string> = {
  status: "common.status",
  priority: "common.priority",
  lead: "project.lead",
  member: "project.members",
  label: "common.labels",
  startDate: "project.startDate",
  targetDate: "project.targetDate",
  name: "common.name",
  createdAt: "filter.createdAt",
  updatedAt: "filter.updatedAt",
}

export const groupFieldLabelKey = (f: GroupField): string =>
  f === "none" ? "display.noGrouping" : FIELD_LABEL_KEYS[f]

export const orderFieldLabelKey = (f: OrderField): string =>
  f === "manual" ? "display.manual" : FIELD_LABEL_KEYS[f]

export const timeframeLabelKey = (tf: Timeframe): string => `display.timeframe.${tf}`
