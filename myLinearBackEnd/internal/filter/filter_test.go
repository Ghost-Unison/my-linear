package filter

import (
	"testing"
	"time"

	"cloud.google.com/go/civil"
)

// ---- Parse：三级白名单 ----

var testSpecs = map[string]Spec{
	"status":     {Kind: Single, Validate: func(v string) bool { return v == "todo" || v == "done" }},
	"assignee":   {Kind: Single, AllowNone: true, Validate: func(v string) bool { return v == "u1" }},
	"labels":     {Kind: Multi, AllowNone: true, Validate: func(v string) bool { return v == "l1" || v == "l2" }},
	"members":    {Kind: Multi, Ops: []string{"inclAny", "exclAny"}, Validate: func(v string) bool { return v == "u1" || v == "u2" }},
	"dueDate":    {Kind: Day, FromNow: true, Ladders: []string{"1d", "3d", "1w", "1mo", "3mo"}, AllowNone: true, AllowOverdue: true},
	"startDate":  {Kind: Day, AllowNone: true, FromNow: true},
	"targetDate": {Kind: Day, FromNow: true, Ladders: []string{"3mo", "6mo", "1y"}},
	"createdAt":  {Kind: Moment},
}

func TestParseWhitelist(t *testing.T) {
	got := Parse([]string{
		"status.is.todo",           // 合法
		"status.isAnyOf.todo,done", // 合法多值
		"assignee.is.none",         // 合法哨兵
		"labels.inclAll.l1,l2",     // 合法四操作符族
		"members.inclAny.u1",       // 合法（Ops 覆写白名单）
		"dueDate.before.1w",        // 合法阶梯码（from now 方向，白名单内）
		"dueDate.is.overdue",       // 合法逾期谓词（is 承载）
		"dueDate.is.none",          // 合法空值条件（No due date）
		"startDate.after.1mo",      // 合法阶梯码（from now 方向）
		"startDate.is.none",        // 合法空值条件（No start date）
		"targetDate.before.3mo",    // 合法 target 三档
		"bogus.is.x",               // 字段不命中 → 丢弃
		"status.like.todo",         // 操作符与 Kind 不匹配 → 丢弃
		"status.is.in_progress",    // 值域不命中 → 丢弃
		"assignee.is.none,u1",      // 单值字段哨兵混选真实值合法
		"labels.is.l1",             // Multi 不支持 is → 丢弃
		"members.inclAll.u1",       // members 仅 contains 族 → 丢弃
		"dueDate.before.2w",        // 阶梯码不命中 → 丢弃
		"targetDate.before.1d",     // target 阶梯白名单不命中 → 丢弃
		"createdAt.is.none",        // createdAt 不提供 none → 丢弃
		"dueDate.is.1w",            // is 仅承载 none/overdue → 丢弃
		"dueDate.before.overdue",   // overdue 仅 is/isNot 承载 → 丢弃
		"startDate.is.overdue",     // startDate 不提供 overdue → 丢弃
		"dueDate.before.1w,3d",     // 日期条件须单值 → 丢弃
		"status.is",                // 不足三段 → 丢弃
		"status.is.",               // 空值 → 丢弃
	}, testSpecs)

	want := []Cond{
		{Field: "status", Op: "is", Values: []string{"todo"}, Kind: Single},
		{Field: "status", Op: "isAnyOf", Values: []string{"todo", "done"}, Kind: Single},
		{Field: "assignee", Op: "is", Values: []string{None}, Kind: Single},
		{Field: "labels", Op: "inclAll", Values: []string{"l1", "l2"}, Kind: Multi},
		{Field: "members", Op: "inclAny", Values: []string{"u1"}, Kind: Multi},
		{Field: "dueDate", Op: "before", Values: []string{"1w"}, Kind: Day, FromNow: true},
		{Field: "dueDate", Op: "is", Values: []string{Overdue}, Kind: Day, FromNow: true},
		{Field: "dueDate", Op: "is", Values: []string{None}, Kind: Day, FromNow: true},
		{Field: "startDate", Op: "after", Values: []string{"1mo"}, Kind: Day, FromNow: true},
		{Field: "startDate", Op: "is", Values: []string{None}, Kind: Day, FromNow: true},
		{Field: "targetDate", Op: "before", Values: []string{"3mo"}, Kind: Day, FromNow: true},
		{Field: "assignee", Op: "is", Values: []string{None, "u1"}, Kind: Single},
	}
	if len(got) != len(want) {
		t.Fatalf("Parse 条数 = %d, want %d: %+v", len(got), len(want), got)
	}
	for i := range want {
		if got[i].Field != want[i].Field || got[i].Op != want[i].Op || got[i].Kind != want[i].Kind || got[i].FromNow != want[i].FromNow {
			t.Errorf("cond[%d] = %+v, want %+v", i, got[i], want[i])
		}
		if len(got[i].Values) != len(want[i].Values) {
			t.Errorf("cond[%d].Values = %v, want %v", i, got[i].Values, want[i].Values)
			continue
		}
		for j := range want[i].Values {
			if got[i].Values[j] != want[i].Values[j] {
				t.Errorf("cond[%d].Values = %v, want %v", i, got[i].Values, want[i].Values)
				break
			}
		}
	}
}

// ---- Apply：单值操作符 ----

type row struct {
	status   string
	assignee *string // nil = NULL
	labels   []string
	due      *civil.Date
	start    *civil.Date
	created  time.Time
}

func str(s string) *string { return &s }

func getter(r row, field string) Val {
	switch field {
	case "status":
		return Val{Single: r.status}
	case "assignee":
		if r.assignee == nil {
			return Val{Null: true}
		}
		return Val{Single: *r.assignee}
	case "labels":
		set := make(map[string]struct{}, len(r.labels))
		for _, l := range r.labels {
			set[l] = struct{}{}
		}
		return Val{Set: set}
	case "dueDate":
		if r.due == nil {
			return Val{Null: true}
		}
		return Val{D: *r.due}
	case "startDate":
		if r.start == nil {
			return Val{Null: true}
		}
		return Val{D: *r.start}
	case "createdAt":
		return Val{T: r.created}
	}
	return Val{}
}

func applyOne(t *testing.T, cond Cond, rows []row, now time.Time) []row {
	t.Helper()
	return Apply(rows, []Cond{cond}, getter, now)
}

func TestSingleOps(t *testing.T) {
	rows := []row{
		{status: "todo", assignee: str("u1")},
		{status: "done", assignee: nil},
		{status: "todo", assignee: str("u2")},
	}

	// is 单选等值
	if got := applyOne(t, Cond{Field: "status", Op: "is", Values: []string{"todo"}, Kind: Single}, rows, time.Now()); len(got) != 2 {
		t.Errorf("status is todo → %d 行, want 2", len(got))
	}
	// isAnyOf 多选 OR
	if got := applyOne(t, Cond{Field: "status", Op: "isAnyOf", Values: []string{"todo", "done"}, Kind: Single}, rows, time.Now()); len(got) != 3 {
		t.Errorf("status isAnyOf todo,done → %d 行, want 3", len(got))
	}
	// assignee is none → 仅 NULL 行
	if got := applyOne(t, Cond{Field: "assignee", Op: "is", Values: []string{None}, Kind: Single}, rows, time.Now()); len(got) != 1 || got[0].status != "done" {
		t.Errorf("assignee is none → %+v, want 仅 done 行", got)
	}
	// assignee isNot u1 → u2 行 + NULL 行（none ∉ 集合时 NULL 包含）
	if got := applyOne(t, Cond{Field: "assignee", Op: "isNot", Values: []string{"u1"}, Kind: Single}, rows, time.Now()); len(got) != 2 {
		t.Errorf("assignee isNot u1 → %d 行, want 2（u2 + NULL）", len(got))
	}
	// assignee isNot u1,none → 仅 u2 行（none ∈ 集合时 NULL 排除）
	if got := applyOne(t, Cond{Field: "assignee", Op: "isNot", Values: []string{"u1", None}, Kind: Single}, rows, time.Now()); len(got) != 1 || *got[0].assignee != "u2" {
		t.Errorf("assignee isNot u1,none → %+v, want 仅 u2 行", got)
	}
}

// ---- Apply：多值集合操作符（四操作符族 + contains 族） ----

func TestMultiOps(t *testing.T) {
	rows := []row{
		{labels: []string{"l1"}},
		{labels: []string{"l2", "l3"}},
		{labels: nil}, // 空集合 → 伪值集 {none}
	}

	// inclAll l1 → 所选 ⊆ 行集合
	if got := applyOne(t, Cond{Field: "labels", Op: "inclAll", Values: []string{"l1"}, Kind: Multi}, rows, time.Now()); len(got) != 1 {
		t.Errorf("labels inclAll l1 → %d 行, want 1", len(got))
	}
	// inclAll l1,l2 → 无行同时含两者
	if got := applyOne(t, Cond{Field: "labels", Op: "inclAll", Values: []string{"l1", "l2"}, Kind: Multi}, rows, time.Now()); len(got) != 0 {
		t.Errorf("labels inclAll l1,l2 → %d 行, want 0", len(got))
	}
	// inclAny l1,l2 → 任一交集即命中
	if got := applyOne(t, Cond{Field: "labels", Op: "inclAny", Values: []string{"l1", "l2"}, Kind: Multi}, rows, time.Now()); len(got) != 2 {
		t.Errorf("labels inclAny l1,l2 → %d 行, want 2", len(got))
	}
	// inclAny none → 仅空集合行
	if got := applyOne(t, Cond{Field: "labels", Op: "inclAny", Values: []string{None}, Kind: Multi}, rows, time.Now()); len(got) != 1 || len(got[0].labels) != 0 {
		t.Errorf("labels inclAny none → %+v, want 仅空集合行", got)
	}
	// inclAll none → 空集合行（伪值集 {none} ⊇ {none}）
	if got := applyOne(t, Cond{Field: "labels", Op: "inclAll", Values: []string{None}, Kind: Multi}, rows, time.Now()); len(got) != 1 {
		t.Errorf("labels inclAll none → %d 行, want 1", len(got))
	}
	// exclAny l1 → 无交集行（含空集合行）
	if got := applyOne(t, Cond{Field: "labels", Op: "exclAny", Values: []string{"l1"}, Kind: Multi}, rows, time.Now()); len(got) != 2 {
		t.Errorf("labels exclAny l1 → %d 行, want 2（l2l3 行 + 空集合行）", len(got))
	}
	// exclAny l1,none → 额外排除空集合行
	if got := applyOne(t, Cond{Field: "labels", Op: "exclAny", Values: []string{"l1", None}, Kind: Multi}, rows, time.Now()); len(got) != 1 || len(got[0].labels) != 2 {
		t.Errorf("labels exclAny l1,none → %+v, want 仅 l2l3 行", got)
	}
	// exclAll l1 → 非（所选 ⊆ 行集合）：l2l3 行 + 空集合行
	if got := applyOne(t, Cond{Field: "labels", Op: "exclAll", Values: []string{"l1"}, Kind: Multi}, rows, time.Now()); len(got) != 2 {
		t.Errorf("labels exclAll l1 → %d 行, want 2", len(got))
	}
	// 重复 inclAll 条件的 AND 不可折叠语义：inclAll l1 ∧ inclAll l2 → 0 行
	twice := []Cond{
		{Field: "labels", Op: "inclAll", Values: []string{"l1"}, Kind: Multi},
		{Field: "labels", Op: "inclAll", Values: []string{"l2"}, Kind: Multi},
	}
	if got := Apply(rows, twice, getter, time.Now()); len(got) != 0 {
		t.Errorf("inclAll l1 AND inclAll l2 → %d 行, want 0（AND 非 OR）", len(got))
	}
}

// ---- Apply：日期阶梯（ago / from now 双方向 + 空值条件） ----

func TestDateOps(t *testing.T) {
	now := time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC)
	old := civil.Date{Year: 2026, Month: 8, Day: 1}    // 38 天前
	mid := civil.Date{Year: 2026, Month: 9, Day: 3}    // 5 天前
	recent := civil.Date{Year: 2026, Month: 9, Day: 7} // 1 天前
	rows := []row{
		{due: &old}, {due: &mid}, {due: &recent}, {due: nil},
	}

	// dueDate（ago 方向）before 1w → 早于 7 天前的 cutoff(9/1)：old(8/1) 命中；NULL 不参与
	if got := applyOne(t, Cond{Field: "dueDate", Op: "before", Values: []string{"1w"}, Kind: Day}, rows, now); len(got) != 1 || *got[0].due != old {
		t.Errorf("dueDate before 1w → %+v, want 仅 8/1 行", got)
	}
	// dueDate after 1w → 晚于 cutoff：mid(9/3)、recent(9/7) 命中（"近一周内"语义）
	if got := applyOne(t, Cond{Field: "dueDate", Op: "after", Values: []string{"1w"}, Kind: Day}, rows, now); len(got) != 2 {
		t.Errorf("dueDate after 1w → %d 行, want 2", len(got))
	}

	// startDate（from now 方向）：cutoff = now + 偏移
	near := civil.Date{Year: 2026, Month: 9, Day: 20} // 12 天后
	far := civil.Date{Year: 2027, Month: 1, Day: 15}  // 约 4 个月后
	startRows := []row{{start: &near}, {start: &far}, {start: nil}}
	// before 1mo → 早于 cutoff(10/8)：near 命中（"未来一月内"语义）；NULL 不参与
	if got := applyOne(t, Cond{Field: "startDate", Op: "before", Values: []string{"1mo"}, Kind: Day, FromNow: true}, startRows, now); len(got) != 1 || *got[0].start != near {
		t.Errorf("startDate before 1mo(fromNow) → %+v, want 仅 9/20 行", got)
	}
	// before 6mo → cutoff 2027/3/8：near、far 均命中
	if got := applyOne(t, Cond{Field: "startDate", Op: "before", Values: []string{"6mo"}, Kind: Day, FromNow: true}, startRows, now); len(got) != 2 {
		t.Errorf("startDate before 6mo(fromNow) → %d 行, want 2", len(got))
	}
	// after 1mo → 晚于 cutoff(10/8)：far 命中
	if got := applyOne(t, Cond{Field: "startDate", Op: "after", Values: []string{"1mo"}, Kind: Day, FromNow: true}, startRows, now); len(got) != 1 || *got[0].start != far {
		t.Errorf("startDate after 1mo(fromNow) → %+v, want 仅 1/15 行", got)
	}
	// startDate is none → 仅 NULL 行（No start date）
	if got := applyOne(t, Cond{Field: "startDate", Op: "is", Values: []string{None}, Kind: Day, FromNow: true}, startRows, now); len(got) != 1 || got[0].start != nil {
		t.Errorf("startDate is none → %+v, want 仅 NULL 行", got)
	}
	// startDate isNot none → 仅非 NULL 行
	if got := applyOne(t, Cond{Field: "startDate", Op: "isNot", Values: []string{None}, Kind: Day, FromNow: true}, startRows, now); len(got) != 2 {
		t.Errorf("startDate isNot none → %d 行, want 2", len(got))
	}

	// Moment（ago 方向）：createdAt before 3d
	createdRows := []row{
		{created: now.Add(-72 * time.Hour)}, // 恰在 cutoff 上 → Before 为 false
		{created: now.Add(-73 * time.Hour)}, // 早于 cutoff → 命中
		{created: now.Add(-1 * time.Hour)},
	}
	if got := applyOne(t, Cond{Field: "createdAt", Op: "before", Values: []string{"3d"}, Kind: Moment}, createdRows, now); len(got) != 1 {
		t.Errorf("createdAt before 3d → %d 行, want 1", len(got))
	}
}

// ---- Apply：Overdue 逾期谓词（is/isNot 承载） ----

func TestOverdue(t *testing.T) {
	now := time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC)
	past := civil.Date{Year: 2026, Month: 9, Day: 1}
	today := civil.Date{Year: 2026, Month: 9, Day: 8}
	future := civil.Date{Year: 2026, Month: 9, Day: 15}
	rows := []row{{due: &past}, {due: &today}, {due: &future}, {due: nil}}

	// is overdue → 非空且早于今天：仅 past
	if got := applyOne(t, Cond{Field: "dueDate", Op: "is", Values: []string{Overdue}, Kind: Day}, rows, now); len(got) != 1 || *got[0].due != past {
		t.Errorf("dueDate is overdue → %+v, want 仅 9/1 行", got)
	}
	// isNot overdue → 今天/未来/NULL 行
	if got := applyOne(t, Cond{Field: "dueDate", Op: "isNot", Values: []string{Overdue}, Kind: Day}, rows, now); len(got) != 3 {
		t.Errorf("dueDate isNot overdue → %d 行, want 3（今天+未来+NULL）", len(got))
	}
}

// ---- Apply：条件间 AND 与空条件 ----

func TestApplyAndSemantics(t *testing.T) {
	rows := []row{
		{status: "todo", assignee: str("u1")},
		{status: "done", assignee: str("u1")},
		{status: "todo", assignee: nil},
	}
	conds := []Cond{
		{Field: "status", Op: "is", Values: []string{"todo"}, Kind: Single},
		{Field: "assignee", Op: "is", Values: []string{"u1"}, Kind: Single},
	}
	if got := Apply(rows, conds, getter, time.Now()); len(got) != 1 || got[0].status != "todo" || *got[0].assignee != "u1" {
		t.Errorf("AND 求值 → %+v, want 仅 todo+u1 行", got)
	}
	if got := Apply(rows, nil, getter, time.Now()); len(got) != 3 {
		t.Errorf("空条件 → %d 行, want 原样返回", len(got))
	}
}
