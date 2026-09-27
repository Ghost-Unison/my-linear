// 独立运行：node --experimental-strip-types myLinearFrontEnd/src/lib/views-project-stats.test.mjs
// 沿用任务统计测试的 TS 类型擦除与路径别名解析，不修改构建配置或原 44 项测试。
import assert from "node:assert/strict"
import { registerHooks } from "node:module"

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context)
    }
    return nextResolve(specifier, context)
  },
})

const { buildViewProjectStats, displayedProjectRows, selectViewProjectRows } = await import("./views-project-stats.ts")
const { applyShowClosed, DEFAULT_DISPLAY, GROUP_FIELDS, ORDER_FIELDS, TIMEFRAMES } = await import("./display-state.ts")
const { NONE, PROJECT_STATUSES } = await import("./filter-state.ts")
const { resolveListEmptyState } = await import("./list-empty-state.ts")
const {
  decodeProjectConfig, decodeTaskConfig, encodeProjectConfig, encodeTaskConfig,
} = await import("@/lib/view-state")
const { PROJECT_VIEW_ENTITY, TASK_VIEW_ENTITY, newWorkspaceViewDraft } = await import("./workspace-view-state.ts")

let passed = 0
let failed = 0
function check(name, run) {
  try {
    run()
    passed++
    console.log(`通过：${name}`)
  } catch (error) {
    failed++
    console.error(`失败：${name}`)
    console.error(error)
  }
}

function project(id, extra = {}) {
  return {
    id,
    name: id,
    status: "in_progress",
    priority: 0,
    lead: null,
    members: [],
    labels: [],
    startDate: null,
    targetDate: null,
    taskCount: 0,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    ...extra,
  }
}
const newDisplay = (extra = {}) => ({ ...DEFAULT_DISPLAY, visible: { ...DEFAULT_DISPLAY.visible }, ...extra })
const ids = (rows) => rows.map((row) => row.id)
const dimensions = ["lead", "member", "label"]
const alice = { id: "00000000-0000-4000-8000-000000000001", name: "Alice", avatarColor: "#123456" }
const bob = { id: "00000000-0000-4000-8000-000000000002", name: "Bob", avatarColor: "#654321" }
const alpha = { id: "00000000-0000-4000-8000-000000000003", name: "Alpha", color: "#112233" }
const beta = { id: "00000000-0000-4000-8000-000000000004", name: "Beta", color: "#334455" }
const projectId = "00000000-0000-4000-8000-000000000005"
const bucket = (entity, count) => ({
  value: entity.id, name: entity.name, count,
  ...((entity.avatarColor || entity.color) ? { color: entity.avatarColor || entity.color } : {}),
})
function deepFreeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

check("成员按 ID 去重：重复引用、同 ID 不同对象、重复项目只计一次", () => {
  const one = project("one", { members: [bob, alice, alice, { ...alice, name: "Ignored" }] })
  const rows = [one, project("two", { members: [alice] }), one, { ...one }]
  assert.deepEqual(buildViewProjectStats(rows, "member"), [bucket(alice, 2), bucket(bob, 1)])
  assert.deepEqual(ids(selectViewProjectRows(displayedProjectRows(rows, newDisplay()), {
    dimension: "member", value: alice.id,
  })), ["one", "two"])
})

check("标签按 ID 去重：单项目可入多个桶，但重复标签与项目不重复计数", () => {
  const one = project("one", { labels: [beta, alpha, alpha, { ...alpha, name: "Ignored" }] })
  const rows = [one, project("two", { labels: [alpha] }), one, project("unlabeled")]
  assert.deepEqual(buildViewProjectStats(rows, "label"), [bucket(alpha, 2), bucket(beta, 1)])
  assert.deepEqual(ids(selectViewProjectRows(displayedProjectRows(rows, newDisplay()), {
    dimension: "label", value: alpha.id,
  })), ["one", "two"])
})

check("负责人按项目计数，而非任务数、成员数或重复行数", () => {
  const one = project("one", { lead: alice, taskCount: 100, members: [alice, bob] })
  const rows = [one, one, project("two", { lead: alice }), project("three", { lead: bob, taskCount: 200 })]
  assert.deepEqual(buildViewProjectStats(rows, "lead"), [bucket(alice, 2), bucket(bob, 1)])
  assert.equal(displayedProjectRows(rows, newDisplay()).length, 3)
})

check("空负责人和空成员各归 NONE，负责人不自动加入成员统计", () => {
  const rows = [project("empty"), project("lead-only", { lead: alice }), project("member-only", { members: [bob] })]
  assert.deepEqual(buildViewProjectStats(rows, "lead"), [{ value: NONE, name: "", count: 2 }, bucket(alice, 1)])
  assert.deepEqual(buildViewProjectStats(rows, "member"), [{ value: NONE, name: "", count: 2 }, bucket(bob, 1)])
  assert.deepEqual(ids(selectViewProjectRows(rows, { dimension: "lead", value: NONE })), ["empty", "member-only"])
  assert.deepEqual(ids(selectViewProjectRows(rows, { dimension: "member", value: NONE })), ["empty", "lead-only"])
})

check("无标签不造 NONE 桶，也不能通过 NONE 标签钻取", () => {
  const rows = [project("empty"), project("labeled", { labels: [alpha] })]
  assert.deepEqual(buildViewProjectStats([rows[0]], "label"), [])
  assert.deepEqual(buildViewProjectStats(rows, "label"), [bucket(alpha, 1)])
  assert.deepEqual(selectViewProjectRows(rows, { dimension: "label", value: NONE }), [])
})

check("空值桶仅在真实命中时生成，名称和可选颜色与任务桶结构兼容", () => {
  const rows = [project("one", { lead: alice, members: [bob], labels: [alpha] })]
  for (const [dimension, entity] of [["lead", alice], ["member", bob], ["label", alpha]]) {
    assert.deepEqual(buildViewProjectStats(rows, dimension), [bucket(entity, 1)])
  }
  const noColor = { id: "no-color", name: "No color", avatarColor: "" }
  assert.deepEqual(buildViewProjectStats([project("two", { lead: noColor })], "lead"), [
    { value: noColor.id, name: noColor.name, count: 1 },
  ])
})

check("同 ID 不同项目快照保留首个对象及顺序，不合并后续成员或标签", () => {
  const first = project("same", { lead: alice, members: [alice], labels: [alpha] })
  const later = project("same", { lead: bob, members: [bob], labels: [beta] })
  const rows = [project("z"), first, later, project("a")]
  const displayed = displayedProjectRows(rows, newDisplay())
  assert.deepEqual(ids(displayed), ["z", "same", "a"])
  assert.equal(displayed[1], first)
  for (const dimension of dimensions) {
    assert.deepEqual(buildViewProjectStats(rows, dimension), buildViewProjectStats(displayed, dimension))
  }
  assert.deepEqual(buildViewProjectStats(rows, "label"), [bucket(alpha, 1)])
})

check("三维桶均按 count 降序、name 升序、ID 升序排序，不依赖输入顺序", () => {
  const a = { id: "a", name: "Same", avatarColor: "#123456", color: "#123456" }
  const b = { ...a, id: "b" }
  const z = { ...a, id: "z", name: "Zebra" }
  const first = { ...a, id: "first", name: "Alpha" }
  const row = (id, entity) => project(id, { lead: entity, members: [entity], labels: [entity] })
  const rows = [row("z1", z), row("b", b), row("a", a), row("z2", z), row("first", first)]
  for (const dimension of dimensions) {
    const stats = buildViewProjectStats(rows, dimension)
    assert.deepEqual(stats.map((item) => item.value), ["z", "first", "a", "b"])
    assert.deepEqual(buildViewProjectStats([...rows].reverse(), dimension), stats)
  }
})

check("ShowClosed 两档覆盖全部项目状态，与既有展示函数同序并按 ID 去重", () => {
  const rows = PROJECT_STATUSES.map((status) => project(status, { status, lead: alice }))
  rows.push(rows[0], { ...rows[1] })
  for (const showClosed of ["none", "all"]) {
    const displayed = displayedProjectRows(rows, newDisplay({ showClosed }))
    const expected = [...new Set(ids(applyShowClosed(rows, showClosed)))]
    assert.deepEqual(ids(displayed), expected)
    assert.deepEqual(buildViewProjectStats(displayed, "lead"), [bucket(alice, showClosed === "none" ? 3 : 5)])
  }
  assert.deepEqual(ids(displayedProjectRows(rows, newDisplay())), ["backlog", "planned", "in_progress"])
})

check("必须先隐藏关闭项目再去重，不能让首个关闭快照吞掉后续可见快照", () => {
  const closed = project("same", { status: "completed", lead: alice })
  const opened = project("same", { lead: bob })
  const rows = [closed, project("other"), opened, { ...opened }]
  const hidden = displayedProjectRows(rows, newDisplay())
  assert.deepEqual(ids(hidden), ["other", "same"])
  assert.equal(hidden[1], opened)
  assert.equal(displayedProjectRows(rows, newDisplay({ showClosed: "all" }))[0], closed)
})

check("分组、二级分组、排序、时间粒度、空组与可见列均不改变展示计数或输入序", () => {
  const one = project("z", { lead: alice, members: [alice, bob], labels: [alpha, beta] })
  const rows = [one, project("a"), one, project("closed", { status: "completed" })]
  const hiddenColumns = Object.fromEntries(Object.keys(DEFAULT_DISPLAY.visible).map((key) => [key, false]))
  const variants = [
    ...GROUP_FIELDS.map((grouping) => ({ grouping, subGrouping: grouping === "member" ? "label" : "member" })),
    ...ORDER_FIELDS.flatMap((orderField) => ["asc", "desc"].map((orderDir) => ({ orderField, orderDir }))),
    ...TIMEFRAMES.map((timeframe) => ({ timeframe, grouping: "startDate", subGrouping: "targetDate" })),
    { showEmptyGroups: true }, { visible: hiddenColumns },
    { grouping: "member", subGrouping: "label", orderField: "name", orderDir: "desc",
      timeframe: "year", showEmptyGroups: true, visible: hiddenColumns },
  ]
  for (const showClosed of ["none", "all"]) {
    const expected = displayedProjectRows(rows, newDisplay({ showClosed }))
    for (const variant of variants) {
      const displayed = displayedProjectRows(rows, newDisplay({ ...variant, showClosed }))
      assert.deepEqual(displayed, expected)
      for (const dimension of dimensions) {
        assert.deepEqual(buildViewProjectStats(displayed, dimension), buildViewProjectStats(expected, dimension))
      }
    }
  }
})

check("统计和选择只消费已有展示行，不擅自再次应用默认关闭态隐藏", () => {
  const rows = displayedProjectRows([project("closed", {
    status: "completed", lead: alice, members: [alice], labels: [alpha],
  })], newDisplay({ showClosed: "all" }))
  for (const [dimension, entity] of [["lead", alice], ["member", alice], ["label", alpha]]) {
    assert.deepEqual(buildViewProjectStats(rows, dimension), [bucket(entity, 1)])
    assert.deepEqual(selectViewProjectRows(rows, { dimension, value: entity.id }), rows)
  }
})

check("三个维度选择保持展示顺序与行引用，null 原样返回，失效 ID 返回空", () => {
  const rows = [project("z", { lead: alice, members: [bob, alice], labels: [beta, alpha] }),
    project("other"), project("a", { lead: alice, members: [alice], labels: [alpha] })]
  assert.equal(selectViewProjectRows(rows, null), rows)
  for (const [dimension, value] of [["lead", alice.id], ["member", alice.id], ["label", alpha.id]]) {
    const selected = selectViewProjectRows(rows, { dimension, value })
    assert.deepEqual(ids(selected), ["z", "a"])
    assert.equal(selected[0], rows[0])
    assert.deepEqual(selectViewProjectRows(rows, { dimension, value: "missing" }), [])
  }
})

check("先展示后选择，不允许命中重复项目的被舍弃快照或隐藏的关闭项目", () => {
  const rows = [project("same"), project("same", { lead: bob, members: [bob], labels: [beta] }),
    project("closed", { status: "canceled", lead: bob, members: [bob], labels: [beta] })]
  for (const [dimension, value] of [["lead", bob.id], ["member", bob.id], ["label", beta.id]]) {
    const selection = { dimension, value }
    assert.deepEqual(selectViewProjectRows(displayedProjectRows(rows, newDisplay()), selection), [])
    // 反例：先选择再展示，会错误地让后续重复快照进入结果。
    assert.deepEqual(ids(displayedProjectRows(selectViewProjectRows(rows, selection), newDisplay())), ["same"])
  }
})

check("每个统计桶计数等于同展示基准的钻取长度，包括 NONE 与多值去重", () => {
  const one = project("one", { lead: alice, members: [alice, bob, alice], labels: [alpha, beta, alpha] })
  const rows = [one, one, project("empty"), project("closed", {
    status: "completed", lead: bob, members: [bob], labels: [beta],
  })]
  for (const showClosed of ["none", "all"]) {
    const displayed = displayedProjectRows(rows, newDisplay({ showClosed }))
    for (const dimension of dimensions) {
      for (const item of buildViewProjectStats(displayed, dimension)) {
        const selected = selectViewProjectRows(displayed, { dimension, value: item.value })
        assert.equal(selected.length, item.count)
        assert.equal(new Set(ids(selected)).size, item.count)
      }
    }
  }
})

check("多成员和多标签的桶之和不能充当项目总数", () => {
  const one = project("one", { members: [alice, bob], labels: [alpha, beta], taskCount: 100 })
  const displayed = displayedProjectRows([one, one], newDisplay())
  assert.equal(displayed.length, 1)
  for (const dimension of ["member", "label"]) {
    assert.equal(buildViewProjectStats(displayed, dimension).reduce((sum, item) => sum + item.count, 0), 2)
  }
})

check("展示、统计和独立选择均不修改输入或其它维度的统计基准", () => {
  const rows = deepFreeze([project("one", { lead: alice, members: [bob, alice], labels: [beta, alpha] }),
    project("two", { lead: bob }), project("closed", { status: "completed" })])
  const state = deepFreeze(newDisplay())
  const before = structuredClone({ rows, state })
  const displayed = displayedProjectRows(rows, state)
  const stats = dimensions.map((dimension) => buildViewProjectStats(displayed, dimension))
  const selection = deepFreeze({ dimension: "member", value: bob.id })
  assert.deepEqual(ids(selectViewProjectRows(displayed, selection)), ["one"])
  assert.deepEqual(dimensions.map((dimension) => buildViewProjectStats(displayed, dimension)), stats)
  assert.deepEqual({ rows, state }, before)
  assert.deepEqual(selection, { dimension: "member", value: bob.id })
  assert.equal(displayed[0], rows[0])
  stats[0][0].count = 1000
  assert.notEqual(buildViewProjectStats(displayed, "lead")[0].count, 1000)
})

check("空项目集三维均无桶，空选择不会回退基础数据", () => {
  const rows = []
  assert.deepEqual(displayedProjectRows(rows, newDisplay()), [])
  assert.equal(selectViewProjectRows(rows, null), rows)
  for (const dimension of dimensions) {
    assert.deepEqual(buildViewProjectStats(rows, dimension), [])
    assert.deepEqual(selectViewProjectRows(rows, { dimension, value: NONE }), [])
  }
})

const emptyInput = { editor: false, savedView: false, hasTemporaryFilters: false, rawCount: 0, visibleCount: 0 }
const counts = (rows, state) => ({ rawCount: new Set(ids(rows)).size, visibleCount: displayedProjectRows(rows, state).length })

check("空因：无原始项目分别为 base、saved、draft", () => {
  assert.deepEqual(resolveListEmptyState(emptyInput), { kind: "base" })
  assert.deepEqual(resolveListEmptyState({ ...emptyInput, savedView: true }), { kind: "saved" })
  assert.deepEqual(resolveListEmptyState({ ...emptyInput, editor: true, savedView: true }), { kind: "draft" })
})

check("空因：无标签但有展示项目时，不能将零标签桶误判为列表为空", () => {
  const rows = [project("unlabeled")]
  const state = newDisplay()
  assert.deepEqual(buildViewProjectStats(displayedProjectRows(rows, state), "label"), [])
  assert.equal(resolveListEmptyState({ ...emptyInput, ...counts(rows, state) }), null)
})

check("空因：ShowClosed 隐藏全部原始项目时为 display，全部展示时无空态", () => {
  const rows = [project("completed", { status: "completed" }), project("canceled", { status: "canceled" })]
  for (const editor of [false, true]) {
    assert.deepEqual(resolveListEmptyState({ ...emptyInput, editor, ...counts(rows, newDisplay()) }), { kind: "display" })
    assert.equal(resolveListEmptyState({ ...emptyInput, editor, ...counts(rows, newDisplay({ showClosed: "all" })) }), null)
  }
})

check("空因：已有展示但选中桶无匹配时 selection 优先于草稿和临时筛选", () => {
  const rows = displayedProjectRows([project("one")], newDisplay())
  for (const editor of [false, true]) {
    for (const hasTemporaryFilters of [false, true]) {
      assert.deepEqual(resolveListEmptyState({
        ...emptyInput, editor, hasTemporaryFilters, rawCount: 1, visibleCount: rows.length,
        selectedCount: selectViewProjectRows(rows, { dimension: "label", value: alpha.id }).length,
        baseline: { rawCount: 5, visibleCount: 3 },
      }), { kind: "selection" })
    }
  }
})

check("空因：展示本来为空不能归咎于统计选择，已有选择结果则不显示空态", () => {
  assert.deepEqual(resolveListEmptyState({ ...emptyInput, rawCount: 2, selectedCount: 0 }), { kind: "display" })
  assert.deepEqual(resolveListEmptyState({ ...emptyInput, selectedCount: 0 }), { kind: "base" })
  assert.equal(resolveListEmptyState({ ...emptyInput, selectedCount: 1 }), null)
})

check("空因：临时基准尚未知只返回 filtered，不臆测隐藏数量", () => {
  for (const savedView of [false, true]) {
    for (const rawCount of [0, 2]) {
      assert.deepEqual(resolveListEmptyState({ ...emptyInput, savedView, rawCount, hasTemporaryFilters: true }),
        { kind: "filtered" })
    }
  }
})

check("空因：同 Display 基准先隐藏再去重，hiddenCount 不用原始数或多值桶和", () => {
  const one = project("one", { members: [alice, bob, alice], labels: [alpha, beta, alpha] })
  const rows = [one, one, { ...one, id: "two" }, { ...one, id: "closed", status: "completed" }]
  for (const showClosed of ["none", "all"]) {
    const state = newDisplay({ showClosed, grouping: "member", subGrouping: "label" })
    const displayed = displayedProjectRows(rows, state)
    const expected = showClosed === "none" ? 2 : 3
    assert.equal(displayed.length, expected)
    for (const dimension of ["member", "label"]) {
      assert.ok(buildViewProjectStats(displayed, dimension).reduce((sum, item) => sum + item.count, 0) > expected)
    }
    for (const savedView of [false, true]) {
      assert.deepEqual(resolveListEmptyState({
        ...emptyInput, savedView, hasTemporaryFilters: true, baseline: counts(rows, state),
      }), { kind: "temporary", hiddenCount: expected })
    }
  }
})

check("空因：临时基准全为关闭项目时 none 为 display、all 才有真实隐藏数量", () => {
  const completed = project("completed", { status: "completed" })
  const rows = [completed, completed, project("canceled", { status: "canceled" })]
  const input = { ...emptyInput, savedView: true, hasTemporaryFilters: true }
  assert.deepEqual(resolveListEmptyState({ ...input, baseline: counts(rows, newDisplay()) }), { kind: "display" })
  assert.deepEqual(resolveListEmptyState({ ...input, baseline: counts(rows, newDisplay({ showClosed: "all" })) }),
    { kind: "temporary", hiddenCount: 2 })
})

check("空因：临时基准本来为空不报临时隐藏；当前原始数据先返回时归 display", () => {
  for (const savedView of [false, true]) {
    const input = { ...emptyInput, savedView, hasTemporaryFilters: true, baseline: counts([], newDisplay()) }
    assert.deepEqual(resolveListEmptyState(input), { kind: savedView ? "saved" : "base" })
    assert.deepEqual(resolveListEmptyState({ ...input, rawCount: 1 }), { kind: "display" })
  }
})

check("空因：编辑草稿不借用浏览临时基准，无临时筛选也忽略残留基准", () => {
  const baseline = { rawCount: 5, visibleCount: 3 }
  assert.deepEqual(resolveListEmptyState({ ...emptyInput, editor: true, hasTemporaryFilters: true, baseline }), { kind: "draft" })
  assert.deepEqual(resolveListEmptyState({ ...emptyInput, editor: true, rawCount: 2, hasTemporaryFilters: true, baseline }),
    { kind: "display" })
  assert.deepEqual(resolveListEmptyState({ ...emptyInput, baseline }), { kind: "base" })
})

check("空因：基准异步变化重新判定，且不修改冻结的输入与基准", () => {
  const input = deepFreeze({ ...emptyInput, hasTemporaryFilters: true, baseline: { rawCount: 5, visibleCount: 2 } })
  const before = structuredClone(input)
  assert.deepEqual(resolveListEmptyState(input), { kind: "temporary", hiddenCount: 2 })
  assert.deepEqual(resolveListEmptyState({ ...input, baseline: undefined }), { kind: "filtered" })
  assert.deepEqual(resolveListEmptyState({ ...input, baseline: { rawCount: 0, visibleCount: 0 } }), { kind: "base" })
  assert.deepEqual(resolveListEmptyState(input), { kind: "temporary", hiddenCount: 2 })
  assert.deepEqual(input, before)
})

const projectFilters = [
  { field: "status", op: "is", values: ["planned"] },
  { field: "lead", op: "is", values: [alice.id] },
  { field: "member", op: "inclAny", values: [alice.id, bob.id] },
  { field: "labels", op: "inclAll", values: [alpha.id] },
  { field: "priority", op: "is", values: ["1"] },
  { field: "createdAt", op: "after", values: ["1w"] },
  { field: "updatedAt", op: "after", values: ["1d"] },
  { field: "startDate", op: "is", values: [NONE] },
  { field: "targetDate", op: "before", values: ["3mo"] },
]
const taskOnlyFilters = [
  { field: "assignee", op: "is", values: [alice.id] },
  { field: "project", op: "is", values: [projectId] },
  { field: "dueDate", op: "before", values: ["1w"] },
  { field: "status", op: "is", values: ["todo"] },
  { field: "status", op: "is", values: ["done"] },
]

check("配置：项目解码剔除任务专属字段与任务状态，保留全部合法项目字段", () => {
  assert.deepEqual(decodeTaskConfig({ filters: taskOnlyFilters }).filters, taskOnlyFilters)
  assert.deepEqual(decodeProjectConfig({ filters: [...taskOnlyFilters, ...projectFilters] }).filters, projectFilters)
  assert.deepEqual(decodeProjectConfig(encodeTaskConfig(taskOnlyFilters, decodeTaskConfig().display)).filters, [])
})

check("配置：合法项目条件与非默认 Display 编码解码往返保持一致", () => {
  const display = newDisplay({ grouping: "member", subGrouping: "label", timeframe: "year",
    orderField: "name", orderDir: "desc", showClosed: "all", showEmptyGroups: true,
    visible: { ...DEFAULT_DISPLAY.visible, members: true, labels: true } })
  const encoded = encodeProjectConfig(projectFilters, display)
  assert.deepEqual(encoded, { filters: projectFilters, display })
  assert.deepEqual(decodeProjectConfig(JSON.parse(JSON.stringify(encoded))), { filters: projectFilters, display })
})

check("配置：混合条件解码后重新编码，项目 config 不再携带 task filters", () => {
  const snapshot = decodeProjectConfig({ filters: [...projectFilters, ...taskOnlyFilters] })
  const encoded = encodeProjectConfig(snapshot.filters, snapshot.display)
  assert.deepEqual(encoded.filters, projectFilters)
  assert.deepEqual(decodeProjectConfig(encoded), snapshot)
})

check("配置：项目编码入口直接收到混合条件时也不得携带 task filters", () => {
  // 直接检验保存入口，不能借解码先清洗来掩盖编码阶段的实体隔离缺口。
  assert.deepEqual(encodeProjectConfig([...projectFilters, ...taskOnlyFilters], newDisplay()).filters, projectFilters)
})

check("配置：项目解码按字段、操作符和值域白名单过滤，不误丢共享合法状态", () => {
  const shared = [{ field: "status", op: "isAnyOf", values: ["backlog", "in_progress", "canceled"] }]
  const invalid = [
    null, { field: "lead", op: "is", values: [42] }, { field: "lead", op: "is", values: ["not-a-uuid"] },
    { field: "member", op: "is", values: [alice.id] }, { field: "member", op: "inclAny", values: [NONE] },
    { field: "targetDate", op: "before", values: ["1d"] }, { field: "unknown", op: "is", values: ["x"] },
  ]
  assert.deepEqual(decodeProjectConfig({ filters: [...invalid, ...shared, ...projectFilters] }).filters,
    [...shared, ...projectFilters])
})

check("配置：项目 Display 不携任务专属开关、任务排序或任务可见列", () => {
  const taskConfig = encodeTaskConfig([], { ...decodeTaskConfig().display,
    grouping: "assignee", subGrouping: "project", orderField: "title", showCompleted: "none",
    showSubIssues: false, nestedSubIssues: false })
  const snapshot = decodeProjectConfig(taskConfig)
  assert.equal(snapshot.display.grouping, "none")
  assert.equal(snapshot.display.subGrouping, "none")
  assert.equal(snapshot.display.orderField, "manual")
  assert.equal(snapshot.display.showClosed, "none")
  const encoded = encodeProjectConfig(snapshot.filters, snapshot.display)
  for (const key of ["showCompleted", "showSubIssues", "nestedSubIssues"]) {
    assert.equal(Object.hasOwn(encoded.display, key), false)
  }
  for (const key of ["assignee", "project", "dueDate"]) {
    assert.equal(Object.hasOwn(encoded.display.visible, key), false)
  }
})

check("配置：编码深拷贝 filters、values、display 和 visible，双向修改互不污染", () => {
  const filters = structuredClone(projectFilters)
  const display = newDisplay()
  const encoded = encodeProjectConfig(filters, display)
  const before = structuredClone(encoded)
  assert.notEqual(encoded.filters, filters)
  assert.notEqual(encoded.filters[0], filters[0])
  assert.notEqual(encoded.filters[0].values, filters[0].values)
  assert.notEqual(encoded.display, display)
  assert.notEqual(encoded.display.visible, display.visible)
  filters[0].values.push("completed")
  display.visible.members = true
  assert.deepEqual(encoded, before)
  const inputBefore = structuredClone({ filters, display })
  encoded.filters[1].values.push(bob.id)
  encoded.display.visible.labels = true
  assert.deepEqual({ filters, display }, inputBefore)
})

check("配置：冻结输入可反复编解码，输出快照互不共享默认列与过滤值", () => {
  const config = deepFreeze({ filters: structuredClone(projectFilters), display: newDisplay() })
  const before = structuredClone(config)
  const first = decodeProjectConfig(config)
  const second = decodeProjectConfig(config)
  assert.deepEqual(encodeProjectConfig(config.filters, config.display), before)
  first.filters[0].values.push("completed")
  first.display.visible.members = true
  assert.deepEqual(second, before)
  assert.deepEqual(config, before)
  const a = decodeProjectConfig()
  const b = decodeProjectConfig(null)
  a.display.visible.members = true
  assert.equal(b.display.visible.members, DEFAULT_DISPLAY.visible.members)
})

check("实体适配：Projects 接线到项目展示、统计、选择和编解码，维度不跨实体", () => {
  assert.equal(PROJECT_VIEW_ENTITY.displayedRows, displayedProjectRows)
  assert.equal(PROJECT_VIEW_ENTITY.buildStats, buildViewProjectStats)
  assert.equal(PROJECT_VIEW_ENTITY.selectRows, selectViewProjectRows)
  assert.equal(PROJECT_VIEW_ENTITY.encode, encodeProjectConfig)
  assert.equal(PROJECT_VIEW_ENTITY.decode, decodeProjectConfig)
  assert.equal(PROJECT_VIEW_ENTITY.entityType, "project")
  assert.equal(PROJECT_VIEW_ENTITY.surface, "projects_page")
  assert.equal(PROJECT_VIEW_ENTITY.tab, "projects")
  assert.equal(PROJECT_VIEW_ENTITY.defaultDimension, "lead")
  for (const dimension of dimensions) assert.equal(PROJECT_VIEW_ENTITY.isDimension(dimension), true)
  for (const dimension of ["assignee", "project"]) assert.equal(PROJECT_VIEW_ENTITY.isDimension(dimension), false)
  for (const dimension of ["lead", "member"]) assert.equal(TASK_VIEW_ENTITY.isDimension(dimension), false)
})

check("实体适配：项目与任务草稿默认值独立，项目草稿没有任务过滤和 Display 字段", () => {
  const taskDraft = newWorkspaceViewDraft(TASK_VIEW_ENTITY)
  taskDraft.filters.push(...structuredClone(taskOnlyFilters))
  taskDraft.display.visible.status = false
  const projectDraft = newWorkspaceViewDraft(PROJECT_VIEW_ENTITY)
  assert.deepEqual(projectDraft, { name: "", description: "", filters: [], display: newDisplay() })
  assert.equal(Object.hasOwn(projectDraft.display, "showCompleted"), false)
  const another = newWorkspaceViewDraft(PROJECT_VIEW_ENTITY)
  projectDraft.filters.push(...structuredClone(projectFilters))
  projectDraft.display.visible.labels = true
  assert.deepEqual(another, { name: "", description: "", filters: [], display: newDisplay() })
})

console.log(`项目统计独立测试：${passed + failed} 项，${passed} 项通过，${failed} 项失败`)
if (failed > 0) process.exitCode = 1
