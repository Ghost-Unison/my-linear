package project

import (
	"bytes"
	"errors"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/Ghost-Unison/my-linear/myLinearBackEnd/internal/filter"
	"github.com/Ghost-Unison/my-linear/myLinearBackEnd/internal/handler"
	"github.com/Ghost-Unison/my-linear/myLinearBackEnd/internal/label"
	"github.com/Ghost-Unison/my-linear/myLinearBackEnd/internal/member"
	"github.com/Ghost-Unison/my-linear/myLinearBackEnd/internal/store"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func ListProjectsByWorkspace(pool *pgxpool.Pool) gin.HandlerFunc {
	queries := store.New(pool)
	return func(c *gin.Context) {
		workspaceUUID, ok := handler.ParseUUIDParam(c, "workspaceId")
		if !ok {
			return
		}

		//query
		projects, err := queries.ListProjectsByWorkspace(c.Request.Context(), workspaceUUID)
		if err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "获取项目列表失败")
			return
		}

		// P2 条件列表过滤（P2.md §2.5，Go 层求值）；排序已前端化（P2-B），
		// 基底序由 ListProjectsByWorkspace 的 ORDER BY created_at DESC 承载（Manual ordering 语义）
		//把 URL 字符串翻译成条件对象
		conds := filter.Parse(c.QueryArray("f"), projectFilterSpecs)

		// 批量取回行内嵌引用：labels / members（行完备 api.md §2.9；members 为 P2-B 补入，
		// display options 的 Member 分组 / Members 列消费）
		projectIds := make([]uuid.UUID, 0, len(projects))
		for _, project := range projects {
			projectIds = append(projectIds, project.ID)
		}
		projectLabelMap, ok := buildProjectLabelMap(c, queries, projectIds)
		if !ok {
			return
		}
		projectMemberMap, ok := buildProjectMemberMap(c, queries, projectIds)
		if !ok {
			return
		}

		// convert to response format
		projectRows := make([]ProjectRow, 0, len(projects))
		for _, item := range projects {
			projectRows = append(projectRows, toProjectRow(item, projectLabelMap[item.ID], projectMemberMap[item.ID]))
		}

		// 逐行过安检，所有条件都点头才放行（member 集合直读行内嵌 Members，无需另取 id 映射）
		projectRows = filter.Apply(projectRows, conds, projectValGetter(), time.Now())
		c.JSON(http.StatusOK, projectRows)
	}
}

func CreateProject(pool *pgxpool.Pool) gin.HandlerFunc {
	queries := store.New(pool)
	return func(c *gin.Context) {
		workspaceUUID, ok := handler.ParseUUIDParam(c, "workspaceId")
		if !ok {
			return
		}

		// parse request body
		var req CreateProjectDto
		if err := c.ShouldBindJSON(&req); err != nil {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "请求体不是合法的 JSON")
			return
		}
		if strings.TrimSpace(req.Name) == "" {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "name 为必填字段")
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

		//beginTx
		tx, err := pool.Begin(c.Request.Context())
		if err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "数据库事务开始失败")
			return
		}
		defer tx.Rollback(c.Request.Context()) // Commit 后调用是 no-op，兜底
		q := store.New(pool).WithTx(tx)

		//根据TOCTOU原则，需要查库的校验也都放在事务中
		//校验 leader 是否存在于本工作区
		if req.LeadId != nil && !checkLeaderLegal(c, q, workspaceUUID, *req.LeadId) {
			return
		}
		//memberIds可能有重复，先去重再校验存在性
		req.MemberIds = dedupeUUIDs(req.MemberIds)
		if !checkMemberLegal(c, q, workspaceUUID, req.MemberIds) {
			return
		}
		//labelIds同样处理 -去重+校验（R6；错误码映射统一在 label.CheckLabelIDsLegal）
		handledLabelIds, ok := label.CheckLabelIDsLegal(c, q, workspaceUUID, store.LabelScopeProject, req.LabelIds)
		if !ok {
			return
		}

		//CreateProject
		created, err := q.CreateProject(c.Request.Context(), store.CreateProjectParams{
			WorkspaceID: workspaceUUID,
			Name:        req.Name,
			Description: req.Description,
			Status:      store.ProjectStatus(req.Status), //string转枚举
			Priority:    int16(req.Priority),
			LeadID:      req.LeadId,
			StartDate:   req.StartDate,
			TargetDate:  req.TargetDate,
		})
		if err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "创建项目失败")
			return
		}

		// AddProjectMembers
		err = q.AddProjectMembers(c.Request.Context(), store.AddProjectMembersParams{
			ProjectID: created.ID,
			MemberIds: req.MemberIds,
		})
		if err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "添加项目成员失败")
			return
		}

		// AddProjectLabels
		if err := q.AddProjectLabels(c.Request.Context(), store.AddProjectLabelsParams{
			ProjectID: created.ID,
			LabelIds:  handledLabelIds,
		}); err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "添加项目标签失败")
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
		workspaceUUID, ok := handler.ParseUUIDParam(c, "workspaceId")
		if !ok {
			return
		}
		projectUUID, ok := handler.ParseUUIDParam(c, "projectId")
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
		workspaceUUID, ok := handler.ParseUUIDParam(c, "workspaceId")
		if !ok {
			return
		}
		projectUUID, ok := handler.ParseUUIDParam(c, "projectId")
		if !ok {
			return
		}

		var req UpdateProjectDto
		if err := c.ShouldBindJSON(&req); err != nil {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "请求体不是合法的 JSON")
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

		//查询项目
		got, err := q.GetProject(c.Request.Context(), store.GetProjectParams{
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
			// status 是 NOT NULL 枚举，没有“空”的落库形态：显式 null 一律 400（api.md §2.4）。
			// 不先判 Valid 虽然也能因 "" 不是合法枚举而报错，但意图不明确
			if !req.Status.Valid || !store.ProjectStatus(req.Status.Value).Valid() {
				handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "status 不符合规范")
				return
			}
			got.Status = store.ProjectStatus(req.Status.Value)
		}
		if req.Priority.Set {
			// priority 必须先判 Valid：显式 null 时 Value 是零值 0，而 0 能通过 0~4 范围校验
			// 且本身是合法优先级（No priority），不拦就会静默把优先级改成 0
			if !req.Priority.Valid || req.Priority.Value < 0 || req.Priority.Value > 4 {
				handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "priority 不符合规范")
				return
			}
			got.Priority = int16(req.Priority.Value)
		}
		if req.LeadId.Set {
			if req.LeadId.Valid {
				// lead 必须存在于本工作区；互斥校验统一后置到合并完成之后
				if !checkLeaderLegal(c, q, workspaceUUID, req.LeadId.Value) {
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
			if !checkMemberLegal(c, q, workspaceUUID, req.MemberIds.Value) {
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
				mbCheck, err := q.ListProjectMembers(c.Request.Context(), projectUUID)
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
					MemberIds: req.MemberIds.Value,
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
		workspaceUUID, ok := handler.ParseUUIDParam(c, "workspaceId")
		if !ok {
			return
		}
		projectUUID, ok := handler.ParseUUIDParam(c, "projectId")
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

// buildProjectMemberMap 批量取 project→members 引用列表（ProjectRow 内嵌 members，行完备 P2-B），
// 与 buildProjectLabelMap 同构避免 N+1；组内 m.name 升序由 SQL 的 ORDER BY pm.project_id, m.name 保证
//（与 ListProjectMembers 同构），handler 只做 append 不重排；无成员的项目在 map 中无 key，
// 由 toProjectRow 兜底为 []。失败时已写入 500 响应，返回 ok=false，调用方直接 return（同 buildProjectLabelMap 约定）
func buildProjectMemberMap(c *gin.Context, queries *store.Queries, projectIds []uuid.UUID) (map[uuid.UUID][]member.MemberRef, bool) {
	rows, err := queries.ListMembersByProjectIds(c.Request.Context(), projectIds)
	if err != nil {
		handler.Error(c, http.StatusInternalServerError, "INTERNAL", "获取项目成员失败")
		return nil, false
	}
	memberMap := make(map[uuid.UUID][]member.MemberRef, len(rows))
	for _, r := range rows {
		memberMap[r.ProjectID] = append(memberMap[r.ProjectID], member.MemberRef{
			ID:          r.ID,
			Name:        r.Name,
			AvatarColor: r.AvatarColor,
		})
	}
	return memberMap, true
}

// 校验与装配 helper：失败时均已写好错误响应并返回 false / ok=false，
// 调用方必须 `if !ok { return }`——helper 内的 return 只退出 helper，不会中断调用方

// dedupeUUIDs 去重：slices.Compact 只压缩连续的重复元素，须先排序。
// 注意：原地排序，会打乱入参顺序（调用方传的是请求 DTO 自己的切片，且
// ListProjectMembers 按 m.name 排序，成员展示顺序与插入顺序无关，故无影响）。
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
	// 先建索引再查：对每个 memberID 做 slices.ContainsFunc 全量扫描是 O(n×m)
	legalSet := make(map[uuid.UUID]struct{}, len(legalMembers))
	for _, m := range legalMembers {
		legalSet[m.ID] = struct{}{}
	}
	for _, memberID := range memberIds {
		if _, ok := legalSet[memberID]; !ok {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "包含非法成员ID")
			return false
		}
	}
	return true
}

// buildProjectDetail 重读项目并装配 ProjectDetail（Create/Get/Update/PUT labels 统一入口）。
// 包内私有：四个调用方均在本包（PUT labels 也放本包以复用本函数，见 UpdateProjectLabels 注释）
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
	//获取project members
	members, err := queries.ListProjectMembers(c.Request.Context(), projectUUID)
	if err != nil {
		handler.Error(c, http.StatusInternalServerError, "INTERNAL", "获取项目成员失败")
		return ProjectDetail{}, false
	}
	//获取project labels（sqlc :many 零行时返 nil，由 toProjectDetail 内部的 ToLabelRefs 兜底为 []）
	labels, err := queries.ListProjectLabels(c.Request.Context(), projectUUID)
	if err != nil {
		handler.Error(c, http.StatusInternalServerError, "INTERNAL", "获取项目标签失败")
		return ProjectDetail{}, false
	}
	detail := toProjectDetail(got, labels, members)
	return detail, true
}

// buildProjectLabelMap 一次取回全部项目的标签并按 projectId 分组（ListProjectsByWorkspace 用），
// 避免逐行查标签的 N+1；与 task.buildTaskLabelMap 同形。
// 组内 created_at 升序由 SQL 的 ORDER BY pl.project_id, l.created_at 保证（api.md §4），handler 只做 append 不重排；
// 无标签的项目在 map 中无 key，由 toProjectRow 兜底为 []。
// 失败时已写入 500 响应，返回 ok=false，调用方直接 return（同 buildProjectDetail 约定）
func buildProjectLabelMap(c *gin.Context, queries *store.Queries, projectIds []uuid.UUID) (map[uuid.UUID][]label.LabelRef, bool) {
	projectLabels, err := queries.ListLabelsByProjectIds(c.Request.Context(), projectIds)
	if err != nil {
		handler.Error(c, http.StatusInternalServerError, "INTERNAL", "获取项目标签失败")
		return nil, false
	}
	projectLabelMap := make(map[uuid.UUID][]label.LabelRef, len(projectLabels))
	for _, projectLabel := range projectLabels {
		projectLabelMap[projectLabel.ProjectID] = append(projectLabelMap[projectLabel.ProjectID], label.NewLabelRef(projectLabel.ID, projectLabel.Name, projectLabel.Color))
	}
	return projectLabelMap, true
}

// UpdateProjectLabels 全量替换打标（api.md §9 PUT /projects/:id/labels）。
// 放在 project 包：需复用 buildProjectDetail 装配响应；依赖方向 project → label，避免循环依赖
func UpdateProjectLabels(pool *pgxpool.Pool) gin.HandlerFunc {
	queries := store.New(pool)
	return func(c *gin.Context) {
		workspaceUUID, ok := handler.ParseUUIDParam(c, "workspaceId")
		if !ok {
			return
		}
		projectUUID, ok := handler.ParseUUIDParam(c, "projectId")
		if !ok {
			return
		}

		//先解析请求体，避免非法请求占用事务
		var req label.BatchUpdateLabelIDs
		if err := c.ShouldBindJSON(&req); err != nil {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "请求体不是合法的 JSON")
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

		//校验项目是否存在
		projectExist, err := q.IfProjectExists(c.Request.Context(), store.IfProjectExistsParams{
			ID:          projectUUID,
			WorkspaceID: workspaceUUID,
		})
		if err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "获取项目失败")
			return
		}
		if !projectExist {
			handler.Error(c, http.StatusNotFound, "NOT_FOUND", "项目不存在")
			return
		}

		if req.LabelIds.Set {
			if req.LabelIds.Valid {
				//合法性校验（R6）：同 workspace + scope=project；去重避免联结表主键冲突
				ids, ok := label.CheckLabelIDsLegal(c, q, workspaceUUID, store.LabelScopeProject, req.LabelIds.Value)
				if !ok {
					return
				}
				//删除
				if err := q.DeleteProjectLabels(c.Request.Context(), projectUUID); err != nil {
					handler.Error(c, http.StatusInternalServerError, "INTERNAL", "删除项目标签失败")
					return
				}
				//添加（空数组 = 清空全部，unnest 空数组插入 0 行）
				if err := q.AddProjectLabels(c.Request.Context(), store.AddProjectLabelsParams{
					ProjectID: projectUUID,
					LabelIds:  ids,
				}); err != nil {
					handler.Error(c, http.StatusInternalServerError, "INTERNAL", "添加项目标签失败")
					return
				}
			} else {
				//显式 null = 清空全部
				if err := q.DeleteProjectLabels(c.Request.Context(), projectUUID); err != nil {
					handler.Error(c, http.StatusInternalServerError, "INTERNAL", "删除项目标签失败")
					return
				}
			}
		}

		if err := tx.Commit(c.Request.Context()); err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "数据库事务提交失败")
			return
		}

		//提交后重新获取projectDetail
		projectDetail, ok := buildProjectDetail(c, queries, workspaceUUID, projectUUID)
		if !ok {
			return
		}
		c.JSON(http.StatusOK, projectDetail)
	}
}
