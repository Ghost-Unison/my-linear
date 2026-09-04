package project

import (
	"bytes"
	"cmp"
	"errors"
	"github.com/Ghost-Unison/my-linear/myLinearBackEnd/internal/handler"
	"github.com/Ghost-Unison/my-linear/myLinearBackEnd/internal/member"
	"github.com/Ghost-Unison/my-linear/myLinearBackEnd/internal/store"
	"net/http"
	"slices"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func ListProjectsByWorkspace(pool *pgxpool.Pool) gin.HandlerFunc {
	queries := store.New(pool)
	return func(c *gin.Context) {
		workspaceUUID, ok := parseUUIDParam(c, "workspaceId")
		if !ok {
			return
		}

		//query
		projects, err := queries.ListProjectsByWorkspace(c.Request.Context(), workspaceUUID)
		if err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "获取项目列表失败")
			return
		}

		// filter and sort
		sortField := c.DefaultQuery("sort", "createdAt")
		orderField := c.DefaultQuery("order", "desc")
		sortProjects(projects, sortField, orderField)

		// convert to response format
		resp := make([]ProjectRow, 0, len(projects))
		for _, item := range projects {
			resp = append(resp, toProjectRow(item))
		}
		c.JSON(http.StatusOK, resp)

	}
}

func CreateProject(pool *pgxpool.Pool) gin.HandlerFunc {
	queries := store.New(pool)
	return func(c *gin.Context) {
		// parse request body
		var req CreateProjectDto
		if err := c.ShouldBindJSON(&req); err != nil {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "请求体不是合法的 JSON")
			return
		}
		if req.Name == "" {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "name 为必填字段")
			return
		}

		workspaceUUID, ok := parseUUIDParam(c, "workspaceId")
		if !ok {
			return
		}

		//leader不能同时是成员
		if req.LeadId != nil && slices.Contains(req.MemberIds, *req.LeadId) {
			handler.Error(c, http.StatusBadRequest, "LEAD_MEMBER_CONFLICT", "leader不能同时是成员")
			return
		}
		//校验枚举值是否合法 - status一定有值
		if !store.ProjectStatus(req.Status).Valid() {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "status 不符合规范")
			return
		}
		//priority一定有值 - 整数 0 1 2 3 4
		if req.Priority < 0 || req.Priority > 4 {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "priority 不符合规范")
			return
		}

		//校验 leader 是否存在于本工作区
		if req.LeadId != nil && !checkLeaderLegal(c, queries, workspaceUUID, *req.LeadId) {
			return
		}

		//memberIds可能有重复，先去重再校验存在性
		req.MemberIds = dedupeUUIDs(req.MemberIds)
		if !checkMemberLegal(c, queries, workspaceUUID, req.MemberIds) {
			return
		}

		//beginTx
		tx, err := pool.Begin(c.Request.Context())
		if err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "数据库事务开始失败")
			return
		}
		defer tx.Rollback(c.Request.Context()) // Commit 后调用是 no-op，兜底
		q := store.New(pool).WithTx(tx)

		//CreateProject
		created, err := q.CreateProject(c.Request.Context(), store.CreateProjectParams{
			WorkspaceID: workspaceUUID,
			Name:        req.Name,
			Description: req.Description,
			Status:      store.ProjectStatus(req.Status), //string转枚举
			Priority:    int16(req.Priority),
			LeadID:      req.LeadId,
			//MemberIds:   req.MemberIds,
			StartDate:  req.StartDate,
			TargetDate: req.TargetDate,
		})
		if err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "创建项目失败")
			return
		}

		// AddProjectMembers
		err = q.AddProjectMembers(c.Request.Context(), store.AddProjectMembersParams{
			ProjectID: created.ID,
			Column2:   req.MemberIds,
		})
		if err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "添加项目成员失败")
			return
		}

		if err := tx.Commit(c.Request.Context()); err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "创建项目-数据库事务提交失败")
			return
		}

		// 提交后重读，装配 ProjectDetail并返回
		projectDetail, ok := buildProjectDetail(c, queries, workspaceUUID, created.ID)
		if !ok {
			return
		}
		c.JSON(http.StatusCreated, projectDetail)
	}
}

func GetProject(pool *pgxpool.Pool) gin.HandlerFunc {
	queries := store.New(pool)
	return func(c *gin.Context) {
		workspaceUUID, ok := parseUUIDParam(c, "workspaceId")
		if !ok {
			return
		}
		projectUUID, ok := parseUUIDParam(c, "projectId")
		if !ok {
			return
		}

		//get - queryProjectDetail
		projectDetail, ok := buildProjectDetail(c, queries, workspaceUUID, projectUUID)
		if !ok {
			return
		}
		c.JSON(http.StatusOK, projectDetail)
	}
}

func UpdateProject(pool *pgxpool.Pool) gin.HandlerFunc {
	queries := store.New(pool)
	return func(c *gin.Context) {
		workspaceUUID, ok := parseUUIDParam(c, "workspaceId")
		if !ok {
			return
		}

		projectUUID, ok := parseUUIDParam(c, "projectId")
		if !ok {
			return
		}

		//查询项目
		got, err := queries.GetProject(c.Request.Context(), store.GetProjectParams{
			WorkspaceID: workspaceUUID,
			ID:          projectUUID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				handler.Error(c, http.StatusNotFound, "NOT_FOUND", "项目不存在")
				return
			}
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "获取项目失败")
			return
		}

		//校验
		var req UpdateProjectDto
		if err := c.ShouldBindJSON(&req); err != nil {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "请求体不是合法的 JSON")
			return
		}
		if req.Name.Set {
			if !req.Name.Valid || strings.TrimSpace(req.Name.Value) == "" {
				handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "name 为必填字段")
				return
			}
			got.Name = req.Name.Value
		}
		if req.Description.Set {
			if req.Description.Valid {
				got.Description = req.Description.Value
			} else {
				got.Description = ""
			}
		}
		if req.Status.Set {
			if req.Status.Valid {
				if !store.ProjectStatus(req.Status.Value).Valid() {
					handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "status 不符合规范")
					return
				}
				got.Status = store.ProjectStatus(req.Status.Value)
			}
			//一定有值，不可能设置为空
		}
		if req.Priority.Set {
			if req.Priority.Valid {
				if req.Priority.Value < 0 || req.Priority.Value > 4 {
					handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "priority 不符合规范")
					return
				}
				got.Priority = int16(req.Priority.Value)
			}
			//一定有值，不可能设置为空
		}
		if req.LeadId.Set {
			if req.LeadId.Valid {
				// lead 必须存在于本工作区；互斥校验统一后置到合并完成之后
				if !checkLeaderLegal(c, queries, workspaceUUID, req.LeadId.Value) {
					return
				}
				got.LeadID = &req.LeadId.Value
			} else {
				got.LeadID = nil
			}
		}
		if req.StartDate.Set {
			got.StartDate = req.StartDate.ValuePtr()
		}
		if req.TargetDate.Set {
			got.TargetDate = req.TargetDate.ValuePtr()
		}
		if req.MemberIds.Set {
			//去重 + 校验存在性（互斥校验统一后置到合并完成之后）
			req.MemberIds.Value = dedupeUUIDs(req.MemberIds.Value)
			if !checkMemberLegal(c, queries, workspaceUUID, req.MemberIds.Value) {
				return
			}
		}

		// R2 互斥校验：以「合并后的 lead × 最终成员集合」判定。
		// 同请求带 memberIds 时以请求集合为准——支持单次 PATCH 把成员提升为 lead
		// （前端护栏会同时发移出后的 memberIds）；否则回退 DB 现有成员
		// （此时新 lead 仍在成员表，需 400 提示调用方先移出）
		if got.LeadID != nil {
			var memberIDs []uuid.UUID
			if req.MemberIds.Set {
				if req.MemberIds.Valid {
					memberIDs = req.MemberIds.Value
				}
				// Valid=false（显式 null 清空成员）保持空集，不会冲突
			} else {
				mbCheck, err := queries.ListProjectMembers(c.Request.Context(), projectUUID)
				if err != nil {
					handler.Error(c, http.StatusInternalServerError, "INTERNAL", "获取项目成员失败")
					return
				}
				memberIDs = make([]uuid.UUID, len(mbCheck))
				for i, m := range mbCheck {
					memberIDs[i] = m.ID
				}
			}
			if slices.Contains(memberIDs, *got.LeadID) {
				handler.Error(c, http.StatusBadRequest, "LEAD_MEMBER_CONFLICT", "leader不能同时是成员")
				return
			}
		}

		//beginTx
		tx, err := pool.Begin(c.Request.Context())
		if err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "数据库事务开始失败")
			return
		}
		defer tx.Rollback(c.Request.Context()) // Commit 后调用是 no-op，兜底
		q := store.New(pool).WithTx(tx)

		//members处理
		if req.MemberIds.Set {
			//删除后新增
			err = q.DeleteProjectMembers(c.Request.Context(), projectUUID)
			if err != nil {
				handler.Error(c, http.StatusInternalServerError, "INTERNAL", "删除项目成员失败")
				return
			}
			if req.MemberIds.Valid {
				err = q.AddProjectMembers(c.Request.Context(), store.AddProjectMembersParams{
					ProjectID: projectUUID,
					Column2:   req.MemberIds.Value,
				})
				if err != nil {
					handler.Error(c, http.StatusInternalServerError, "INTERNAL", "添加项目成员失败")
					return
				}
			}
			//为nil时删除不再新增
		}

		//更新项目
		_, err = q.UpdateProject(c.Request.Context(), store.UpdateProjectParams{
			ID:          projectUUID,
			Name:        got.Name,
			Description: got.Description,
			Status:      got.Status,
			Priority:    got.Priority,
			LeadID:      got.LeadID,
			StartDate:   got.StartDate,
			TargetDate:  got.TargetDate,
			WorkspaceID: workspaceUUID,
		})
		if err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "更新项目失败")
			return
		}

		if err := tx.Commit(c.Request.Context()); err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "更新项目-数据库事务提交失败")
			return
		}

		// 提交后重读，装配 ProjectDetail（UpdateProject 返回裸 Project，缺 taskCount/lead，重读更省事）
		projectDetail, ok := buildProjectDetail(c, queries, workspaceUUID, projectUUID)
		if !ok {
			return
		}
		c.JSON(http.StatusOK, projectDetail)
	}
}

func SoftDeleteProject(pool *pgxpool.Pool) gin.HandlerFunc {
	return func(c *gin.Context) {
		workspaceUUID, ok := parseUUIDParam(c, "workspaceId")
		if !ok {
			return
		}

		projectUUID, ok := parseUUIDParam(c, "projectId")
		if !ok {
			return
		}

		//beginTx
		tx, err := pool.Begin(c.Request.Context())
		if err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "数据库事务开始失败")
			return
		}
		defer tx.Rollback(c.Request.Context()) // Commit 后调用是 no-op，兜底
		q := store.New(pool).WithTx(tx)

		//soft delete project - exec->execRows 删除不存在的项目还是需要报错
		affected, err := q.SoftDeleteProject(c.Request.Context(), store.SoftDeleteProjectParams{
			WorkspaceID: workspaceUUID,
			ID:          projectUUID,
		})
		if err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "软删除项目失败")
			return
		}
		if affected == 0 {
			handler.Error(c, http.StatusNotFound, "NOT_FOUND", "项目未找到")
			return
		}

		//将相关任务解除关联
		err = q.DetachProjectTasks(c.Request.Context(), &projectUUID)
		if err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "解除任务关联失败")
			return
		}

		if err := tx.Commit(c.Request.Context()); err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "软删除项目-数据库事务提交失败")
			return
		}

		c.Status(http.StatusNoContent)
	}
}

// util functions

// projectStatus枚举的业务顺序（生命周期：backlog → planned → in_progress → completed → canceled）
// 不能直接比较字符串：字典序会把 canceled 排在 completed/planned/in_progress 之前，不符合业务顺序
var projectStatusRank = map[store.ProjectStatus]int{
	store.ProjectStatusBacklog:    0,
	store.ProjectStatusPlanned:    1,
	store.ProjectStatusInProgress: 2,
	store.ProjectStatusCompleted:  3,
	store.ProjectStatusCanceled:   4,
}

// project根据条件排序
func sortProjects(projects []store.ListProjectsByWorkspaceRow, field, order string) []store.ListProjectsByWorkspaceRow {
	asc := order == "asc"
	// slices.SortFunc 比较函数返回 int：负数表示 a 排在 b 前，降序时取反
	// time.Time 不满足 cmp.Ordered 约束，需用其 Compare 方法
	slices.SortStableFunc(projects, func(a, b store.ListProjectsByWorkspaceRow) int {
		var c int
		switch field {
		case "name":
			c = strings.Compare(a.Name, b.Name)
		case "priority":
			c = cmp.Compare(a.Priority, b.Priority)
		case "status":
			c = projectStatusRank[a.Status] - projectStatusRank[b.Status]
		default:
			c = a.CreatedAt.Compare(b.CreatedAt)
		}
		if asc {
			return c
		}
		return -c
	})
	return projects
}

// 校验与装配 helper：失败时均已写好错误响应并返回 false / ok=false，
// 调用方必须 `if !ok { return }`——helper 内的 return 只退出 helper，不会中断调用方

// parseUUIDParam 解析路径参数中的 UUID
func parseUUIDParam(c *gin.Context, name string) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param(name))
	if err != nil {
		handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", name+" 不符合 UUID 格式")
		return uuid.Nil, false
	}
	return id, true
}

// dedupeUUIDs 去重：slices.Compact 只压缩连续的重复元素，须先排序
// uuid.UUID 是裸的 [16]byte 数组，没有 Compare 方法（不同于 time.Time），
// 且 google/uuid v1.6.0 也没有包级 uuid.Compare 函数，故用 bytes.Compare 按字节比较
func dedupeUUIDs(ids []uuid.UUID) []uuid.UUID {
	slices.SortFunc(ids, func(a, b uuid.UUID) int {
		return bytes.Compare(a[:], b[:])
	})
	return slices.Compact(ids)
}

// checkLeaderLegal 校验 leader 属于本工作区（GetMember 带 id + workspace_id 双条件，点查）
func checkLeaderLegal(c *gin.Context, queries *store.Queries, workspaceUUID, leaderID uuid.UUID) bool {
	_, err := queries.GetMember(c.Request.Context(), store.GetMemberParams{
		ID:          leaderID,
		WorkspaceID: workspaceUUID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "leadId 不是本工作区的成员")
			return false
		}
		handler.Error(c, http.StatusInternalServerError, "INTERNAL", "获取成员失败")
		return false
	}
	return true
}

// checkMemberLegal 校验 memberIds 全部属于本工作区
func checkMemberLegal(c *gin.Context, queries *store.Queries, workspaceUUID uuid.UUID, memberIds []uuid.UUID) bool {
	if len(memberIds) == 0 {
		return true // 空列表（含显式清空）无需查询
	}
	legalMembers, err := queries.ListMembersByWorkspace(c.Request.Context(), workspaceUUID)
	if err != nil {
		handler.Error(c, http.StatusInternalServerError, "INTERNAL", "获取工作区成员列表失败")
		return false
	}
	for _, memberID := range memberIds {
		if !slices.ContainsFunc(legalMembers, func(m store.Member) bool {
			return m.ID == memberID
		}) {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "包含非法成员ID")
			return false
		}
	}
	return true
}

// buildProjectDetail 重读项目并装配 ProjectDetail（Create/Get/Update 统一入口）
func buildProjectDetail(c *gin.Context, queries *store.Queries, workspaceUUID, projectUUID uuid.UUID) (ProjectDetail, bool) {
	got, err := queries.GetProject(c.Request.Context(), store.GetProjectParams{
		WorkspaceID: workspaceUUID,
		ID:          projectUUID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			handler.Error(c, http.StatusNotFound, "NOT_FOUND", "项目不存在")
			return ProjectDetail{}, false
		}
		handler.Error(c, http.StatusInternalServerError, "INTERNAL", "获取项目失败")
		return ProjectDetail{}, false
	}
	members, err := queries.ListProjectMembers(c.Request.Context(), projectUUID)
	if err != nil {
		handler.Error(c, http.StatusInternalServerError, "INTERNAL", "获取项目成员失败")
		return ProjectDetail{}, false
	}
	detail := ProjectDetail{
		ProjectRow:  toProjectRow2(got),
		Description: got.Description,
		// 显式 make：无成员时 JSON 输出 [] 而不是 null
		Members: make([]member.MemberRef, 0, len(members)),
	}
	for _, mb := range members {
		detail.Members = append(detail.Members, member.MemberRef{
			ID:          mb.ID,
			Name:        mb.Name,
			AvatarColor: mb.AvatarColor,
		})
	}
	return detail, true
}
