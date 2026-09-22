// P2-B display options 任务侧状态模型与纯函数引擎（tasks_page 切片先行，P2.md §3 + B 切片修订注 +
// 2026-09 任务切片修订）。与项目侧同"纯前端内存"决策（总决策 2）：不进 URL、切换不发请求，
// 对已取回平铺行集做内存操作（行完备 §2.9）。本文件只含纯逻辑，UI 在 components/display/ 与 components/task/ 下。
// 与项目侧差异（用户定案 2026-09 任务切片）：
// - 默认按 status 分组；组序拖拽（Linear Group ordering 面板）后置后续优化，本切片不渲染入口按钮；
// - Show sub-issues / Nested sub-issues 双开关取代项目侧无对应物：sub 关 = 仅一级行；sub 开 + nested 关 =
//   平铺 + "› 父标题" 面包屑；sub 开 + nested 开 = 树形（跨组值置灰）；树形渲染集 = 锚点祖先链 ∪ 锚点完整子树
//   （侧分支剪枝 + completed 链条置灰，2026-09-14 修订④，§2.6）；
// - Completed tasks（done/canceled）档位仅在 Active/Backlog 浏览态隐藏；All、自定义 View、新建/编辑均展示；
// - Order completed by recency 不实现（无完成时间字段），面板不渲染该行。
import type { TaskRow, TaskStatus } from "@/api/types"
import { NONE, TASK_STATUSES } from "@/lib/filter-state"
import type { OrderDir } from "@/lib/display-state"

/** 分组属性（none = 不分组）；值集合与 filter 同属性一致（用户定案 4） */
export type TaskGroupField = "none" | "status" | "assignee" | "project" | "priority" | "label"

/** 排序属性（manual = 基底序，即后端 ORDER BY status 枚举序 + created_at 升序，用户定案 2026-09） */
export type TaskOrderField =
  | "manual"
  | "title"
  | "status"
  | "priority"
  | "assignee"
  | "updatedAt"
  | "createdAt"
  | "dueDate"

/** 列开关（Display properties）；Title 恒展示不进开关集合。
 *  ID（Linear identifier）因后端无 number 列后置后续优化，本切片不进集合 */
export type TaskColumn =
  | "status"
  | "assignee"
  | "priority"
  | "project"
  | "dueDate"
  | "labels"
  | "createdAt"
  | "updatedAt"

export interface TaskDisplayState {
  grouping: TaskGroupField
  /** 二级分组：仅一级 ≠ none 时展示/生效；一级回 none 时直接清除（用户定案 3） */
  subGrouping: TaskGroupField
  orderField: TaskOrderField
  orderDir: OrderDir
  /** 完结态任务（done/canceled）展示档位：none = 隐藏 / all = 展示（默认）；面板行显隐由页面作用域决定 */
  showCompleted: "none" | "all"
  /** 展示子任务：关 = 仅一级任务行（父不在结果集的孤儿仍展示） */
  showSubIssues: boolean
  /** 嵌套子任务：仅 showSubIssues 开时展示/生效；开 = 树形，关 = 平铺面包屑 */
  nestedSubIssues: boolean
  showEmptyGroups: boolean
  visible: Record<TaskColumn, boolean>
}

/** 默认态（用户图1）：status 分组 / Manual / completed 全展示 / sub 与 nested 双开 / 不展示空组；
 *  默认开列 = 除 Updated 外全选 */
export const DEFAULT_TASK_DISPLAY: TaskDisplayState = {
  grouping: "status",
  subGrouping: "none",
  orderField: "manual",
  orderDir: "asc",
  showCompleted: "all",
  showSubIssues: true,
  nestedSubIssues: true,
  showEmptyGroups: false,
  visible: {
    status: true,
    assignee: true,
    priority: true,
    project: true,
    dueDate: true,
    labels: true,
    createdAt: true,
    updatedAt: false,
  },
}

/** 新实例工厂（每 tab 一份状态：visible 子对象须独立，避免跨 tab 改写串味） */
export const newTaskDisplay = (): TaskDisplayState => ({
  ...DEFAULT_TASK_DISPLAY,
  visible: { ...DEFAULT_TASK_DISPLAY.visible },
})

/** 两个任务 display 状态是否等价（Reset 行显隐 / view 偏离判定复用）；所有字段与列开关逐键比较。 */
export function isSameTaskDisplay(a: TaskDisplayState, b: TaskDisplayState): boolean {
  if (
    a.grouping !== b.grouping ||
    a.subGrouping !== b.subGrouping ||
    a.orderField !== b.orderField ||
    a.orderDir !== b.orderDir ||
    a.showCompleted !== b.showCompleted ||
    a.showSubIssues !== b.showSubIssues ||
    a.nestedSubIssues !== b.nestedSubIssues ||
    a.showEmptyGroups !== b.showEmptyGroups
  )
    return false
  return (Object.keys(DEFAULT_TASK_DISPLAY.visible) as TaskColumn[]).every(
    (k) => a.visible[k] === b.visible[k],
  )
}

/** 分组菜单顺序（Linear 同位：No grouping / Status / Assignee / Project / Priority / Label） */
export const TASK_GROUP_FIELDS: TaskGroupField[] = [
  "none",
  "status",
  "assignee",
  "project",
  "priority",
  "label",
]

/** Ordering 菜单顺序（用户定案 2026-09：Manual + Title/Status/Priority/Assignee/Updated/Created/Due date） */
export const TASK_ORDER_FIELDS: TaskOrderField[] = [
  "manual",
  "title",
  "status",
  "priority",
  "assignee",
  "updatedAt",
  "createdAt",
  "dueDate",
]

/** 完结态（用户定案 4：对任务而言 Done 与 Canceled 都算 completed）；showCompleted=none 时渲染层隐藏 */
export const COMPLETED_STATUSES: readonly TaskStatus[] = ["done", "canceled"]

export const isTaskCompleted = (r: TaskRow): boolean => COMPLETED_STATUSES.includes(r.status)

export const applyShowCompleted = (
  rows: TaskRow[],
  showCompleted: "none" | "all",
): TaskRow[] => (showCompleted === "all" ? rows : rows.filter((r) => !isTaskCompleted(r)))

/** 规则B 后代可见谓词：completed=none 时已完成后代自身隐藏（不阻断下探）；all 时全部可见 */
export const taskChildVisible =
  (showCompleted: "none" | "all") =>
  (r: TaskRow): boolean =>
    showCompleted === "all" || !isTaskCompleted(r)

/** 树索引（parentOf：id→parentId，根为 ""；childrenOf：parentId→直接子行，基底序）。
 *  分组引擎与渲染器共享，避免逐组重复重建父子映射 */
export interface TaskTreeIndex {
  parentOf: Map<string, string>
  childrenOf: Map<string, TaskRow[]>
}

export function buildTaskTreeIndex(base: TaskRow[]): TaskTreeIndex {
  const parentOf = new Map(base.map((r) => [r.id, r.parentId ?? ""]))
  const childrenOf = new Map<string, TaskRow[]>()
  for (const r of base) {
    if (!r.parentId) continue
    const list = childrenOf.get(r.parentId)
    if (list) list.push(r)
    else childrenOf.set(r.parentId, [r])
  }
  return { parentOf, childrenOf }
}

/** 展示行集：showSubIssues 关 = 仅一级（父不在结果集的孤儿视为一级，避免行凭空消失）；开 = 全量 */
export function taskDisplayRows(rows: TaskRow[], showSub: boolean): TaskRow[] {
  if (showSub) return rows
  const inSet = new Set(rows.map((r) => r.id))
  return rows.filter((r) => !r.parentId || !inSet.has(r.parentId))
}

/** tree 模式渲染集（Linear 规则④，2026-09-14 用户 Linear 验证定稿）：kept = 锚点祖先链 ∪ 锚点完整子树。
 *  规则A：子树含锚点的节点渲染（锚点本身 + 祖先链条节点，非锚点置灰）；
 *  规则B：锚点子树内任意深度后代即使非锚点也渲染置灰（sub2-2-1 / task8-1 例，子树展开权仅属锚点）；
 *  链条节点旁侧分支（子树无锚点 ∉ 任何锚点子树）整体剪枝（sub2 / task3 / gRPC 例）；
 *  completed=none：已完成任务不作锚点，仅经规则A 链条进入 kept（task1 例）；锚点子树内已完成后代
 *  自身不渲染但不阻断向下展开（task4 例）；孤儿链止于孤儿（父不在结果集） */
export function taskSpanKeptSet(
  idx: TaskTreeIndex,
  anchorIds: ReadonlySet<string>,
  childVisible: (r: TaskRow) => boolean,
): Set<string> {
  const kept = new Set<string>()
  // 已完整上溯过链条的节点（其全部祖先必已入 kept），命中才可终止。不能以 kept.has 判——
  // 经规则B 先入 kept 的内层锚点（外层锚点先处理、中间已完成节点因 completed=none 未入 kept）
  // 会跳过链条补全，导致断链（中间灰节点丢失、内层锚点被误提根）
  const chained = new Set<string>()
  for (const id of anchorIds) {
    let cur = id
    while (cur !== "" && idx.parentOf.has(cur)) {
      if (chained.has(cur)) break
      chained.add(cur)
      kept.add(cur)
      cur = idx.parentOf.get(cur) ?? ""
    }
    // 规则B：锚点整棵子树 DFS；completed=none 时已完成后代自身不入 kept（除非已作链条进入），
    // 但仍继续向下展开（其下可能有活跃后代/其它锚点）
    const stack = [...(idx.childrenOf.get(id) ?? [])]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (childVisible(n)) kept.add(n.id)
      for (const c of idx.childrenOf.get(n.id) ?? []) stack.push(c)
    }
  }
  return kept
}

/** kept 集的树根 = 父不在 kept 的 kept 节点（含真一级 + 孤儿提根，孤儿仍置灰） */
export function taskKeptRoots(base: TaskRow[], kept: ReadonlySet<string>): TaskRow[] {
  return base.filter((r) => kept.has(r.id) && (!r.parentId || !kept.has(r.parentId)))
}

// ---- 排序引擎 ----

// 业务序 Urgent → High → Medium → Low → No priority（与组序同，P2.md §3.1）
const PRIORITY_RANK: Record<string, number> = { "1": 0, "2": 1, "3": 2, "4": 3, "0": 4 }
const STATUS_RANK: Record<string, number> = Object.fromEntries(
  TASK_STATUSES.map((s, i) => [s, i]),
)

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** Ordering 引擎：稳定排序（同值保持基底序）；dueDate 空值恒最后（不随方向翻转）；manual = 基底序原样。
 *  assignee 序 = 未指派恒最后，其余按姓名；树 children 由调用方保证 manual 时为 created_at 升序 */
export function sortTaskRows(rows: TaskRow[], field: TaskOrderField, dir: OrderDir): TaskRow[] {
  if (field === "manual") return rows
  if (field === "dueDate") {
    const sign = dir === "asc" ? 1 : -1
    const withDate = rows.filter((r) => r.dueDate !== null)
    const without = rows.filter((r) => r.dueDate === null)
    withDate.sort((a, b) => sign * cmpStr(a.dueDate!, b.dueDate!))
    return [...withDate, ...without]
  }
  const sign = dir === "asc" ? 1 : -1
  const cmp = (a: TaskRow, b: TaskRow): number => {
    switch (field) {
      case "title":
        return cmpStr(a.title, b.title)
      case "status":
        return STATUS_RANK[a.status] - STATUS_RANK[b.status]
      case "priority":
        return PRIORITY_RANK[String(a.priority)] - PRIORITY_RANK[String(b.priority)]
      case "assignee": {
        // 未指派恒最后（不随方向翻转）：先按有无指派分桶，桶内姓名序带方向
        if (!a.assignee || !b.assignee) return a.assignee ? -1 : b.assignee ? 1 : 0
        return cmpStr(a.assignee.name, b.assignee.name)
      }
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

/** 分组值集上下文：members/projects/labels 清单顺序即组序（实体按值集序，P2.md §3.1） */
export interface TaskGroupContext {
  memberIds: string[]
  /** 已按名称升序（与 projectOptions 同序） */
  projectIds: string[]
  labelIds: string[]
}

/** 属性全值集（组序）：枚举业务序 / 实体值集序；NoX 哨兵恒最后（status 无哨兵） */
export function taskGroupAllValues(field: TaskGroupField, ctx: TaskGroupContext): string[] {
  switch (field) {
    case "status":
      return [...TASK_STATUSES]
    case "priority":
      return ["1", "2", "3", "4", "0"]
    case "assignee":
      return [...ctx.memberIds, NONE]
    case "project":
      return [...ctx.projectIds, NONE]
    case "label":
      return [...ctx.labelIds, NONE]
    default:
      return []
  }
}

/** 行归属值（多值属性返回多个 = 重复入组语义；空值归 NONE 哨兵组） */
export function taskRowGroupValues(row: TaskRow, field: TaskGroupField): string[] {
  switch (field) {
    case "status":
      return [row.status]
    case "priority":
      return [String(row.priority)]
    case "assignee":
      return [row.assignee ? row.assignee.id : NONE]
    case "project":
      return [row.project ? row.project.id : NONE]
    case "label":
      return row.labels.length > 0 ? row.labels.map((l) => l.id) : [NONE]
    default:
      return []
  }
}

/** 分组节点：一级（children = 二级组）或二级（叶子）。
 *  rows 语义随视图模式：flat = 直挂本节点的行；tree = 本节点的树根集合 */
export interface TaskGroupNode {
  field: TaskGroupField
  /** wire 值（NONE 哨兵 / 枚举 / id） */
  value: string
  rows: TaskRow[]
  /** 组头计数 = 展示行集中自身值命中（含组路径祖先值）的行数（flat/tree 同口径，用户图7/8/10） */
  count: number
  /** tree 模式剪枝集（kept = 锚点 + 链条祖先）：渲染器按其过滤 children；flat 模式 undefined = 不剪枝 */
  kept?: ReadonlySet<string>
  children: TaskGroupNode[]
}

/** 按组值一次分桶（多值属性入多桶；空值归 NONE 哨兵）：flat/tree 引擎共用，免逐值全表 filter */
function groupValueMap(rows: TaskRow[], field: TaskGroupField): Map<string, TaskRow[]> {
  const byValue = new Map<string, TaskRow[]>()
  for (const row of rows) {
    for (const v of taskRowGroupValues(row, field)) {
      const list = byValue.get(v)
      if (list) list.push(row)
      else byValue.set(v, [row])
    }
  }
  return byValue
}

/** 两级分组引擎（flat 口径）：一级组序 = 全值集序；二级在各一级组内按 sub 属性重分组（同规则，值集全局） */
export function buildTaskGroupsFlat(
  rows: TaskRow[],
  state: TaskDisplayState,
  ctx: TaskGroupContext,
): TaskGroupNode[] {
  if (state.grouping === "none") return []
  const level1 = groupOneLevelFlat(rows, state.grouping, state.showEmptyGroups, ctx)
  if (state.subGrouping === "none") return level1
  // 二级直接在父组行集（g.rows = 命中父组值的行）内重新分桶，免全表带谓词重扫
  for (const g of level1)
    g.children = groupOneLevelFlat(g.rows, state.subGrouping, state.showEmptyGroups, ctx)
  return level1
}

function groupOneLevelFlat(
  rows: TaskRow[],
  field: TaskGroupField,
  showEmpty: boolean,
  ctx: TaskGroupContext,
): TaskGroupNode[] {
  const byValue = groupValueMap(rows, field)
  const nodes: TaskGroupNode[] = []
  for (const v of taskGroupAllValues(field, ctx)) {
    const list = byValue.get(v)
    // show empty groups 关 = 仅有值组；开 = 全值集组（空组计数 0）
    if (!list && !showEmpty) continue
    nodes.push({ field, value: v, rows: list ?? [], count: list?.length ?? 0, children: [] })
  }
  return nodes
}

/** 常量空 kept 集：空锚点组（showEmptyGroups 开时出现）复用，免逐组新建 */
const EMPTY_KEPT: ReadonlySet<string> = new Set<string>()

/** 两级分组引擎（tree 口径，2026-09-14 修订④）：锚点 = 展示行集（已含 completed 档与 showSub 档）中
 *  自身值命中组值的行；组 rows = 渲染集（锚点祖先链 ∪ 锚点完整子树）的根集合——链条节点旁侧分支
 *  整体剪枝，非锚点节点由渲染器置灰；count 与 flat 同口径（= 锚点行数）。
 *  idx 可由调用方传入（与渲染器共享一次构建），缺省内部自建 */
export function buildTaskGroupsTree(
  base: TaskRow[],
  displayRows: TaskRow[],
  state: TaskDisplayState,
  ctx: TaskGroupContext,
  idx: TaskTreeIndex = buildTaskTreeIndex(base),
): TaskGroupNode[] {
  if (state.grouping === "none") return []
  const childVisible = taskChildVisible(state.showCompleted)
  const span = (anchors: TaskRow[]) => {
    // 空锚点组渲染集必为空，跳过整套索引遍历
    if (anchors.length === 0) return { kept: EMPTY_KEPT, rows: [] as TaskRow[] }
    const kept = taskSpanKeptSet(idx, new Set(anchors.map((r) => r.id)), childVisible)
    return { kept, rows: taskKeptRoots(base, kept) }
  }
  // 锚点一次分桶（免逐值全表 filter）；二级直接在父组锚点内重新分桶（免全量重扫）
  const level1: { node: TaskGroupNode; anchors: TaskRow[] }[] = []
  const byValue1 = groupValueMap(displayRows, state.grouping)
  for (const v of taskGroupAllValues(state.grouping, ctx)) {
    const anchors = byValue1.get(v) ?? []
    const { kept, rows } = span(anchors)
    if (rows.length === 0 && !state.showEmptyGroups) continue
    level1.push({
      node: { field: state.grouping, value: v, rows, count: anchors.length, children: [], kept },
      anchors,
    })
  }
  if (state.subGrouping === "none") return level1.map((x) => x.node)
  for (const { node: g, anchors } of level1) {
    const byValue2 = groupValueMap(anchors, state.subGrouping)
    for (const v2 of taskGroupAllValues(state.subGrouping, ctx)) {
      const sub = byValue2.get(v2) ?? []
      const { kept, rows } = span(sub)
      if (rows.length === 0 && !state.showEmptyGroups) continue
      g.children.push({
        field: state.subGrouping,
        value: v2,
        rows,
        count: sub.length,
        children: [],
        kept,
      })
    }
  }
  return level1.map((x) => x.node)
}

// ---- 列配置（Display properties chip 单源）----

export interface TaskColumnDef {
  key: TaskColumn
  labelKey: string
}

/** chip 固定顺序（用户定案 2026-09：Status/Assignee/Priority/Project/Due date/Labels/Created/Updated；ID 后置） */
export const TASK_COLUMNS: TaskColumnDef[] = [
  { key: "status", labelKey: "common.status" },
  { key: "assignee", labelKey: "task.assignee" },
  { key: "priority", labelKey: "common.priority" },
  { key: "project", labelKey: "task.project" },
  { key: "dueDate", labelKey: "task.dueDate" },
  { key: "labels", labelKey: "common.labels" },
  { key: "createdAt", labelKey: "filter.createdAt" },
  { key: "updatedAt", labelKey: "filter.updatedAt" },
]

/** Ordering → Display properties 联动（用户定案 6）：排序属性自动勾选对应列（manual/title 无对应列） */
export const taskOrderColumn = (f: TaskOrderField): TaskColumn | undefined =>
  f === "manual" || f === "title" ? undefined : f

/** 分组/空组展开依赖异步值集的属性（清单顺序 = 组序） */
export const taskNeedsMembers = (s: TaskDisplayState): boolean =>
  [s.grouping, s.subGrouping].includes("assignee")
export const taskNeedsLabels = (s: TaskDisplayState): boolean =>
  [s.grouping, s.subGrouping].includes("label")
export const taskNeedsProjects = (s: TaskDisplayState): boolean =>
  [s.grouping, s.subGrouping].includes("project")

// ---- 菜单文案键 ----

const FIELD_LABEL_KEYS: Record<string, string> = {
  status: "common.status",
  priority: "common.priority",
  assignee: "task.assignee",
  project: "task.project",
  label: "common.labels",
  title: "common.title",
  createdAt: "filter.createdAt",
  updatedAt: "filter.updatedAt",
  dueDate: "task.dueDate",
}

export const taskGroupFieldLabelKey = (f: TaskGroupField): string =>
  f === "none" ? "display.noGrouping" : FIELD_LABEL_KEYS[f]

export const taskOrderFieldLabelKey = (f: TaskOrderField): string =>
  f === "manual" ? "display.manual" : FIELD_LABEL_KEYS[f]
