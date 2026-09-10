package project

import (
	"strconv"

	"github.com/Ghost-Unison/my-linear/myLinearBackEnd/internal/filter"
	"github.com/Ghost-Unison/my-linear/myLinearBackEnd/internal/store"

	"github.com/google/uuid"
)

// projectFilterSpecs 项目列表可过滤字段白名单（P2.md §2.2，Linear 实测真值表）：字段 → 值形态 + 值域校验。
// member 仅 contains 族两操作符且无 none 选项；labels 为四操作符族 + No labels 哨兵；
// 日期阶梯分方向：created/updated = ago 七档，start/target = from now（target 仅三档），
// start date 额外提供 No start date 空值条件
var projectFilterSpecs = map[string]filter.Spec{
	"status":     {Kind: filter.Single, Validate: func(v string) bool { return store.ProjectStatus(v).Valid() }},
	"priority":   {Kind: filter.Single, Validate: isPriority},
	"lead":       {Kind: filter.Single, AllowNone: true, Validate: isUUID},
	"member":     {Kind: filter.Multi, Ops: []string{"inclAny", "exclAny"}, Validate: isUUID},
	"labels":     {Kind: filter.Multi, AllowNone: true, Validate: isUUID},
	"startDate":  {Kind: filter.Day, AllowNone: true, FromNow: true},
	"targetDate": {Kind: filter.Day, FromNow: true, Ladders: []string{"3mo", "6mo", "1y"}},
	"createdAt":  {Kind: filter.Moment},
	"updatedAt":  {Kind: filter.Moment},
}

func isUUID(v string) bool { _, err := uuid.Parse(v); return err == nil }

func isPriority(v string) bool {
	n, err := strconv.Atoi(v)
	return err == nil && n >= 0 && n <= 4
}

// projectValGetter 装配过滤提取器：全部字段直读 ProjectRow（member 集合读行内嵌 Members，
// P2-B 行完备补入后无需另批量取 id 映射）
func projectValGetter() func(ProjectRow, string) filter.Val {
	return func(row ProjectRow, field string) filter.Val {
		switch field {
		case "status":
			return filter.Val{Single: row.Status}
		case "priority":
			return filter.Val{Single: strconv.Itoa(row.Priority)}
		case "lead":
			if row.Lead == nil {
				return filter.Val{Null: true}
			}
			return filter.Val{Single: row.Lead.ID.String()}
		case "member":
			// 无成员的项目取到 nil slice = 空集合（伪值 none 语义由引擎处理）
			set := make(map[string]struct{}, len(row.Members))
			for _, m := range row.Members {
				set[m.ID.String()] = struct{}{}
			}
			return filter.Val{Set: set}
		case "labels":
			set := make(map[string]struct{}, len(row.Labels))
			for _, l := range row.Labels {
				set[l.ID.String()] = struct{}{}
			}
			return filter.Val{Set: set}
		case "startDate":
			if row.StartDate == nil {
				return filter.Val{Null: true}
			}
			return filter.Val{D: *row.StartDate}
		case "targetDate":
			if row.TargetDate == nil {
				return filter.Val{Null: true}
			}
			return filter.Val{D: *row.TargetDate}
		case "createdAt":
			return filter.Val{T: row.CreatedAt}
		case "updatedAt":
			return filter.Val{T: row.UpdatedAt}
		}
		return filter.Val{}
	}
}
