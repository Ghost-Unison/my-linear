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
	LabelIDs handler.Nullable[[]uuid.UUID] `json:"labelIds"`
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

func toLabelRow(lb store.Label) LabelRow {
	return LabelRow{
		LabelRef: LabelRef{
			ID:    lb.ID,
			Name:  lb.Name,
			Color: lb.Color,
		},
		Scope: string(lb.Scope),
	}
}
