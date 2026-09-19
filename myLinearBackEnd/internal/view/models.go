package view

import (
	"encoding/json"
	"time"

	"github.com/Ghost-Unison/my-linear/myLinearBackEnd/internal/handler"
	"github.com/Ghost-Unison/my-linear/myLinearBackEnd/internal/store"
	"github.com/google/uuid"
)

// 创建视图（api.md §10 / P2.md §4.3）
type CreateViewDto struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Surface     string          `json:"surface"`
	EntityType  string          `json:"entityType"`
	ProjectID   *uuid.UUID      `json:"projectId"`
	Config      json.RawMessage `json:"config"`
}

// 更新视图（name / description / config presence 三态）
type UpdateViewDto struct {
	Name        handler.Nullable[string]          `json:"name"`
	Description handler.Nullable[string]          `json:"description"`
	Config      handler.Nullable[json.RawMessage] `json:"config"`
}

// ViewRow 视图响应行：config 原样透传（后端 opaque，P2.md §4.2），
// 字段 camelCase 与 api.md §1 一致
type ViewRow struct {
	ID          uuid.UUID       `json:"id"`
	WorkspaceID uuid.UUID       `json:"workspaceId"`
	EntityType  string          `json:"entityType"`
	Surface     string          `json:"surface"`
	ProjectID   *uuid.UUID      `json:"projectId"`
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Config      json.RawMessage `json:"config"`
	CreatedAt   time.Time       `json:"createdAt"`
	UpdatedAt   time.Time       `json:"updatedAt"`
}

func toViewRow(v store.SavedView) ViewRow {
	return ViewRow{
		ID:          v.ID,
		WorkspaceID: v.WorkspaceID,
		EntityType:  string(v.EntityType),
		Surface:     string(v.Surface),
		ProjectID:   v.ProjectID,
		Name:        v.Name,
		Description: v.Description,
		Config:      v.Config,
		CreatedAt:   v.CreatedAt,
		UpdatedAt:   v.UpdatedAt,
	}
}

func toViewRows(vs []store.SavedView) []ViewRow {
	resp := make([]ViewRow, 0, len(vs))
	for _, v := range vs {
		resp = append(resp, toViewRow(v))
	}
	return resp
}
