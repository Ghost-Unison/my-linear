package task

import (
	"strconv"

	"github.com/Ghost-Unison/my-linear/myLinearBackEnd/internal/filter"
	"github.com/Ghost-Unison/my-linear/myLinearBackEnd/internal/store"

	"github.com/google/uuid"
)

// taskFilterSpecs 任务列表可过滤字段白名单（P2.md §2.2）：字段 → 值形态 + 值域校验。
// task 表无 start_date 列，Linear 的 Started date 裁剪（P2.md §2.2 注）
var taskFilterSpecs = map[string]filter.Spec{
	"status":    {Kind: filter.Single, Validate: func(v string) bool { return store.TaskStatus(v).Valid() }},
	"priority":  {Kind: filter.Single, Validate: isPriority},
	"assignee":  {Kind: filter.Single, AllowNone: true, Validate: isUUID},
	"project":   {Kind: filter.Single, AllowNone: true, Validate: isUUID},
	"labels":    {Kind: filter.Multi, AllowNone: true, Validate: isUUID},
	"dueDate":   {Kind: filter.Day},
	"createdAt": {Kind: filter.Moment},
	"updatedAt": {Kind: filter.Moment},
}

func isUUID(v string) bool { _, err := uuid.Parse(v); return err == nil }

func isPriority(v string) bool {
	n, err := strconv.Atoi(v)
	return err == nil && n >= 0 && n <= 4
}

// taskVal 从 TaskRow 提取过滤字段值（filter 引擎提取器契约，P2.md §2.5）。
// 可空字段 NULL → Val.Null（伪值 none 语义由引擎统一处理，P2.md §2.3）
func taskVal(row TaskRow, field string) filter.Val {
	switch field {
	case "status":
		return filter.Val{Single: row.Status}
	case "priority":
		return filter.Val{Single: strconv.Itoa(row.Priority)}
	case "assignee":
		if row.Assignee == nil {
			return filter.Val{Null: true}
		}
		return filter.Val{Single: row.Assignee.ID.String()}
	case "project":
		if row.Project == nil {
			return filter.Val{Null: true}
		}
		return filter.Val{Single: row.Project.ID.String()}
	case "labels":
		set := make(map[string]struct{}, len(row.Labels))
		for _, l := range row.Labels {
			set[l.ID.String()] = struct{}{}
		}
		return filter.Val{Set: set}
	case "dueDate":
		if row.DueDate == nil {
			return filter.Val{Null: true}
		}
		return filter.Val{D: *row.DueDate}
	case "createdAt":
		return filter.Val{T: row.CreatedAt}
	case "updatedAt":
		return filter.Val{T: row.UpdatedAt}
	}
	return filter.Val{}
}

// legacyStatusConds 遗留 filter= 参数 → 等价 status 条件（P2.md §2.5：仅当无 f= 时生效，
// 前端 tab 迁移 f= 后退役）。ok=false = 非法值，调用方 400
func legacyStatusConds(filterParam string) ([]filter.Cond, bool) {
	switch filterParam {
	case "active":
		return []filter.Cond{{Field: "status", Op: "anyOf", Values: []string{"todo", "in_progress"}, Kind: filter.Single}}, true
	case "backlog":
		return []filter.Cond{{Field: "status", Op: "anyOf", Values: []string{"backlog"}, Kind: filter.Single}}, true
	case "all":
		return nil, true
	}
	return nil, false
}
