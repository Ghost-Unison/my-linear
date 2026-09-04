package member

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"mylinear/internal/handler"
	"mylinear/internal/store"
)

// 列出工作区成员: 200 返回Member[] (按name排序，在SQL内完成)
func ListMembersByWorkspace(pool *pgxpool.Pool) gin.HandlerFunc {
	queries := store.New(pool)
	return func(c *gin.Context) {
		workspaceId := c.Param("workspaceId")
		//check if legal uuid
		workspaceUUID, err := uuid.Parse(workspaceId)
		if err != nil {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "workspaceId 不符合 UUID 格式")
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
		var req CreateMemberDTO
		if err := c.ShouldBindJSON(&req); err != nil {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "请求体不是合法的 JSON")
			return
		}
		if req.Name == "" {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "name 为必填字段")
			return
		}

		workspaceId := c.Param("workspaceId")
		workspaceUUID, err := uuid.Parse(workspaceId)
		if err != nil {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "workspaceId 不符合 UUID 格式")
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
		workspaceId := c.Param("workspaceId")
		workspaceUUID, err := uuid.Parse(workspaceId)
		if err != nil {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "workspaceId 不符合 UUID 格式")
			return
		}

		memberId := c.Param("memberId")
		memberUUID, err := uuid.Parse(memberId)
		if err != nil {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "memberId 不符合 UUID 格式")
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
			// avatar_color 为 NOT NULL DEFAULT ''：显式 null 置空即写空串，不是错误
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
		workspaceId := c.Param("workspaceId")
		workspaceUUID, err := uuid.Parse(workspaceId)
		if err != nil {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "workspaceId 不符合 UUID 格式")
			return
		}

		memberId := c.Param("memberId")
		memberUUID, err := uuid.Parse(memberId)
		if err != nil {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "memberId 不符合 UUID 格式")
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
