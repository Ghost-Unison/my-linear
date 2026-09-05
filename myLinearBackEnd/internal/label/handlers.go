package label

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/Ghost-Unison/my-linear/myLinearBackEnd/internal/handler"
	"github.com/Ghost-Unison/my-linear/myLinearBackEnd/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

func ListLabelsByWorkspace(pool *pgxpool.Pool) gin.HandlerFunc {
	queries := store.New(pool)
	return func(c *gin.Context) {
		workspaceUUID, ok := handler.ParseUUIDParam(c, "workspaceId")
		if !ok {
			return
		}

		//filter by query params：scope 缺席返回全部；枚举参数不可传空串（PG 枚举转换报错），分两条查询
		scope := c.Query("scope")
		if scope != "" && !store.LabelScope(scope).Valid() {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "scope 不符合规范")
			return
		}

		//query
		var (
			labels []store.Label
			err    error
		)
		//scope 缺席时传 LabelScope("") 进 $2::label_scope	PG 枚举转换报错 → 500；已拆 ListLabelsByWorkspace / ...AndScope 两条查询
		if scope == "" {
			labels, err = queries.ListLabelsByWorkspace(c.Request.Context(), workspaceUUID)
		} else {
			labels, err = queries.ListLabelsByWorkspaceAndScope(c.Request.Context(), store.ListLabelsByWorkspaceAndScopeParams{
				WorkspaceID: workspaceUUID,
				Scope:       store.LabelScope(scope),
			})
		}
		if err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "获取标签列表失败")
			return
		}

		// convert to response format
		resp := make([]LabelRow, 0, len(labels))
		for _, label := range labels {
			resp = append(resp, toLabelRow(label))
		}
		c.JSON(http.StatusOK, resp)
	}
}

func CreateLabel(pool *pgxpool.Pool) gin.HandlerFunc {
	queries := store.New(pool)
	return func(c *gin.Context) {
		workspaceUUID, ok := handler.ParseUUIDParam(c, "workspaceId")
		if !ok {
			return
		}

		//parse request body
		var req CreateLabelDto
		if err := c.ShouldBindJSON(&req); err != nil {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "请求体不符合规范")
			return
		}
		if strings.TrimSpace(req.Name) == "" || req.Color == "" {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "name 和 color 为必填字段")
			return
		}
		if !store.LabelScope(req.Scope).Valid() {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "scope 不符合规范")
			return
		}
		//校验color是hex
		if !handler.IsHexColor(req.Color) {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "color 应符合 HEX 颜色规范")
			return
		}

		//create
		created, err := queries.CreateLabel(c.Request.Context(), store.CreateLabelParams{
			WorkspaceID: workspaceUUID,
			Name:        req.Name,
			Color:       req.Color,
			Scope:       store.LabelScope(req.Scope),
		})
		if err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23505" {
				handler.Error(c, http.StatusConflict, "NAME_CONFLICT", "同工作区内同一类型的标签名重复")
				return
			}
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "创建标签失败")
			return
		}
		c.JSON(http.StatusCreated, toLabelRow(created))

	}
}

func UpdateLabel(pool *pgxpool.Pool) gin.HandlerFunc {
	queries := store.New(pool)
	return func(c *gin.Context) {
		workspaceUUID, ok := handler.ParseUUIDParam(c, "workspaceId")
		if !ok {
			return
		}
		labelUUID, ok := handler.ParseUUIDParam(c, "labelId")
		if !ok {
			return
		}

		//query
		label, err := queries.GetLabel(c.Request.Context(), store.GetLabelParams{
			ID:          labelUUID,
			WorkspaceID: workspaceUUID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				handler.Error(c, http.StatusNotFound, "NOT_FOUND", "标签不存在")
				return
			}
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "获取标签失败")
			return
		}

		//校验
		var req UpdateLabelDto
		if err := c.ShouldBindJSON(&req); err != nil {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "请求体不是合法的 JSON")
			return
		}

		if req.Name.Set {
			if !req.Name.Valid || strings.TrimSpace(req.Name.Value) == "" {
				handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "name 为必填字段")
				return
			}
			label.Name = req.Name.Value
		}
		if req.Color.Set {
			// color 必传且必须 hex：显式 null 一律 400，不允许置空
			if !req.Color.Valid || !handler.IsHexColor(req.Color.Value) {
				handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "color 为必填字段且应符合 HEX 颜色规范")
				return
			}
			label.Color = req.Color.Value
		}

		//更新
		updated, err := queries.UpdateLabel(c.Request.Context(), store.UpdateLabelParams{
			ID:          labelUUID,
			WorkspaceID: workspaceUUID,
			Name:        label.Name,
			Color:       label.Color,
		})
		if err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23505" {
				handler.Error(c, http.StatusConflict, "NAME_CONFLICT", "同工作区内同一类型的标签名重复")
				return
			}
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "更新标签失败")
			return
		}

		c.JSON(http.StatusOK, toLabelRow(updated))
	}

}

func DeleteLabel(pool *pgxpool.Pool) gin.HandlerFunc {
	queries := store.New(pool)
	return func(c *gin.Context) {
		workspaceUUID, ok := handler.ParseUUIDParam(c, "workspaceId")
		if !ok {
			return
		}
		labelUUID, ok := handler.ParseUUIDParam(c, "labelId")
		if !ok {
			return
		}

		if err := queries.DeleteLabel(c.Request.Context(), store.DeleteLabelParams{
			ID:          labelUUID,
			WorkspaceID: workspaceUUID,
		}); err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "删除标签失败")
			return
		}
		c.Status(http.StatusNoContent)
	}
}

// util functions

// 打标校验的哨兵错误：handler 映射为 400 CROSS_WORKSPACE / LABEL_SCOPE_MISMATCH（api.md §1、R6）
var (
	ErrLabelCrossWorkspace = errors.New("labelIds 中包含不属于本工作区的标签")
	ErrLabelScopeMismatch  = errors.New("labelIds 中包含 scope 不匹配的标签")
)

// ValidateAndDedupeLabelIDs 校验 labelIds 全部属于本 workspace 且 scope 与目标类型匹配（R6），
// 去重（保持原序）后返回——去重同时避免联结表联合主键冲突（23505）。
// 区分两类非法：命中行数不足 = 有 id 不在本工作区（CROSS_WORKSPACE）；行数齐但 scope 不符 = SCOPE_MISMATCH。
/*
 @param ctx
 @param q
 @param workspaceID 工作区 ID
 @param scope 标签类型
 @param ids 标签 ID 列表
*/
func ValidateAndDedupeLabelIDs(ctx context.Context, q *store.Queries, workspaceID uuid.UUID, scope store.LabelScope, ids []uuid.UUID) ([]uuid.UUID, error) {
	//先去重
	deduped := make([]uuid.UUID, 0, len(ids))
	seen := make(map[uuid.UUID]struct{}, len(ids))
	for _, id := range ids {
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		deduped = append(deduped, id)
	}
	if len(deduped) == 0 {
		return deduped, nil
	}

	//查询scope下所有标签的id
	rows, err := q.ListLabelScopesByIds(ctx, store.ListLabelScopesByIdsParams{
		WorkspaceID: workspaceID,
		Ids:         deduped,
	})
	if err != nil {
		return nil, err
	}
	//命中行数不足 = 有 id 不在本工作区（CROSS_WORKSPACE）
	if len(rows) != len(deduped) {
		return nil, ErrLabelCrossWorkspace
	}
	//行数一样，但scopse有不一样的
	for _, row := range rows {
		if row.Scope != scope {
			return nil, ErrLabelScopeMismatch
		}
	}
	return deduped, nil
}
