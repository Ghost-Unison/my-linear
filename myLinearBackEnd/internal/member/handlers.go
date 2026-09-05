package member

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Ghost-Unison/my-linear/myLinearBackEnd/internal/handler"
	"github.com/Ghost-Unison/my-linear/myLinearBackEnd/internal/store"
)

// 列出工作区成员: 200 返回Member[] (按name排序，在SQL内完成)
func ListMembersByWorkspace(pool *pgxpool.Pool) gin.HandlerFunc {
	queries := store.New(pool)
	return func(c *gin.Context) {
		workspaceUUID, ok := handler.ParseUUIDParam(c, "workspaceId")
		if !ok {
			return
		}

		queryResult, err := queries.ListMembersByWorkspace(c.Request.Context(), workspaceUUID)
		if err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "获取工作区成员失败")
			return
		}

		list := make([]MemberResp, 0, len(queryResult))
		for _, item := range queryResult {
			list = append(list, toResp(item))
		}
		c.JSON(http.StatusOK, list)
	}
}

// 新增成员:201 返回新增的Member
func CreateMember(pool *pgxpool.Pool) gin.HandlerFunc {
	queries := store.New(pool)
	return func(c *gin.Context) {
		workspaceUUID, ok := handler.ParseUUIDParam(c, "workspaceId")
		if !ok {
			return
		}

		var req CreateMemberDTO
		if err := c.ShouldBindJSON(&req); err != nil {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "请求体不是合法的 JSON")
			return
		}
		if req.Name == "" || req.AvatarColor == "" {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "name 与 color 为必填字段")
			return
		}
		if !handler.IsHexColor(req.AvatarColor) {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "avatarColor 应符合 HEX 颜色规范")
			return
		}

		//创建成员；重名由唯一索引 (workspace_id, name) 兜底：捕获 PG 23505 → 409（api.md §2.5）
		//预查重名不可用：:one 查无此行返回 pgx.ErrNoRows 而非 nil，且存在 TOCTOU 竞态
		created, err := queries.CreateMember(c.Request.Context(), store.CreateMemberParams{
			WorkspaceID: workspaceUUID,
			Name:        req.Name,
			Email:       req.Email, //没传和传null在创建时一样，所以直接透传
			AvatarColor: req.AvatarColor,
		})
		if err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23505" {
				handler.Error(c, http.StatusConflict, "NAME_CONFLICT", "同工作区内成员名重复")
				return
			}
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "创建成员失败")
			return
		}
		c.JSON(http.StatusCreated, toResp(created))
	}
}

// 更新成员：200 返回更新后的Member
func UpdateMember(pool *pgxpool.Pool) gin.HandlerFunc {
	queries := store.New(pool)
	return func(c *gin.Context) {
		workspaceUUID, ok := handler.ParseUUIDParam(c, "workspaceId")
		if !ok {
			return
		}
		memberUUID, ok := handler.ParseUUIDParam(c, "memberId")
		if !ok {
			return
		}

		//查（id + workspace_id 双条件，防跨 workspace 访问，api.md §2.3）
		member, err := queries.GetMember(c.Request.Context(), store.GetMemberParams{
			ID:          memberUUID,
			WorkspaceID: workspaceUUID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				handler.Error(c, http.StatusNotFound, "NOT_FOUND", "成员不存在")
				return
			}
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "获取成员失败")
			return
		}

		//校验
		var req UpdateMemberDTO
		if err := c.ShouldBindJSON(&req); err != nil {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "请求体不是合法的 JSON")
			return
		}

		if req.Name.Set {
			if !req.Name.Valid || strings.TrimSpace(req.Name.Value) == "" {
				handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "name 为必填字段")
				return
			}
			member.Name = req.Name.Value
		}
		if req.Email.Set {
			if req.Email.Valid {
				member.Email = &req.Email.Value
			} else {
				member.Email = nil
			}
		}
		if req.AvatarColor.Set {
			if !req.AvatarColor.Valid || !handler.IsHexColor(req.AvatarColor.Value) {
				handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "avatarColor 为必填字段且应符合 HEX 颜色规范")
				return
			}
			// avatar_color 为 NOT NULL DEFAULT '' 但是前端一般一定会传一个颜色
			if req.AvatarColor.Valid {
				member.AvatarColor = req.AvatarColor.Value
			} else {
				member.AvatarColor = ""
			}
		}

		//更新
		updated, err := queries.UpdateMember(c.Request.Context(), store.UpdateMemberParams{
			ID:          member.ID,
			WorkspaceID: workspaceUUID,
			Name:        member.Name,
			Email:       member.Email,
			AvatarColor: member.AvatarColor,
		})
		if err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23505" {
				handler.Error(c, http.StatusConflict, "NAME_CONFLICT", "同工作区内成员名重复")
				return
			}
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "更新成员失败")
			return
		}

		c.JSON(http.StatusOK, toResp(updated))
	}
}

// 硬删除成员：204
func DeleteMember(pool *pgxpool.Pool) gin.HandlerFunc {
	queries := store.New(pool)
	return func(c *gin.Context) {
		workspaceUUID, ok := handler.ParseUUIDParam(c, "workspaceId")
		if !ok {
			return
		}
		memberUUID, ok := handler.ParseUUIDParam(c, "memberId")
		if !ok {
			return
		}

		if err := queries.DeleteMember(c.Request.Context(), store.DeleteMemberParams{
			ID:          memberUUID,
			WorkspaceID: workspaceUUID,
		}); err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "删除成员失败")
			return
		}
		c.Status(http.StatusNoContent)
	}
}
