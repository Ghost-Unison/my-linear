package label

import (
	"github.com/Ghost-Unison/my-linear/myLinearBackEnd/internal/handler"
	"github.com/Ghost-Unison/my-linear/myLinearBackEnd/internal/store"
	"github.com/google/uuid"
)

// 创建标签
type CreateLabelDto struct {
	Name  string `json:"name"`
	Color string `json:"color"`
	Scope string `json:"scope"`
}

// 更新标签
type UpdateLabelDto struct {
	Name  handler.Nullable[string] `json:"name"`
	Color handler.Nullable[string] `json:"color"`
}

// 批量更新task或project标签（全量替换语义；api.md §1 camelCase）
type BatchUpdateLabelIDs struct {
	LabelIds handler.Nullable[[]uuid.UUID] `json:"labelIds"`
}

// 标签信息
type LabelRef struct {
	ID    uuid.UUID `json:"id"`
	Name  string    `json:"name"`
	Color string    `json:"color"`
}

type LabelRow struct {
	LabelRef
	Scope string `json:"scope"`
}

// NewLabelRef 由原子字段构造 LabelRef：不绑定任何 sqlc row 类型，
// 因此新增查询（如 task 侧 ListLabelsByTaskIdsRow）无需回到本包再加转换函数
func NewLabelRef(id uuid.UUID, name, color string) LabelRef {
	return LabelRef{
		ID:    id,
		Name:  name,
		Color: color,
	}
}

// ToLabelRefs 批量转换单实体查询结果（ListProjectLabels / ListTaskLabels 均返回 []store.Label）。
// 显式 make：零行时 sqlc 的 :many 方法返回 nil slice，序列化为 JSON null，
// 违反"空 labels 为 []"契约（api.md §4）
func ToLabelRefs(lbs []store.Label) []LabelRef {
	refs := make([]LabelRef, 0, len(lbs))
	for _, lb := range lbs {
		refs = append(refs, NewLabelRef(lb.ID, lb.Name, lb.Color))
	}
	return refs
}

// Label → LabelRow（标签管理区响应：LabelRef + scope）
func toLabelRow(lb store.Label) LabelRow {
	return LabelRow{
		LabelRef: NewLabelRef(lb.ID, lb.Name, lb.Color),
		Scope:    string(lb.Scope),
	}
}
