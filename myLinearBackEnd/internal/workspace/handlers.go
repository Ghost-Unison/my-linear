package workspace

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/google/uuid"

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
		if err := json.NewDecoder(c.Request.Body).Decode(&req); err != nil {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "请求体不是合法的 JSON")
			return
		}
		if req.Name == "" {
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
		workspaceId := c.Param("workspaceId")

		//check if legal uuid
		workspaceUUID, err := uuid.Parse(workspaceId)
		if err != nil {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "workspaceId 不符合 UUID 格式")
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
		workspaceId := c.Param("workspaceId")
		workspaceUUID, err := uuid.Parse(workspaceId)
		if err != nil {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "workspaceId 不符合 UUID 格式")
			return
		}

		//查
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
		var req UpdateWorkspaceDTO
		if err := json.NewDecoder(c.Request.Body).Decode(&req); err != nil {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "请求体不是合法的 JSON")
			return
		}
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
		workspaceId := c.Param("workspaceId")

		//check if legal uuid
		workspaceUUID, err := uuid.Parse(workspaceId)
		if err != nil {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "workspaceId 不符合 UUID 格式")
			return
		}
		if err := queries.DeleteWorkspace(c.Request.Context(), workspaceUUID); err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "删除工作区失败")
			return
		}
		c.Status(http.StatusNoContent)
	}
}
