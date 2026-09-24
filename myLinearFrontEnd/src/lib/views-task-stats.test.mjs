// 独立运行：node --experimental-strip-types myLinearFrontEnd/src/lib/views-task-stats.test.mjs
// 仅用 Node 内置断言和 TS 类型擦除；此文件内解析项目别名，不修改构建配置。
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

const { buildViewTaskStats, displayedTaskRows, selectViewTaskRows } = await import("./views-task-stats.ts")
const {
  applyShowCompleted, buildTaskGroupsFlat, buildTaskGroupsTree, buildTaskTreeIndex,
  newTaskDisplay, taskChildVisible, taskDisplayRows, taskGroupCountText,
  taskKeptRoots, taskRowGroupValues, taskSpanKeptSet, taskTreeRowDimmed,
} = await import("./task-display-state.ts")
const { NONE } = await import("./filter-state.ts")
const { remainingViewFilters } = await import("@/lib/view-state")
const { resolveListEmptyState } = await import("./list-empty-state.ts")

let passed = 0
function check(name, run) {
  run()
  passed++
  console.log(`通过：${name}`)
}

function task(id, extra = {}) {
  return {
    id,
    parentId: null,
    parentTitle: null,
    title: id,
    status: "todo",
    priority: 0,
    project: null,
    assignee: null,
    dueDate: null,
    labels: [],
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    ...extra,
  }
}
const ids = (rows) => rows.map((row) => row.id)
const alice = { id: "alice", name: "Alice", avatarColor: "#123456" }
const bob = { id: "bob", name: "Bob", avatarColor: "#654321" }
const alpha = { id: "alpha", name: "Alpha", color: "#112233" }
const beta = { id: "beta", name: "Beta", color: "#334455" }
const project = { id: "project", name: "Project" }

check("多标签可重复入不同桶，同一任务同一标签及重复行只计一次", () => {
  const one = task("one", { labels: [alpha, beta, alpha] })
  const rows = [one, task("two", { labels: [alpha] }), one, task("without-labels")]
  assert.deepEqual(buildViewTaskStats(rows, "label"), [
    { value: alpha.id, name: alpha.name, color: alpha.color, count: 2 },
    { value: beta.id, name: beta.name, color: beta.color, count: 1 },
  ])
  assert.deepEqual(ids(selectViewTaskRows(displayedTaskRows(rows, newTaskDisplay()), {
    dimension: "label", value: alpha.id,
  })), ["one", "two"])
})

check("空负责人和项目使用 NONE 及空文案，保留真实实体名称和颜色", () => {
  const assigned = task("assigned", { assignee: alice, project })
  const rows = [task("empty-1"), assigned, task("empty-2"), assigned]
  assert.deepEqual(buildViewTaskStats(rows, "assignee"), [
    { value: NONE, name: "", count: 2 },
    { value: alice.id, name: alice.name, color: alice.avatarColor, count: 1 },
  ])
  assert.deepEqual(buildViewTaskStats(rows, "project"), [
    { value: NONE, name: "", count: 2 },
    { value: project.id, name: project.name, count: 1 },
  ])
  for (const dimension of ["assignee", "project"]) {
    assert.deepEqual(ids(selectViewTaskRows(rows, { dimension, value: NONE })), ["empty-1", "empty-2"])
  }
})

check("无标签不生成 NONE 桶，钻取 NONE 标签也不匹配无标签任务", () => {
  const rows = [task("empty")]
  assert.deepEqual(buildViewTaskStats(rows, "label"), [])
  assert.deepEqual(selectViewTaskRows(rows, { dimension: "label", value: NONE }), [])
})

check("桶按数量降序、名称升序、ID 升序稳定排序", () => {
  const a = { id: "a", name: "Same", color: "#112233" }
  const b = { ...a, id: "b" }
  const z = { ...a, id: "z", name: "Zebra" }
  const rows = [task("z1", { labels: [z] }), task("b", { labels: [b] }),
    task("a", { labels: [a] }), task("z2", { labels: [z] }), task("alpha", { labels: [alpha] })]
  assert.deepEqual(buildViewTaskStats(rows, "label").map((bucket) => bucket.value), ["z", "alpha", "a", "b"])
  assert.deepEqual(buildViewTaskStats([...rows].reverse(), "label"), buildViewTaskStats(rows, "label"))
})

check("完成状态和两个子任务开关所有组合与既有展示口径同序，ID 去重", () => {
  const rows = [
    task("root"), task("child", { parentId: "root" }),
    task("done", { status: "done" }), task("child-of-done", { parentId: "done" }),
    task("canceled", { status: "canceled" }), task("orphan", { parentId: "outside" }),
    task("root"),
  ]
  for (const showCompleted of ["all", "none"]) {
    for (const showSubIssues of [false, true]) {
      for (const nestedSubIssues of [false, true]) {
        const state = { ...newTaskDisplay(), showCompleted, showSubIssues, nestedSubIssues }
        const expected = [...new Set(ids(taskDisplayRows(applyShowCompleted(rows, showCompleted), showSubIssues)))]
        assert.deepEqual(ids(displayedTaskRows(rows, state)), expected)
      }
    }
  }
  assert.deepEqual(ids(displayedTaskRows(rows, { ...newTaskDisplay(), showCompleted: "none", showSubIssues: false })),
    ["root", "child-of-done", "orphan"])
})

check("分组、排序和可见列不改变统计锚点的输入序", () => {
  const rows = [task("z"), task("a")]
  const state = { ...newTaskDisplay(), grouping: "label", subGrouping: "project", orderField: "title", orderDir: "desc" }
  assert.deepEqual(ids(displayedTaskRows(rows, state)), ["z", "a"])
})

check("先 display 后钻取：关闭子任务时不能将命中子节点提升为根", () => {
  const rows = [task("parent", { assignee: alice }), task("child", { parentId: "parent", assignee: bob })]
  const selection = { dimension: "assignee", value: bob.id }
  const state = { ...newTaskDisplay(), showSubIssues: false }
  assert.deepEqual(selectViewTaskRows(displayedTaskRows(rows, state), selection), [])
  // 反例：先裁任务再算展示会错误地提升子节点。
  assert.deepEqual(ids(displayedTaskRows(selectViewTaskRows(rows, selection), state)), ["child"])
})

check("三个维度钻取保持展示序，null 原样返回，无匹配返回空数组", () => {
  const rows = [task("one", { assignee: alice, labels: [beta, alpha], project }),
    task("two", { assignee: bob }), task("three", { assignee: alice, labels: [alpha], project })]
  assert.equal(selectViewTaskRows(rows, null), rows)
  for (const [dimension, value] of [["assignee", alice.id], ["label", alpha.id], ["project", project.id]]) {
    assert.deepEqual(ids(selectViewTaskRows(rows, { dimension, value })), ["one", "three"])
    assert.deepEqual(selectViewTaskRows(rows, { dimension, value: "missing" }), [])
  }
})

check("统计与钻取不修改输入，独立钻取不缩减其它统计桶", () => {
  const one = Object.freeze(task("one", { assignee: alice, labels: Object.freeze([beta, alpha]) }))
  const rows = Object.freeze([one, Object.freeze(task("two", { assignee: bob }))])
  const state = Object.freeze(newTaskDisplay())
  const before = JSON.stringify(rows)
  const displayed = displayedTaskRows(rows, state)
  const stats = buildViewTaskStats(displayed, "assignee")
  assert.equal(selectViewTaskRows(displayed, { dimension: "assignee", value: bob.id }).length, 1)
  assert.deepEqual(buildViewTaskStats(displayed, "assignee"), stats)
  assert.equal(JSON.stringify(rows), before)
  assert.equal(displayed[0], one)
})

check("空任务集所有维度均返回空桶和空选择结果", () => {
  assert.deepEqual(displayedTaskRows([], newTaskDisplay()), [])
  for (const dimension of ["assignee", "label", "project"]) {
    assert.deepEqual(buildViewTaskStats([], dimension), [])
    assert.deepEqual(selectViewTaskRows([], { dimension, value: NONE }), [])
  }
})

const ctx = { memberIds: [alice.id, bob.id], projectIds: [project.id], labelIds: [alpha.id, beta.id] }
const anchorsFor = (rows, state, matchIds) =>
  taskDisplayRows(applyShowCompleted(rows, state.showCompleted), state.showSubIssues, matchIds)
const group = (nodes, value) => nodes.find((node) => node.value === value)

check("列表锚点与统计选择一致，先展示后匹配且对 ID 去重", () => {
  const parent = task("parent", { assignee: alice })
  const child = task("child", { parentId: "parent", assignee: bob })
  const rows = [parent, child, parent]
  for (const showSubIssues of [false, true]) {
    const state = { ...newTaskDisplay(), showSubIssues }
    for (const value of [alice.id, bob.id]) {
      const selected = selectViewTaskRows(displayedTaskRows(rows, state), { dimension: "assignee", value })
      const matchIds = new Set(ids(selected))
      assert.deepEqual(anchorsFor(rows, state, matchIds), selected)
    }
  }
  assert.deepEqual(taskDisplayRows(rows, false, new Set(["child", "outside"])), [])
})

check("树钻取保留当前任务内的祖先及锚点后代，剪掉祖先旁侧分支且只数锚点", () => {
  const rows = [task("parent"), task("anchor", { parentId: "parent", assignee: bob }),
    task("descendant", { parentId: "anchor" }), task("side", { parentId: "parent" })]
  const state = newTaskDisplay()
  const matchIds = new Set(["anchor"])
  const idx = buildTaskTreeIndex(rows)
  const anchors = anchorsFor(rows, state, matchIds)
  const nodes = buildTaskGroupsTree(rows, anchors, state, ctx, idx)
  const todo = group(nodes, "todo")
  assert.equal(todo.count, 1)
  assert.deepEqual(ids(todo.rows), ["parent"])
  assert.deepEqual([...todo.kept].sort(), ["anchor", "descendant", "parent"])
  const path = [{ field: "status", value: "todo" }]
  assert.equal(taskTreeRowDimmed(rows[0], state, idx.parentOf, path, matchIds), true)
  assert.equal(taskTreeRowDimmed(rows[1], state, idx.parentOf, path, matchIds), false)
  assert.equal(taskTreeRowDimmed(rows[2], state, idx.parentOf, path, matchIds), true)
})

check("无分组树同样保留灰上下文，平铺模式只展示锚点", () => {
  const rows = [task("parent"), task("anchor", { parentId: "parent" }),
    task("descendant", { parentId: "anchor" }), task("side", { parentId: "parent" })]
  const state = { ...newTaskDisplay(), grouping: "none" }
  const matchIds = new Set(["anchor"])
  const idx = buildTaskTreeIndex(rows)
  const anchors = anchorsFor(rows, state, matchIds)
  const kept = taskSpanKeptSet(idx, new Set(ids(anchors)), taskChildVisible(state.showCompleted))
  assert.deepEqual(ids(taskKeptRoots(rows, kept)), ["parent"])
  assert.deepEqual([...kept].sort(), ["anchor", "descendant", "parent"])
  assert.equal(taskTreeRowDimmed(rows[0], state, idx.parentOf, [], matchIds), true)
  assert.equal(taskTreeRowDimmed(rows[1], state, idx.parentOf, [], matchIds), false)
  assert.equal(taskTreeRowDimmed(rows[2], state, idx.parentOf, [], matchIds), true)
  assert.deepEqual(ids(anchorsFor(rows, { ...state, nestedSubIssues: false }, matchIds)), ["anchor"])
})

check("命中独立钻取仍须遵守完整组路径灰显，包含第二级分组", () => {
  const row = task("one", { assignee: alice, labels: [alpha, beta] })
  const idx = buildTaskTreeIndex([row])
  const state = newTaskDisplay()
  const matchIds = new Set([row.id])
  const path = [{ field: "status", value: "todo" }, { field: "assignee", value: alice.id }]
  assert.equal(taskTreeRowDimmed(row, state, idx.parentOf, path, matchIds), false)
  assert.equal(taskTreeRowDimmed(row, state, idx.parentOf,
    [{ field: "status", value: "todo" }, { field: "assignee", value: bob.id }], matchIds), true)
  assert.equal(taskTreeRowDimmed(row, state, idx.parentOf,
    [{ field: "status", value: "done" }, { field: "assignee", value: alice.id }], matchIds), true)
  assert.equal(taskTreeRowDimmed(row, state, idx.parentOf, [{ field: "label", value: beta.id }], matchIds), false)
})

check("隐藏完成任务时保留灰色祖先链，完成后代不作锚点且不计数", () => {
  const rows = [task("done-parent", { status: "done" }),
    task("anchor", { parentId: "done-parent" }),
    task("canceled-descendant", { parentId: "anchor", status: "canceled" })]
  const state = { ...newTaskDisplay(), showCompleted: "none" }
  const matchIds = new Set(["anchor"])
  const idx = buildTaskTreeIndex(rows)
  const nodes = buildTaskGroupsTree(rows, anchorsFor(rows, state, matchIds), state, ctx, idx)
  const todo = group(nodes, "todo")
  assert.equal(todo.count, 1)
  assert.deepEqual(ids(todo.rows), ["done-parent"])
  assert.deepEqual([...todo.kept].sort(), ["anchor", "done-parent"])
  assert.equal(taskTreeRowDimmed(rows[0], state, idx.parentOf, [], matchIds), true)
  assert.deepEqual(anchorsFor(rows, state, new Set(["canceled-descendant"])), [])
})

check("空 matchIds 或无效 ID 在所有展示模式下都为空，不回退到原任务", () => {
  const rows = [task("parent"), task("child", { parentId: "parent" })]
  const idx = buildTaskTreeIndex(rows)
  for (const showSubIssues of [false, true]) {
    for (const nestedSubIssues of [false, true]) {
      for (const showEmptyGroups of [false, true]) {
        const state = { ...newTaskDisplay(), showSubIssues, nestedSubIssues, showEmptyGroups }
        for (const matchIds of [new Set(), new Set(["outside"])]) {
          const anchors = anchorsFor(rows, state, matchIds)
          assert.deepEqual(anchors, [])
          const kept = taskSpanKeptSet(idx, new Set(ids(anchors)), taskChildVisible(state.showCompleted))
          assert.deepEqual(taskKeptRoots(rows, kept), [])
          for (const nodes of [buildTaskGroupsFlat(anchors, state, ctx), buildTaskGroupsTree(rows, anchors, state, ctx, idx)]) {
            assert.ok(nodes.every((node) => node.count === 0 && node.rows.length === 0))
          }
        }
      }
    }
  }
})

check("未传 matchIds 保持原展示及灰显规则，包括孤儿、完结态和跨组路径", () => {
  const rows = [task("parent"), task("child", { parentId: "parent" }),
    task("orphan", { parentId: "outside" }), task("done", { status: "done" })]
  const idx = buildTaskTreeIndex(rows)
  assert.equal(taskDisplayRows(rows, true), rows)
  assert.deepEqual(ids(taskDisplayRows(rows, false)), ["parent", "orphan", "done"])
  for (const showCompleted of ["none", "all"]) {
    const state = { ...newTaskDisplay(), showCompleted }
    for (const path of [[], [{ field: "status", value: "todo" }]]) {
      for (const row of rows) {
        const oldDim = (!!row.parentId && !idx.parentOf.has(row.parentId)) ||
          (showCompleted === "none" && ["done", "canceled"].includes(row.status)) ||
          path.some((p) => !taskRowGroupValues(row, p.field).includes(p.value))
        assert.equal(taskTreeRowDimmed(row, state, idx.parentOf, path), oldDim)
      }
    }
  }
})

check("组头仅在当前数小于基准数时展示 current/base", () => {
  assert.equal(taskGroupCountText(1, 3), "1/3")
  assert.equal(taskGroupCountText(0, 3), "0/3")
  assert.equal(taskGroupCountText(3, 3), "3")
  assert.equal(taskGroupCountText(4, 3), "4")
  assert.equal(taskGroupCountText(0, 0), "0")
  assert.equal(taskGroupCountText(2), "2")
})

check("两级分组基准按完整路径计数，同名二级组不跨一级合并", () => {
  const baseline = [task("todo-a1", { assignee: alice }), task("todo-a2", { assignee: alice }),
    task("todo-b", { assignee: bob }), task("done-a", { status: "done", assignee: alice })]
  const state = { ...newTaskDisplay(), subGrouping: "assignee" }
  const matchIds = new Set(["todo-a1", "done-a"])
  const current = buildTaskGroupsTree(baseline, anchorsFor(baseline, state, matchIds), state, ctx)
  const saved = buildTaskGroupsFlat(displayedTaskRows(baseline, state), state, ctx)
  const todo = group(current, "todo")
  const todoBase = group(saved, "todo")
  const done = group(current, "done")
  const doneBase = group(saved, "done")
  assert.equal(taskGroupCountText(todo.count, todoBase.count), "1/3")
  assert.equal(taskGroupCountText(group(todo.children, alice.id).count, group(todoBase.children, alice.id).count), "1/2")
  assert.equal(taskGroupCountText(group(done.children, alice.id).count, group(doneBase.children, alice.id).count), "1")
})

check("保存基准使用相同完成/子任务开关，不用未显示的任务扩大分母", () => {
  const baseline = [task("parent"), task("child", { parentId: "parent" }),
    task("other"), task("done", { status: "done" })]
  for (const showSubIssues of [false, true]) {
    const state = { ...newTaskDisplay(), showSubIssues, showCompleted: "none" }
    const current = buildTaskGroupsFlat(anchorsFor(baseline, state, new Set(["parent"])), state, ctx)
    const saved = buildTaskGroupsFlat(displayedTaskRows(baseline, state), state, ctx)
    assert.equal(group(saved, "done"), undefined)
    assert.equal(taskGroupCountText(group(current, "todo").count, group(saved, "todo").count), showSubIssues ? "1/3" : "1/2")
  }
})

check("基准存在的已过滤祖先不补入当前树，孤儿仍按原规则灰显", () => {
  const parent = task("filtered-parent", { assignee: alice })
  const child = task("child", { parentId: parent.id, assignee: bob })
  const baseline = [parent, child, task("extra")]
  const current = [child]
  const state = newTaskDisplay()
  const matchIds = new Set([child.id])
  const idx = buildTaskTreeIndex(current)
  const nodes = buildTaskGroupsTree(current, anchorsFor(current, state, matchIds), state, ctx, idx)
  const saved = buildTaskGroupsFlat(displayedTaskRows(baseline, state), state, ctx)
  const todo = group(nodes, "todo")
  assert.deepEqual(ids(todo.rows), [child.id])
  assert.deepEqual([...todo.kept], [child.id])
  assert.equal(taskGroupCountText(todo.count, group(saved, "todo").count), "1/3")
  assert.equal(taskTreeRowDimmed(child, state, idx.parentOf, [], matchIds), true)
  assert.equal(idx.parentOf.has(parent.id), false)
})

check("多标签任务分组与各维度统计同口径，所有分组路径的 flat/tree 计数一致", () => {
  const rows = [task("parent", { labels: [alpha, beta], assignee: alice, project }),
    task("child", { parentId: "parent", labels: [alpha], assignee: bob, status: "done" }),
    task("other", { labels: [beta], assignee: alice, priority: 1 }), task("empty")]
  const fields = ["status", "assignee", "project", "priority", "label"]
  const counts = (nodes) => nodes.map(({ field, value, count, children }) => ({ field, value, count, children: counts(children) }))
  for (const showCompleted of ["all", "none"]) {
    for (const grouping of fields) {
      for (const subGrouping of ["none", ...fields.filter((field) => field !== grouping)]) {
        const state = { ...newTaskDisplay(), showCompleted, grouping, subGrouping }
        const anchors = anchorsFor(rows, state, new Set(["parent", "child", "empty"]))
        const flat = buildTaskGroupsFlat(anchors, state, ctx)
        const tree = buildTaskGroupsTree(rows, anchors, state, ctx)
        assert.deepEqual(counts(tree), counts(flat))
        if (["assignee", "project", "label"].includes(grouping)) {
          for (const bucket of buildViewTaskStats(anchors, grouping)) {
            assert.equal(group(tree, bucket.value).count, bucket.count)
          }
        }
      }
    }
  }
})

check("保存吸收：当前条件与提交条件完全相同时全部清空", () => {
  const submitted = [
    { field: "status", op: "is", values: ["todo"] },
    { field: "assignee", op: "is", values: [alice.id] },
  ]
  const current = structuredClone(submitted).reverse()
  assert.deepEqual(remainingViewFilters(current, submitted), [])
})

check("保存吸收：等待期间新增的条件保留且维持当前顺序", () => {
  const submitted = [{ field: "status", op: "is", values: ["todo"] }]
  const addedBefore = { field: "priority", op: "is", values: ["1"] }
  const addedAfter = { field: "assignee", op: "is", values: [bob.id] }
  const current = [addedBefore, ...structuredClone(submitted), addedAfter]
  assert.deepEqual(remainingViewFilters(current, submitted), [addedBefore, addedAfter])
})

check("保存吸收：同 field 在等待期间改值后保留，仅清除未改写的提交条件", () => {
  const submitted = [
    { field: "status", op: "is", values: ["todo"] },
    { field: "assignee", op: "is", values: [alice.id] },
  ]
  const current = structuredClone(submitted)
  current[0].values = ["done"]
  assert.deepEqual(remainingViewFilters(current, submitted), [
    { field: "status", op: "is", values: ["done"] },
  ])
})

check("保存吸收：重复条件仅删除已提交次数，不误删剩余副本或其它条件", () => {
  const condition = { field: "status", op: "is", values: ["todo"] }
  const added = { field: "priority", op: "is", values: ["1"] }
  const current = [structuredClone(condition), added, structuredClone(condition), structuredClone(condition)]
  for (const count of [1, 2, 3, 4]) {
    const submitted = Array.from({ length: count }, () => structuredClone(condition))
    const remainingCopies = Array.from({ length: Math.max(0, 3 - count) }, () => structuredClone(condition))
    assert.deepEqual(remainingViewFilters(current, submitted), [added, ...remainingCopies])
  }
})

check("保存吸收：values 顺序不同视为同一条件，操作符不同则保留", () => {
  const submitted = [{ field: "status", op: "isAnyOf", values: ["todo", "done"] }]
  const changedOperator = { field: "status", op: "isNot", values: ["done", "todo"] }
  const current = [changedOperator, { field: "status", op: "isAnyOf", values: ["done", "todo"] }]
  assert.deepEqual(remainingViewFilters(current, submitted), [changedOperator])
})

check("保存吸收：不修改输入数组、条件对象或 values，重复调用结果一致", () => {
  const freezeConditions = (conditions) => Object.freeze(conditions.map((condition) =>
    Object.freeze({ ...condition, values: Object.freeze([...condition.values]) })))
  const current = freezeConditions([
    { field: "status", op: "isAnyOf", values: ["todo", "done", "canceled"] },
    { field: "assignee", op: "isAnyOf", values: [bob.id, alice.id] },
  ])
  const submitted = freezeConditions([
    { field: "status", op: "isAnyOf", values: ["done", "todo", "canceled"] },
  ])
  const currentBefore = structuredClone(current)
  const submittedBefore = structuredClone(submitted)
  assert.deepEqual(remainingViewFilters(current, submitted), [currentBefore[1]])
  assert.deepEqual(remainingViewFilters(current, submitted), [currentBefore[1]])
  assert.deepEqual(current, currentBefore)
  assert.deepEqual(submitted, submittedBefore)
})

check("保存吸收：空提交保留全部当前条件，空当前条件始终返回空数组", () => {
  const current = [
    { field: "status", op: "is", values: ["todo"] },
    { field: "status", op: "is", values: ["todo"] },
    { field: "assignee", op: "is", values: [alice.id] },
  ]
  assert.deepEqual(remainingViewFilters(current, []), structuredClone(current))
  assert.deepEqual(remainingViewFilters([], current), [])
  assert.deepEqual(remainingViewFilters([], []), [])
})

const emptyInput = {
  editor: false, savedView: false, hasTemporaryFilters: false, rawCount: 0, visibleCount: 0,
}

check("空态：有展示或选择结果时不显示空态，选择结果优先于并发不一致的计数", () => {
  for (const editor of [false, true]) {
    for (const savedView of [false, true]) {
      for (const hasTemporaryFilters of [false, true]) {
        const input = { ...emptyInput, editor, savedView, hasTemporaryFilters }
        assert.equal(resolveListEmptyState({ ...input, rawCount: 3, visibleCount: 2 }), null)
        assert.equal(resolveListEmptyState({ ...input, rawCount: 3, visibleCount: 2, selectedCount: 1 }), null)
        assert.equal(resolveListEmptyState({ ...input, selectedCount: 1 }), null)
      }
    }
  }
})

check("空态：展示集非空但统计选择为空时，selection 优先于草稿及临时筛选", () => {
  for (const editor of [false, true]) {
    for (const savedView of [false, true]) {
      for (const hasTemporaryFilters of [false, true]) {
        for (const baseline of [undefined, { rawCount: 5, visibleCount: 3 }]) {
          assert.deepEqual(resolveListEmptyState({
            ...emptyInput, editor, savedView, hasTemporaryFilters, baseline,
            rawCount: 3, visibleCount: 2, selectedCount: 0,
          }), { kind: "selection" })
        }
      }
    }
  }
})

check("空态：展示集本身为空不能归因于统计选择", () => {
  assert.deepEqual(resolveListEmptyState({ ...emptyInput, selectedCount: 0 }), { kind: "base" })
  assert.deepEqual(resolveListEmptyState({ ...emptyInput, rawCount: 3, selectedCount: 0 }), { kind: "display" })
  assert.deepEqual(resolveListEmptyState({
    ...emptyInput, hasTemporaryFilters: true, selectedCount: 0, baseline: { rawCount: 4, visibleCount: 2 },
  }), { kind: "temporary", hiddenCount: 2 })
})

check("空态：编辑草稿原始集为空时忽略浏览临时筛选、保存视图和基准", () => {
  for (const savedView of [false, true]) {
    for (const hasTemporaryFilters of [false, true]) {
      for (const baseline of [undefined, { rawCount: 0, visibleCount: 0 },
        { rawCount: 5, visibleCount: 0 }, { rawCount: 5, visibleCount: 3 }]) {
        assert.deepEqual(resolveListEmptyState({
          ...emptyInput, editor: true, savedView, hasTemporaryFilters, baseline,
        }), { kind: "draft" })
      }
    }
  }
})

check("空态：编辑草稿有原始数据但零展示时为 display，不错误引导调整 Filter", () => {
  for (const hasTemporaryFilters of [false, true]) {
    for (const baseline of [undefined, { rawCount: 0, visibleCount: 0 }, { rawCount: 5, visibleCount: 3 }]) {
      assert.deepEqual(resolveListEmptyState({
        ...emptyInput, editor: true, savedView: true, rawCount: 2, hasTemporaryFilters, baseline,
      }), { kind: "display" })
    }
  }
})

check("空态：非编辑临时基准未知时只返回泛化 filtered，不附加隐藏数量", () => {
  for (const savedView of [false, true]) {
    for (const rawCount of [0, 3]) {
      assert.deepEqual(resolveListEmptyState({
        ...emptyInput, savedView, rawCount, hasTemporaryFilters: true,
      }), { kind: "filtered" })
    }
  }
})

check("空态：异步基准由未知变为非空或本来为空时重新判定，不保留旧的隐藏数量", () => {
  const input = { ...emptyInput, savedView: true, hasTemporaryFilters: true }
  assert.deepEqual(resolveListEmptyState(input), { kind: "filtered" })
  assert.deepEqual(resolveListEmptyState({ ...input, baseline: { rawCount: 7, visibleCount: 3 } }),
    { kind: "temporary", hiddenCount: 3 })
  assert.deepEqual(resolveListEmptyState({ ...input, baseline: { rawCount: 0, visibleCount: 0 } }),
    { kind: "saved" })
  assert.deepEqual(resolveListEmptyState(input), { kind: "filtered" })
})

check("空态：当前零展示且同 Display 基准有展示时，hiddenCount 使用基准展示数而非原始数", () => {
  for (const savedView of [false, true]) {
    for (const rawCount of [0, 2]) {
      for (const visibleCount of [1, 4]) {
        assert.deepEqual(resolveListEmptyState({
          ...emptyInput, savedView, rawCount, hasTemporaryFilters: true,
          baseline: { rawCount: 8, visibleCount },
        }), { kind: "temporary", hiddenCount: visibleCount })
      }
    }
  }
})

check("空态：基准展示本来为空而原始集非空时为 display，不声称临时筛选隐藏数据", () => {
  for (const savedView of [false, true]) {
    for (const rawCount of [0, 3]) {
      assert.deepEqual(resolveListEmptyState({
        ...emptyInput, savedView, rawCount, hasTemporaryFilters: true,
        baseline: { rawCount: 5, visibleCount: 0 },
      }), { kind: "display" })
    }
  }
})

check("空态：临时基准原始集本来为空时按保存视图区分 saved 和 base", () => {
  for (const savedView of [false, true]) {
    assert.deepEqual(resolveListEmptyState({
      ...emptyInput, savedView, hasTemporaryFilters: true, baseline: { rawCount: 0, visibleCount: 0 },
    }), { kind: savedView ? "saved" : "base" })
  }
})

check("空态：并发导致基准原始集为空、当前原始集非空时优先 display，避免新建引导", () => {
  for (const savedView of [false, true]) {
    assert.deepEqual(resolveListEmptyState({
      ...emptyInput, savedView, rawCount: 2, hasTemporaryFilters: true,
      baseline: { rawCount: 0, visibleCount: 0 },
    }), { kind: "display" })
  }
})

check("空态：无临时筛选时有原始数据为 display，否则为 saved 或 base，忽略残留基准", () => {
  for (const savedView of [false, true]) {
    for (const baseline of [undefined, { rawCount: 0, visibleCount: 0 }, { rawCount: 8, visibleCount: 5 }]) {
      assert.deepEqual(resolveListEmptyState({ ...emptyInput, savedView, baseline }),
        { kind: savedView ? "saved" : "base" })
      assert.deepEqual(resolveListEmptyState({ ...emptyInput, savedView, baseline, rawCount: 3 }),
        { kind: "display" })
    }
  }
})

check("空态：临时隐藏计数按同 Display 且 ID 去重的集合计算，不累加多标签组头", () => {
  const parent = task("parent", { labels: [alpha, beta] })
  const rows = [parent, parent, task("child", { parentId: "parent", labels: [alpha] }),
    task("done", { status: "done", labels: [beta] })]
  for (const showSubIssues of [false, true]) {
    const state = { ...newTaskDisplay(), grouping: "label", showCompleted: "none", showSubIssues }
    const displayed = displayedTaskRows(rows, state)
    const buckets = buildTaskGroupsFlat(displayed, state, ctx)
    const expected = showSubIssues ? 2 : 1
    assert.equal(displayed.length, expected)
    assert.ok(buckets.reduce((sum, bucket) => sum + bucket.count, 0) > expected)
    assert.deepEqual(resolveListEmptyState({
      ...emptyInput, hasTemporaryFilters: true,
      baseline: { rawCount: new Set(ids(rows)).size, visibleCount: displayed.length },
    }), { kind: "temporary", hiddenCount: expected })
  }
})

check("空态：临时筛选下基准全部为被隐藏的完成任务时只返回 display", () => {
  const rows = [task("done", { status: "done" }), task("canceled", { status: "canceled" })]
  const state = { ...newTaskDisplay(), showCompleted: "none" }
  assert.deepEqual(resolveListEmptyState({
    ...emptyInput, hasTemporaryFilters: true,
    baseline: { rawCount: rows.length, visibleCount: displayedTaskRows(rows, state).length },
  }), { kind: "display" })
})

check("空态：不修改输入及基准，重复调用结果一致", () => {
  const input = Object.freeze({
    ...emptyInput, hasTemporaryFilters: true, baseline: Object.freeze({ rawCount: 5, visibleCount: 2 }),
  })
  const before = structuredClone(input)
  assert.deepEqual(resolveListEmptyState(input), { kind: "temporary", hiddenCount: 2 })
  assert.deepEqual(resolveListEmptyState(input), { kind: "temporary", hiddenCount: 2 })
  assert.deepEqual(input, before)
})

console.log(`统计独立测试：${passed} 项全部通过`)
