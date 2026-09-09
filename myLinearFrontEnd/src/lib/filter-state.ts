// P2 条件列表前端状态核心（后端 internal/filter 的镜像，P2.md §2.5）。
// FilterCond 与后端 Cond、未来 saved_view.config.filters 三方同构；parseConds 与后端 Parse
// 按同一套三级白名单规则丢弃非法条目——保证「chip 行显示的」与「后端求值的」永远一致
//（URL 可分享可书签，须对手改/过期参数健壮）。
import type { LabelScope } from "@/api/types"

/** 字段值形态（同构后端 filter.Kind）：决定操作符清单与菜单层级 */
export type FieldKind = "single" | "multi" | "day" | "moment"

/** 一条过滤条件：wire 形态 f=<field>.<op>.<v1,v2>；同字段可重复（P2.md §1.7） */
export interface FilterCond {
  field: string
  op: string
  values: string[]
}

/** 各值形态的全量操作符（同构后端 filter.KindOps；members 经 multiProfile 覆写为 contains 族） */
const SINGLE_OPS = ["is", "isNot", "isAnyOf"] as const
const MULTI_ALL_OPS = ["inclAll", "inclAny", "exclAny", "exclAll"] as const
const MULTI_ANY_OPS = ["inclAny", "exclAny"] as const
const DAY_OPS = ["before", "after", "is", "isNot"] as const

export function opsOf(spec: FieldSpec): readonly string[] {
  switch (spec.kind) {
    case "single":
      return SINGLE_OPS
    case "multi":
      return spec.multiProfile === "any" ? MULTI_ANY_OPS : MULTI_ALL_OPS
    default:
      return DAY_OPS
  }
}

/** 操作符菜单清单（随选中值个数联动，Linear 实测真值表 P2.md §2.1）：
 * 单值 1 值 [is, is not] / 多值 [is any of, is not]；
 * 多值 all 族 1 值 [include, do not include] / 多值四操作符；any 族恒两操作符；
 * 日期：none/overdue 哨兵条件 [is, is not]，其余 [before, after] */
export function menuOps(spec: FieldSpec, values: readonly string[]): readonly string[] {
  const n = values.length
  if (spec.kind === "single") return n <= 1 ? ["is", "isNot"] : ["isAnyOf", "isNot"]
  if (spec.kind === "multi")
    return spec.multiProfile === "any" ? MULTI_ANY_OPS : n <= 1 ? ["inclAll", "exclAny"] : MULTI_ALL_OPS
  return n === 1 && (values[0] === NONE || values[0] === OVERDUE) ? ["is", "isNot"] : ["before", "after"]
}

/** 值个数变化时的操作符归一（等价语义收敛，保证 chip 文案与菜单行永远对应）：
 * 单值 isAnyOf 单值→is、is 多值→isAnyOf；all 族 inclAny 单值→inclAll、exclAll 单值→exclAny */
export function normalizeOp(spec: FieldSpec, op: string, values: readonly string[]): string {
  const n = values.length
  if (spec.kind === "single") {
    if (n <= 1 && op === "isAnyOf") return "is"
    if (n > 1 && op === "is") return "isAnyOf"
  }
  if (spec.kind === "multi" && spec.multiProfile !== "any" && n <= 1) {
    if (op === "inclAny") return "inclAll"
    if (op === "exclAll") return "exclAny"
  }
  return op
}

/** 添加时默认操作符（P2.md §2.1）：单值 is、all 族 inclAll、any 族 inclAny；
 * 日期随阶梯方向——ago 档 after（晚于 N 前 = 近 N 内）、from now 档 before（早于 N 后 = 未来 N 内） */
export function defaultOpOf(spec: FieldSpec): string {
  switch (spec.kind) {
    case "single":
      return "is"
    case "multi":
      return spec.multiProfile === "any" ? "inclAny" : "inclAll"
    default:
      return spec.dir === "fromNow" ? "before" : "after"
  }
}

/** 操作符显示文案 i18n 键（文案随值个数切换：include → include all of 等） */
export function opLabelKey(spec: FieldSpec, op: string, n: number): string {
  switch (op) {
    case "is":
      return "filter.ops.is"
    case "isNot":
      return "filter.ops.isNot"
    case "isAnyOf":
      return "filter.ops.isAnyOf"
    case "inclAll":
      return n <= 1 ? "filter.ops.include" : "filter.ops.includeAllOf"
    case "inclAny":
      return spec.multiProfile === "any"
        ? n <= 1
          ? "filter.ops.contains"
          : "filter.ops.containsAny"
        : "filter.ops.includeAnyOf"
    case "exclAny":
      return spec.multiProfile === "any"
        ? "filter.ops.doesNotContain"
        : n <= 1
          ? "filter.ops.doNotInclude"
          : "filter.ops.excludeIfAnyOf"
    case "exclAll":
      return "filter.ops.excludeIfAll"
    case "before":
      return "filter.ops.before"
    case "after":
      return "filter.ops.after"
    default:
      return op
  }
}

/** 日期字段阶梯白名单（target date 仅未来三档，其余全量七档） */
export const ladderCodesOf = (spec: FieldSpec): readonly string[] => spec.ladders ?? LADDER_CODES

/** 阶梯文案键：overdue 谓词专键；其余按方向切 ago / from now 两套文案 */
export const ladderLabelKey = (spec: FieldSpec, code: string): string =>
  code === OVERDUE
    ? "filter.ladder.overdue"
    : spec.dir === "fromNow"
      ? `filter.ladderFrom.${code}`
      : `filter.ladder.${code}`

/** 相对阶梯码（同构后端 ladder，P2.md §2.4；Custom 后置 P3） */
export const LADDER_CODES = ["1d", "3d", "1w", "1mo", "3mo", "6mo", "1y"] as const

/** 空伪值哨兵（同构后端 filter.None）：wire 上代表 NULL / 空集合 */
export const NONE = "none"

/** 逾期谓词码（同构后端 filter.Overdue）：仅 dueDate 提供，is/isNot 承载（is = 非空且早于今天） */
export const OVERDUE = "overdue"

/** 多值 none 哨兵与真实值互斥的勾选归一切换（菜单添加会话与 chip 值编辑共用）：
 *  multi 且 none → 选 none 则清空（互斥）、取消 none 则回空；multi 过滤 none 后 toggle；单值直接 toggle */
export function toggleValues(spec: FieldSpec, values: string[], v: string): string[] {
  if (spec.kind === "multi" && v === NONE) return values.includes(NONE) ? [] : [NONE]
  if (spec.kind === "multi") {
    const base = values.filter((x) => x !== NONE)
    return base.includes(v) ? base.filter((x) => x !== v) : [...base, v]
  }
  return values.includes(v) ? values.filter((x) => x !== v) : [...values, v]
}

export const PROJECT_STATUSES = [
  "backlog",
  "planned",
  "in_progress",
  "completed",
  "canceled",
] as const
export const TASK_STATUSES = ["backlog", "todo", "in_progress", "done", "canceled"] as const
export const PRIORITY_VALUES = ["0", "1", "2", "3", "4"] as const

/** 二级选项来源：枚举本地 / 成员 / 标签 / 项目；日期字段无来源（直进三级阶梯） */
export type ValueSource =
  | "projectStatus"
  | "taskStatus"
  | "priority"
  | "members"
  | "projectLabels"
  | "taskLabels"
  | "projects"

/** 字段白名单条目（同构后端 filter.Spec）：labelKey/noneKey 为 i18n 键 */
export interface FieldSpec {
  field: string
  kind: FieldKind
  source?: ValueSource
  allowNone?: boolean
  /** 多值操作符族：all = labels 四操作符族（默认）、any = members contains 族两操作符 */
  multiProfile?: "all" | "any"
  /** 日期阶梯方向：ago = 过去偏移（默认）、fromNow = 未来偏移 */
  dir?: "ago" | "fromNow"
  /** 日期阶梯白名单子集（空 = 全量七档） */
  ladders?: readonly string[]
  /** 提供 Overdue 逾期谓词（仅日期字段，同构后端 Spec.AllowOverdue） */
  allowOverdue?: boolean
  labelKey: string
  noneKey?: string
}

/** 列表面（P2.md §4.1 surface 列同名单值；视图归属切片 C 接通） */
export type Surface = "tasks_page" | "projects_page" | "project_issues"

// 各面可过滤字段白名单（P2.md §2.2，Linear 实测真值表；tasks_page / project_issues 两面在 A2 task 半块补）。
// 顺序 = 菜单呈现顺序：普通字段按表序，日期四字段收进 Dates 组
export const SURFACE_FIELDS: Partial<Record<Surface, FieldSpec[]>> = {
  projects_page: [
    { field: "status", kind: "single", source: "projectStatus", labelKey: "common.status" },
    { field: "priority", kind: "single", source: "priority", labelKey: "common.priority" },
    {
      field: "labels",
      kind: "multi",
      source: "projectLabels",
      allowNone: true,
      labelKey: "common.labels",
      noneKey: "filter.noLabels",
    },
    {
      field: "lead",
      kind: "single",
      source: "members",
      allowNone: true,
      labelKey: "project.lead",
      noneKey: "project.noLead",
    },
    // members 仅 contains 族两操作符且无 none 选项（Linear 真值）
    { field: "member", kind: "multi", source: "members", multiProfile: "any", labelKey: "project.members" },
    // Dates 组二级顺序对齐 Linear 真值表：Created / Updated / Start / Target
    { field: "createdAt", kind: "moment", labelKey: "filter.createdAt" },
    { field: "updatedAt", kind: "moment", labelKey: "filter.updatedAt" },
    {
      field: "startDate",
      kind: "day",
      dir: "fromNow",
      allowNone: true,
      labelKey: "project.startDate",
      noneKey: "filter.noStartDate",
    },
    {
      field: "targetDate",
      kind: "day",
      dir: "fromNow",
      ladders: ["3mo", "6mo", "1y"],
      labelKey: "project.targetDate",
    },
  ],
  // 任务列表面（Linear 实测真值表）：Project 字段仅此面有（project_issues 面无）；
  // Dates 组二级顺序 Due / Created / Updated（Started/Complete 等无 activities 记录不做）
  tasks_page: [
    { field: "status", kind: "single", source: "taskStatus", labelKey: "common.status" },
    {
      field: "assignee",
      kind: "single",
      source: "members",
      allowNone: true,
      labelKey: "task.assignee",
      noneKey: "filter.noAssignee",
    },
    { field: "priority", kind: "single", source: "priority", labelKey: "common.priority" },
    {
      field: "labels",
      kind: "multi",
      source: "taskLabels",
      allowNone: true,
      labelKey: "common.labels",
      noneKey: "filter.noLabels",
    },
    {
      field: "project",
      kind: "single",
      source: "projects",
      allowNone: true,
      labelKey: "task.project",
      noneKey: "task.noProject",
    },
    // dueDate 阶梯特化：from now 方向仅五档（Linear 实测无 6mo/1y）+ No due date + Overdue
    {
      field: "dueDate",
      kind: "day",
      dir: "fromNow",
      ladders: ["1d", "3d", "1w", "1mo", "3mo"],
      allowNone: true,
      allowOverdue: true,
      labelKey: "task.dueDate",
      noneKey: "filter.noDueDate",
    },
    { field: "createdAt", kind: "moment", labelKey: "filter.createdAt" },
    { field: "updatedAt", kind: "moment", labelKey: "filter.updatedAt" },
  ],
  // 项目详情 Issues tab 面（P2.md §2.2）：共享 tasks_page 字段矩阵与后端白名单；
  // Project 字段在此面隐含（行必属当前项目），前端 Filter 菜单不提供
  project_issues: [
    { field: "status", kind: "single", source: "taskStatus", labelKey: "common.status" },
    {
      field: "assignee",
      kind: "single",
      source: "members",
      allowNone: true,
      labelKey: "task.assignee",
      noneKey: "filter.noAssignee",
    },
    { field: "priority", kind: "single", source: "priority", labelKey: "common.priority" },
    {
      field: "labels",
      kind: "multi",
      source: "taskLabels",
      allowNone: true,
      labelKey: "common.labels",
      noneKey: "filter.noLabels",
    },
    {
      field: "dueDate",
      kind: "day",
      dir: "fromNow",
      ladders: ["1d", "3d", "1w", "1mo", "3mo"],
      allowNone: true,
      allowOverdue: true,
      labelKey: "task.dueDate",
      noneKey: "filter.noDueDate",
    },
    { field: "createdAt", kind: "moment", labelKey: "filter.createdAt" },
    { field: "updatedAt", kind: "moment", labelKey: "filter.updatedAt" },
  ],
}

export const surfaceSpecs = (surface: Surface): FieldSpec[] => SURFACE_FIELDS[surface] ?? []

export const findSpec = (surface: Surface, field: string): FieldSpec | undefined =>
  surfaceSpecs(surface).find((s) => s.field === field)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 单值校验（镜像后端 validValues）：日期 = 阶梯码；none 仅 allowNone 字段；其余按来源值域 */
function valueOk(spec: FieldSpec, v: string): boolean {
  if (spec.kind === "day" || spec.kind === "moment")
    return (LADDER_CODES as readonly string[]).includes(v)
  if (v === NONE) return !!spec.allowNone
  switch (spec.source) {
    case "projectStatus":
      return (PROJECT_STATUSES as readonly string[]).includes(v)
    case "taskStatus":
      return (TASK_STATUSES as readonly string[]).includes(v)
    case "priority":
      return (PRIORITY_VALUES as readonly string[]).includes(v)
    case "members":
    case "projectLabels":
    case "taskLabels":
    case "projects":
      return UUID_RE.test(v)
    default:
      return v !== ""
  }
}

/** f= 重复查询参数 → 条件列表；非法条目与后端 Parse 同规则静默丢弃 */
export function parseConds(params: URLSearchParams, surface: Surface): FilterCond[] {
  const out: FilterCond[] = []
  for (const raw of params.getAll("f")) {
    // field.op.values 三段：values 内只含逗号不含点，取前两个点切分
    const i1 = raw.indexOf(".")
    const i2 = raw.indexOf(".", i1 + 1)
    if (i1 <= 0 || i2 <= i1 + 1 || i2 === raw.length - 1) continue
    const field = raw.slice(0, i1)
    const op = raw.slice(i1 + 1, i2)
    const values = raw.slice(i2 + 1).split(",")
    const spec = findSpec(surface, field)
    if (!spec || !opsOf(spec).includes(op)) continue
    const ok =
      spec.kind === "day" || spec.kind === "moment"
        ? // 日期单值：none 空值 / overdue 逾期谓词（仅 is/isNot 且字段提供）或方向阶梯码（镜像后端 validValues）
          values.length === 1 &&
          (values[0] === NONE
            ? !!spec.allowNone && (op === "is" || op === "isNot")
            : values[0] === OVERDUE
              ? !!spec.allowOverdue && (op === "is" || op === "isNot")
              : (op === "before" || op === "after") && ladderCodesOf(spec).includes(values[0]))
        : values.every((v) => valueOk(spec, v))
    // 操作符按值个数等价归一，保证 chip 文案/菜单行与手改 URL 的冗余写法（如 isAnyOf 单值）一致
    if (ok) out.push({ field, op: normalizeOp(spec, op, values), values })
  }
  return out
}

/** 条件列表 → f= 参数字符串数组（顺序 = 用户添加顺序 = chip 行渲染顺序） */
export const encodeConds = (conds: FilterCond[]): string[] =>
  conds.map((c) => `${c.field}.${c.op}.${c.values.join(",")}`)

/** 条件列表写回 URLSearchParams：先清 f 再按序 append（sort/order 等其余键由调用方保留） */
export function writeConds(sp: URLSearchParams, conds: FilterCond[]) {
  sp.delete("f")
  for (const s of encodeConds(conds)) sp.append("f", s)
}

/** 标签选项的 scope 推导（label 字段按面取 scope：项目面 = project，任务面 = task） */
export const labelScopeOf = (spec: FieldSpec): LabelScope | undefined =>
  spec.source === "projectLabels" ? "project" : spec.source === "taskLabels" ? "task" : undefined
