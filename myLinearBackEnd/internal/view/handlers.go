package view

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/Ghost-Unison/my-linear/myLinearBackEnd/internal/handler"
	"github.com/Ghost-Unison/my-linear/myLinearBackEnd/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ListViews 视图列表（api.md §10）：surface 必传；entityType 可选过滤；
// projectId 仅 project_issues 面必传（项目级 scope，P2.md §4.1）
func ListViews(pool *pgxpool.Pool) gin.HandlerFunc {
	queries := store.New(pool)
	return func(c *gin.Context) {
		workspaceUUID, ok := handler.ParseUUIDParam(c, "workspaceId")
		if !ok {
			return
		}

		//surface - 确定请求页面
		surfaceParam := c.Query("surface")
		if surfaceParam == "" {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "surface 为必传参数")
			return
		}
		if !store.ViewSurface(surfaceParam).Valid() {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "surface 不符合规范")
			return
		}
		surface := store.ViewSurface(surfaceParam)

		entityParam := c.Query("entityType")
		if entityParam != "" && !store.ViewEntity(entityParam).Valid() {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "entityType 不符合规范")
			return
		}

		projectParam := c.Query("projectId")
		// project_issues 面按项目查；其余面传 projectId 无意义，直接 400 暴露调用错误
		if surface == store.ViewSurfaceProjectIssues {
			if projectParam == "" {
				handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "project_issues 面 projectId 必传")
				return
			}
			projectUUID, err := uuid.Parse(projectParam)
			if err != nil {
				handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "projectId 不是合法 UUID")
				return
			}
			rows, err := queries.ListViewsByProject(c.Request.Context(), store.ListViewsByProjectParams{
				WorkspaceID: workspaceUUID,
				ProjectID:   &projectUUID,
			})
			if err != nil {
				handler.Error(c, http.StatusInternalServerError, "INTERNAL", "获取视图列表失败")
				return
			}
			c.JSON(http.StatusOK, toViewRows(rows))
			return
		}
		if projectParam != "" {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "projectId 仅 project_issues 面可传")
			return
		}

		//非project_issues页面查询时，views菜单 按 surface 及 entityType 查询, project_list\task_list按surface获取
		var (
			rows []store.SavedView
			err  error
		)
		// entityType 缺席时不能传 ViewEntity("") 进枚举参数（PG 枚举转换报错 → 500），故拆两条查询（同 label scope 约定）
		if entityParam != "" {
			rows, err = queries.ListViewsBySurfaceAndEntityType(c.Request.Context(), store.ListViewsBySurfaceAndEntityTypeParams{
				WorkspaceID: workspaceUUID,
				Surface:     surface,
				EntityType:  store.ViewEntity(entityParam),
			})
		} else {
			rows, err = queries.ListViewsBySurface(c.Request.Context(), store.ListViewsBySurfaceParams{
				WorkspaceID: workspaceUUID,
				Surface:     surface,
			})
		}
		if err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "获取视图列表失败")
			return
		}
		c.JSON(http.StatusOK, toViewRows(rows))
	}
}

// CreateView 创建视图：surface⇒entityType 一致性与 project_id scope 由后端强制（P2.md §4.1）
func CreateView(pool *pgxpool.Pool) gin.HandlerFunc {
	queries := store.New(pool)
	return func(c *gin.Context) {
		workspaceUUID, ok := handler.ParseUUIDParam(c, "workspaceId")
		if !ok {
			return
		}

		var req CreateViewDto
		if err := c.ShouldBindJSON(&req); err != nil {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "请求体不符合规范")
			return
		}
		if strings.TrimSpace(req.Name) == "" {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "name 为必填字段")
			return
		}
		if !store.ViewSurface(req.Surface).Valid() {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "surface 不符合规范")
			return
		}
		if !store.ViewEntity(req.EntityType).Valid() {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "entityType 不符合规范")
			return
		}
		// surface 及 entityType 一致性校验
		if msg := validateSurfaceScope(store.ViewSurface(req.Surface), store.ViewEntity(req.EntityType), req.ProjectID); msg != "" {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", msg)
			return
		}
		// json格式整理校验
		config, ok := normalizeConfig(req.Config)
		if !ok {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "config 应为 JSON object")
			return
		}

		// project_issues 面：project 必属本 workspace 且未软删（GetProject 含 deleted_at 过滤）
		if req.ProjectID != nil {
			if _, err := queries.GetProject(c.Request.Context(), store.GetProjectParams{
				ID:          *req.ProjectID,
				WorkspaceID: workspaceUUID,
			}); err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					handler.Error(c, http.StatusNotFound, "NOT_FOUND", "项目不存在")
					return
				}
				handler.Error(c, http.StatusInternalServerError, "INTERNAL", "校验项目失败")
				return
			}
		}

		created, err := queries.CreateView(c.Request.Context(), store.CreateViewParams{
			WorkspaceID: workspaceUUID,
			EntityType:  store.ViewEntity(req.EntityType),
			Surface:     store.ViewSurface(req.Surface),
			ProjectID:   req.ProjectID,
			Name:        req.Name,
			Description: req.Description,
			Config:      config,
		})
		if err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "创建视图失败")
			return
		}
		c.JSON(http.StatusCreated, toViewRow(created))
	}
}

// GetView 单条视图（Views 详情页用）
func GetView(pool *pgxpool.Pool) gin.HandlerFunc {
	queries := store.New(pool)
	return func(c *gin.Context) {
		workspaceUUID, ok := handler.ParseUUIDParam(c, "workspaceId")
		if !ok {
			return
		}
		viewUUID, ok := handler.ParseUUIDParam(c, "viewId")
		if !ok {
			return
		}

		v, err := queries.GetView(c.Request.Context(), store.GetViewParams{
			ID:          viewUUID,
			WorkspaceID: workspaceUUID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				handler.Error(c, http.StatusNotFound, "NOT_FOUND", "视图不存在")
				return
			}
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "获取视图失败")
			return
		}
		c.JSON(http.StatusOK, toViewRow(v))
	}
}

// UpdateView 更新视图：name / description / config presence 三态，读-改-写（单条写不开事务，api.md §2.4）
func UpdateView(pool *pgxpool.Pool) gin.HandlerFunc {
	queries := store.New(pool)
	return func(c *gin.Context) {
		workspaceUUID, ok := handler.ParseUUIDParam(c, "workspaceId")
		if !ok {
			return
		}
		viewUUID, ok := handler.ParseUUIDParam(c, "viewId")
		if !ok {
			return
		}

		// 先解析请求体：畸形请求不该白跑一次数据库（同 label 约定）
		var req UpdateViewDto
		if err := c.ShouldBindJSON(&req); err != nil {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "请求体不是合法的 JSON")
			return
		}

		v, err := queries.GetView(c.Request.Context(), store.GetViewParams{
			ID:          viewUUID,
			WorkspaceID: workspaceUUID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				handler.Error(c, http.StatusNotFound, "NOT_FOUND", "视图不存在")
				return
			}
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "获取视图失败")
			return
		}

		if req.Name.Set {
			if !req.Name.Valid || strings.TrimSpace(req.Name.Value) == "" {
				handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "name 为必填字段")
				return
			}
			v.Name = req.Name.Value
		}
		if req.Description.Set {
			// description 可空串但不可 null：列 NOT NULL，显式 null 一律 400（同 label color 约定）
			if !req.Description.Valid {
				handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "description 不接受 null")
				return
			}
			v.Description = req.Description.Value
		}
		if req.Config.Set {
			if !req.Config.Valid {
				handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "config 不接受 null")
				return
			}
			config, ok := normalizeConfig(req.Config.Value)
			if !ok {
				handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "config 应为 JSON object")
				return
			}
			v.Config = config
		}

		updated, err := queries.UpdateView(c.Request.Context(), store.UpdateViewParams{
			ID:          viewUUID,
			WorkspaceID: workspaceUUID,
			Name:        v.Name,
			Description: v.Description,
			Config:      v.Config,
		})
		if err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "更新视图失败")
			return
		}
		c.JSON(http.StatusOK, toViewRow(updated))
	}
}

// DeleteView 硬删除视图（幂等 204，同 label 约定）
func DeleteView(pool *pgxpool.Pool) gin.HandlerFunc {
	queries := store.New(pool)
	return func(c *gin.Context) {
		workspaceUUID, ok := handler.ParseUUIDParam(c, "workspaceId")
		if !ok {
			return
		}
		viewUUID, ok := handler.ParseUUIDParam(c, "viewId")
		if !ok {
			return
		}

		if err := queries.DeleteView(c.Request.Context(), store.DeleteViewParams{
			ID:          viewUUID,
			WorkspaceID: workspaceUUID,
		}); err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "删除视图失败")
			return
		}
		c.Status(http.StatusNoContent)
	}
}

// util functions

// validateSurfaceScope 校验 surface⇒entity_type 一致性与 project_id scope（P2.md §4.1）：
// tasks_page / project_issues ⇒ task，projects_page ⇒ project，views_page 两者皆可；
// project_id 仅 project_issues 面可非空且该面必传。返回空串 = 通过，否则为 400 文案。
func validateSurfaceScope(surface store.ViewSurface, entity store.ViewEntity, projectID *uuid.UUID) string {
	switch surface {
	case store.ViewSurfaceTasksPage, store.ViewSurfaceProjectIssues:
		if entity != store.ViewEntityTask {
			return string(surface) + " 面的 entityType 必须为 task"
		}
	case store.ViewSurfaceProjectsPage:
		if entity != store.ViewEntityProject {
			return "projects_page 面的 entityType 必须为 project"
		}
	case store.ViewSurfaceViewsPage:
		// 两者皆可（Views 页 tab 区分）
	}
	if surface == store.ViewSurfaceProjectIssues {
		if projectID == nil {
			return "project_issues 面 projectId 必传"
		}
	} else if projectID != nil {
		return "projectId 仅 project_issues 面可传"
	}
	return ""
}

// normalizeConfig config 归一：缺席/空字节 → 默认 '{}'；否则必须为合法 JSON object
// （后端 opaque 不解释内容，仅要求 object 形状，P2.md §4.2）
func normalizeConfig(raw json.RawMessage) (json.RawMessage, bool) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return json.RawMessage("{}"), true
	}
	if trimmed[0] != '{' || !json.Valid(trimmed) {
		return nil, false
	}
	return trimmed, true
}
