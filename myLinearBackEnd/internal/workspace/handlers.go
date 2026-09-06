package workspace

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Ghost-Unison/my-linear/myLinearBackEnd/internal/handler"
	"github.com/Ghost-Unison/my-linear/myLinearBackEnd/internal/store"
)

// 侧边栏工作区列表：200 返回 Workspace[]（按 createdAt 升序，排序在 SQL 内完成）
func ListWorkspaces(pool *pgxpool.Pool) gin.HandlerFunc {
	queries := store.New(pool)
	return func(c *gin.Context) {
		queryResult, err := queries.ListWorkspaces(c.Request.Context())
		if err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "获取工作区列表失败")
			return
		}

		list := make([]WorkspaceResp, 0, len(queryResult))
		for _, ws := range queryResult {
			list = append(list, toResp(ws))
		}
		c.JSON(http.StatusOK, list)
	}
}

// 创建工作区：201 返回新建的 Workspace
func CreateWorkspace(pool *pgxpool.Pool) gin.HandlerFunc {
	queries := store.New(pool)
	return func(c *gin.Context) {
		var req CreateWorkspaceDTO
		// Decoder原生写法 - 不如gin的 ShouldBindJSON
		//if err := json.NewDecoder(c.Request.Body).Decode(&req); err != nil {
		if err := c.ShouldBindJSON(&req); err != nil {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "请求体不是合法的 JSON")
			return
		}
		if strings.TrimSpace(req.Name) == "" {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "name 为必填字段")
			return
		}

		created, err := queries.CreateWorkspace(c.Request.Context(), store.CreateWorkspaceParams{
			Name:        req.Name,
			Description: req.Description,
		})
		if err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "创建工作区失败")
			return
		}
		c.JSON(http.StatusCreated, toResp(created))
	}
}

// 获取工作区：200 返回 Workspace
func GetWorkspace(pool *pgxpool.Pool) gin.HandlerFunc {
	queries := store.New(pool)
	return func(c *gin.Context) {
		workspaceUUID, ok := handler.ParseUUIDParam(c, "workspaceId")
		if !ok {
			return
		}

		got, err := queries.GetWorkspace(c.Request.Context(), workspaceUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				handler.Error(c, http.StatusNotFound, "NOT_FOUND", "工作区不存在")
				return
			}
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "获取工作区失败")
			return
		}
		c.JSON(http.StatusOK, toResp(got))
	}
}

// 更新工作区：200
func UpdateWorkspace(pool *pgxpool.Pool) gin.HandlerFunc {
	queries := store.New(pool)
	return func(c *gin.Context) {
		workspaceUUID, ok := handler.ParseUUIDParam(c, "workspaceId")
		if !ok {
			return
		}

		//先解析请求体：畸形请求不该白跑一次数据库，也保证“畸形 body + 不存在 id”
		//统一返 400 而非 404（与事务型 handler 的顺序一致，api.md §2.5 事务边界）
		var req UpdateWorkspaceDTO
		if err := c.ShouldBindJSON(&req); err != nil {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "请求体不是合法的 JSON")
			return
		}

		//查——读-改-写的基准行（单条写，刻意不开事务，api.md §2.4）
		workspace, err := queries.GetWorkspace(c.Request.Context(), workspaceUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				handler.Error(c, http.StatusNotFound, "NOT_FOUND", "工作区不存在")
				return
			}
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "获取工作区失败")
			return
		}

		//校验
		if req.Name.Set {
			if !req.Name.Valid || strings.TrimSpace(req.Name.Value) == "" {
				handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "name 为必填字段")
				return
			}
			workspace.Name = req.Name.Value
		}
		if req.Description.Set {
			if req.Description.Valid {
				workspace.Description = req.Description.Value
			} else {
				// workspace.description 为 NOT NULL DEFAULT ''，置空即写空串
				workspace.Description = ""
			}
		}

		//更新
		updated, err := queries.UpdateWorkspace(c.Request.Context(), store.UpdateWorkspaceParams{
			ID:          workspace.ID,
			Name:        workspace.Name,
			Description: workspace.Description,
		})
		if err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "更新工作区失败")
			return
		}

		c.JSON(http.StatusOK, toResp(updated))
	}
}

// 硬删除工作区：204
func DeleteWorkspace(pool *pgxpool.Pool) gin.HandlerFunc {
	queries := store.New(pool)
	return func(c *gin.Context) {
		workspaceUUID, ok := handler.ParseUUIDParam(c, "workspaceId")
		if !ok {
			return
		}

		if err := queries.DeleteWorkspace(c.Request.Context(), workspaceUUID); err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "删除工作区失败")
			return
		}
		c.Status(http.StatusNoContent)
	}
}
