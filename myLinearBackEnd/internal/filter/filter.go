// Package filter P2 条件列表过滤引擎（P2.md §2.5）。
//
// 求值层在 Go 内存而非 SQL：条件列表模型条数动态（同字段可重复出现），sqlc 固定形状查询
// 无法承载；多值字段重复 include 条件的 AND 无法折叠为单个数组参数；不分页前提下全量行集
// 本就取回内存，与既有"动态排序放 Go 层"约定（api.md §2.2）同构。
// Parse 负责 f= 查询参数 → 条件列表（字段/操作符/值三级白名单，非法条目静默丢弃）；
// Apply 负责条件间 AND 求值；行值提取由实体包以提取器回调注入（各包自知行形状）。
package filter

import (
	"slices"
	"strings"
	"time"

	"cloud.google.com/go/civil"
)

// Kind 字段值形态，决定操作符清单与求值分支
type Kind int

const (
	Single Kind = iota // 单值：枚举 / priority / 可空 uuid；取 Val.Single + Val.Null
	Multi              // 多值集合：labels / member；取 Val.Set
	Moment             // timestamptz：createdAt / updatedAt；取 Val.T
	Day                // date：dueDate / startDate / targetDate；取 Val.D
)

// KindOps 各 Kind 的操作符清单（P2.md §1.6 v2，Linear 实测真值）：操作符集合随选中值个数
// 由 UI 层联动展示（单值 1 值 is/is not、≥2 值 is any of/is not；labels 族 1 值 include/do not
// include、≥2 值四操作符），引擎按 Kind 接受全量集合；Day/Moment 的 is/isNot 仅承载 none 空值条件。
// members 字段仅 contains 族两操作符，经 Spec.Ops 覆写白名单
var KindOps = map[Kind][]string{
	Single: {"is", "isNot", "isAnyOf"},
	Multi:  {"inclAll", "inclAny", "exclAny", "exclAll"},
	Moment: {"before", "after", "is", "isNot"},
	Day:    {"before", "after", "is", "isNot"},
}

// None 空伪值哨兵（P2.md §2.3）：wire 上代表 NULL / 空集合
const None = "none"

// Overdue 逾期谓词码（P2.md §2.4，仅 dueDate 提供）：wire 上由 is/isNot 承载
// （is = 已逾期 = 非空且早于今天），不参与 before/after 阶梯比较
const Overdue = "overdue"

// ladder 相对阶梯码 → (月, 天)，ago 语义（P2.md §2.4，对齐 Linear 实测档位）
var ladder = map[string][2]int{
	"1d": {0, 1}, "3d": {0, 3}, "1w": {0, 7},
	"1mo": {1, 0}, "3mo": {3, 0}, "6mo": {6, 0}, "1y": {12, 0},
}

// Spec 字段白名单条目，由实体包按可过滤字段装配（P2.md §2.2）
// 每个类型只在交界处出现，引擎和业务互相只通过 Spec/Val 这两个"插槽"说话
type Spec struct {
	Kind Kind
	// AllowNone 值选择器是否提供空伪值 none（可空单值与多值字段为 true；日期字段仅 start date 为 true）
	AllowNone bool
	// AllowOverdue 是否提供逾期谓词 Overdue（仅 dueDate；is/isNot 承载）
	AllowOverdue bool
	// Ops 非空时覆写 KindOps[Kind] 操作符白名单（members 字段仅 inclAny/exclAny 两操作符）
	Ops []string
	// Ladders 非空时覆写全量阶梯白名单（target date 仅未来三档）
	Ladders []string
	// FromNow 阶梯方向：true = from now 未来偏移（start/target date），false = ago 过去偏移
	FromNow bool
	// Validate 校验单个非 none 值（枚举域 / priority 范围 / uuid 格式）；nil = 仅非空检查
	Validate func(string) bool
}

// Cond 一条过滤条件，wire 形态 f=<Field>.<Op>.<v1,v2>；同字段可重复（P2.md §1.7）
type Cond struct {
	Field  string
	Op     string
	Values []string
	Kind   Kind
	// FromNow 阶梯方向快照（Parse 时由 Spec 填入，match 算 cutoff 符号用）
	FromNow bool
}

// Val 提取器为某行某字段取出的值，只填与 Spec.Kind 匹配的分支
type Val struct {
	Single string
	Null   bool
	Set    map[string]struct{}
	T      time.Time
	D      civil.Date
}

// Parse f= 查询参数数组 → 条件列表。三级白名单（字段 / 操作符 / 值）任一不命中即静默丢弃该条、不整体报错：URL 可分享可书签，须对过期/手改参数健壮（P2.md §2.5）
func Parse(params []string, specs map[string]Spec) []Cond {
	conds := make([]Cond, 0, len(params))
	for _, p := range params {
		//参数构成校验
		parts := strings.SplitN(p, ".", 3)
		if len(parts) != 3 {
			continue
		}
		// 字段合法操作校验（Spec.Ops 可覆写 Kind 全量清单）
		spec, ok := specs[parts[0]]
		if !ok {
			continue
		}
		ops := spec.Ops
		if ops == nil {
			ops = KindOps[spec.Kind]
		}
		if !slices.Contains(ops, parts[1]) {
			continue
		}
		// 值合法校验
		values := strings.Split(parts[2], ",")
		if !validValues(spec, parts[1], values) {
			continue
		}
		conds = append(conds, Cond{Field: parts[0], Op: parts[1], Values: values, Kind: spec.Kind, FromNow: spec.FromNow})
	}
	return conds
}

func validValues(spec Spec, op string, values []string) bool {
	if spec.Kind == Moment || spec.Kind == Day {
		// 日期条件单值：none 空值（仅 is/isNot 且字段提供 none，如 No start date）或相对阶梯码
		if len(values) != 1 {
			return false
		}
		if values[0] == None {
			return spec.AllowNone && (op == "is" || op == "isNot")
		}
		if values[0] == Overdue {
			return spec.AllowOverdue && (op == "is" || op == "isNot")
		}
		if op != "before" && op != "after" {
			return false
		}
		if _, ok := ladder[values[0]]; !ok {
			return false
		}
		return spec.Ladders == nil || slices.Contains(spec.Ladders, values[0])
	}
	for _, v := range values {
		if v == "" {
			return false
		}
		if v == None {
			if !spec.AllowNone {
				return false
			}
			continue
		}
		if spec.Validate != nil && !spec.Validate(v) {
			return false
		}
	}
	return true
}

// Apply 条件间 AND 过滤；get 按条件字段提取行值（实体包提供；未知字段返回零值 Val）
func Apply[T any](rows []T, conds []Cond, get func(T, string) Val, now time.Time) []T {
	if len(conds) == 0 {
		return rows
	}
	out := make([]T, 0, len(rows))
	//遍历原始结果
	for _, row := range rows {
		keep := true
		//遍历条件
		for _, cd := range conds {
			//get从行中提取字段值 - 以filter.Val的格式
			// match将提取的字段值与条件进行匹配
			if !match(cd, get(row, cd.Field), now) {
				keep = false
				break
			}
		}
		if keep {
			out = append(out, row)
		}
	}
	return out
}

func match(cd Cond, v Val, now time.Time) bool {
	switch cd.Op {
	case "is", "isAnyOf": // 值 ∈ 集合；NULL 行按伪值判定（none ∈ 集合才命中）
		if cd.Kind == Single {
			if v.Null {
				return slices.Contains(cd.Values, None)
			}
			return slices.Contains(cd.Values, v.Single)
		}
		// Day/Moment 的 is 仅承载 none 空值条件与 Overdue 谓词
		return dayIs(cd, v, now)
	case "isNot": // 值 ∉ 集合；none ∉ 集合时 NULL 行包含（"assignee 不是 Lee" 含未指派，P2.md §2.3）
		if cd.Kind == Single {
			if v.Null {
				return !slices.Contains(cd.Values, None)
			}
			return !slices.Contains(cd.Values, v.Single)
		}
		return !dayIs(cd, v, now)
	case "inclAll": // 所选集合 ⊆ 行集合（含 none 时要求行集合恰为空）
		return subsetOf(cd.Values, rowSet(v))
	case "inclAny": // 所选集合 ∩ 行集合 ≠ ∅
		return intersects(cd.Values, rowSet(v))
	case "exclAny": // 所选集合 ∩ 行集合 = ∅
		return !intersects(cd.Values, rowSet(v))
	case "exclAll": // 所选集合 ⊄ 行集合
		return !subsetOf(cd.Values, rowSet(v))
	case "before", "after":
		if v.Null {
			return false // 日期空值不参与 before/after（P2.md §2.3 扩展点登记）
		}
		return compareDate(cd, v, now)
	}
	return false
}

// dayIs Day 字段 is 分支命中：Overdue 谓词 = 非空且早于今天；否则 none 空值（NULL 行）
func dayIs(cd Cond, v Val, now time.Time) bool {
	if cd.Values[0] == Overdue {
		return !v.Null && v.D.Before(civil.DateOf(now))
	}
	return v.Null && slices.Contains(cd.Values, None)
}

// rowSet 多值行集合：空集合折叠为伪值集 {none}，使 none 参与统一集合运算
func rowSet(v Val) map[string]struct{} {
	if len(v.Set) == 0 {
		return map[string]struct{}{None: {}}
	}
	return v.Set
}

func subsetOf(values []string, set map[string]struct{}) bool {
	for _, v := range values {
		if _, ok := set[v]; !ok {
			return false
		}
	}
	return true
}

func intersects(values []string, set map[string]struct{}) bool {
	for _, v := range values {
		if _, ok := set[v]; ok {
			return true
		}
	}
	return false
}

// compareDate cutoff = now/today ± 阶梯偏移（Go 层算，P2.md §2.4；符号由 Cond.FromNow 方向决定：
// ago = 过去偏移、from now = 未来偏移）；before = 早于 cutoff、after = 晚于 cutoff
func compareDate(cd Cond, v Val, now time.Time) bool {
	months, days := ladder[cd.Values[0]][0], ladder[cd.Values[0]][1]
	if !cd.FromNow {
		months, days = -months, -days
	}
	if cd.Kind == Moment {
		cutoff := now.AddDate(0, months, days)
		if cd.Op == "before" {
			return v.T.Before(cutoff)
		}
		return v.T.After(cutoff)
	}
	cutoff := civil.DateOf(now).AddMonths(months).AddDays(days)
	if cd.Op == "before" {
		return v.D.Before(cutoff)
	}
	return v.D.After(cutoff)
}
