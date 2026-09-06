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

		//filter by query params：scope 可选，缺席返回该 workspace 全部标签
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
		//scope 缺席时不能传 LabelScope("") 进 $2::label_scope（PG 枚举转换报错 → 500），故拆两条查询
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
		for _, lb := range labels {
			resp = append(resp, toLabelRow(lb))
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

		//先解析请求体：畸形请求不该白跑一次数据库，也保证“畸形 body + 不存在 id”
		//统一返 400 而非 404（与事务型 handler 的顺序一致，api.md §2.5 事务边界）
		var req UpdateLabelDto
		if err := c.ShouldBindJSON(&req); err != nil {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "请求体不是合法的 JSON")
			return
		}

		//查——读-改-写的基准行（单条写，刻意不开事务，api.md §2.4）
		lb, err := queries.GetLabel(c.Request.Context(), store.GetLabelParams{
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
		if req.Name.Set {
			if !req.Name.Valid || strings.TrimSpace(req.Name.Value) == "" {
				handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "name 为必填字段")
				return
			}
			lb.Name = req.Name.Value
		}
		if req.Color.Set {
			// color 必传且必须 hex：显式 null 一律 400，不允许置空
			if !req.Color.Valid || !handler.IsHexColor(req.Color.Value) {
				handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "color 为必填字段且应符合 HEX 颜色规范")
				return
			}
			lb.Color = req.Color.Value
		}

		//更新
		updated, err := queries.UpdateLabel(c.Request.Context(), store.UpdateLabelParams{
			ID:          labelUUID,
			WorkspaceID: workspaceUUID,
			Name:        lb.Name,
			Color:       lb.Color,
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

// CheckLabelIDsLegal 是 ValidateAndDedupeLabelIDs 的 HTTP 适配层：校验失败时已按 §1 错误码表写好响应，
// 返回 ok=false，调用方直接 `if !ok { return }`（同 checkLeaderLegal / checkAssigneeLegal 约定）。
//
// 四个打标入口（POST /tasks、POST /projects、两个 PUT labels）共用：错误码是对外契约，
// 四处各写一遍 errors.Is → handler.Error 映射意味着改一个文案要同步四处。
// scope 仅用于拼文案，指明不匹配的是哪一类标签（输出与原各处硬编码的 "task"/"project" 一致）。
func CheckLabelIDsLegal(c *gin.Context, q *store.Queries, workspaceID uuid.UUID, scope store.LabelScope, ids []uuid.UUID) ([]uuid.UUID, bool) {
	handled, err := ValidateAndDedupeLabelIDs(c.Request.Context(), q, workspaceID, scope, ids)
	if err != nil {
		switch {
		case errors.Is(err, ErrLabelCrossWorkspace):
			handler.Error(c, http.StatusBadRequest, "CROSS_WORKSPACE", "labelIds 中包含不属于本工作区的标签")
		case errors.Is(err, ErrLabelScopeMismatch):
			handler.Error(c, http.StatusBadRequest, "LABEL_SCOPE_MISMATCH", "labelIds 中包含 scope 不是 "+string(scope)+" 的标签")
		default:
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "校验标签失败")
		}
		return nil, false
	}
	return handled, true
}

// ValidateAndDedupeLabelIDs 校验 labelIds 全部属于本 workspace 且 scope 与目标类型匹配（R6），
// 去重（保持原序）后返回——去重同时避免联结表联合主键冲突（23505）。
// HTTP handler 请走 CheckLabelIDsLegal（含错误码映射）；本函数是纯校验核心，返回哨兵错误由调用方解释。
// 区分两类非法：命中行数不足 = 有 id 不在本工作区（CROSS_WORKSPACE）；行数齐但 scope 不符 = SCOPE_MISMATCH。
// ids 可为 nil 或空（裸切片调用方如 CreateProject 省略字段即为 nil）：len/range/make 对 nil 天然安全，
// 统一短路返回空非 nil 切片 + nil error——nil 与空数组同义，下游按“零标签”处理，无需在此区分。
/*
 @param ctx
 @param q
 @param workspaceID 工作区 ID
 @param scope 标签类型
 @param ids 标签 ID 列表；可为 nil/空，视为零标签
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
	//空即零标签：短路返回空非 nil 切片，省去一次查库（下游 unnest 空数组插入 0 行）
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
	//行数一样，但 scope 有不一样的
	for _, row := range rows {
		if row.Scope != scope {
			return nil, ErrLabelScopeMismatch
		}
	}
	return deduped, nil
}
