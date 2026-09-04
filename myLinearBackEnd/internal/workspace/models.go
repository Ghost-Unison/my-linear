package workspace

import (
	"time"

	"github.com/google/uuid"

	"mylinear/internal/handler"
	"mylinear/internal/store"
)

// CreateWorkspaceDTO 创建工作区请求体（api.md：name 必填，description 可选）
type CreateWorkspaceDTO struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

// WorkspaceResp 对外响应模型：api.md 约定 JSON 字段 camelCase，
// 而 sqlc 生成的 store.Workspace 带 snake_case 标签，须经 toResp 转换后返回。
type WorkspaceResp struct {
	ID          uuid.UUID `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// toResp 将 sqlc 查询结果转为对外响应模型
func toResp(ws store.Workspace) WorkspaceResp {
	return WorkspaceResp{
		ID:          ws.ID,
		Name:        ws.Name,
		Description: ws.Description,
		CreatedAt:   ws.CreatedAt,
		UpdatedAt:   ws.UpdatedAt,
	}
}

// UpdateWorkspaceDTO 更新工作区请求体（api.md：name 可选，description 可选）
type UpdateWorkspaceDTO struct {
	Name        handler.Nullable[string] `json:"name"`
	Description handler.Nullable[string] `json:"description"`
}
