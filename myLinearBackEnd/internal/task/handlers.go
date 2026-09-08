package task

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/Ghost-Unison/my-linear/myLinearBackEnd/internal/filter"
	"github.com/Ghost-Unison/my-linear/myLinearBackEnd/internal/handler"
	"github.com/Ghost-Unison/my-linear/myLinearBackEnd/internal/label"
	"github.com/Ghost-Unison/my-linear/myLinearBackEnd/internal/store"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// 获取项目下的任务，不放在project下，放在project下需要引入task，会造成循环依赖
func ListTasksByProject(pool *pgxpool.Pool) gin.HandlerFunc {
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

		// P2 条件列表过滤：与任务列表页同 f= 契约（P2.md §2.5）；
		// Issues tab 面 project 字段隐含，前端 Filter 菜单不提供（P2.md §2.2）
		conds := filter.Parse(c.QueryArray("f"), taskFilterSpecs)

		//query
		tasks, err := queries.ListTasksByProject(c.Request.Context(), store.ListTasksByProjectParams{
			WorkspaceID: workspaceUUID,
			ProjectID:   &projectUUID,
		})
		if err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "获取任务失败")
			return
		}

		// 批量取标签并按 taskId 分组
		taskIds := make([]uuid.UUID, 0, len(tasks))
		for _, task := range tasks {
			taskIds = append(taskIds, task.ID)
		}
		taskLabelMap, ok := buildTaskLabelMap(c, queries, taskIds)
		if !ok {
			return
		}

		taskRows := make([]TaskRow, 0, len(tasks))
		for _, task := range tasks {
			taskRows = append(taskRows, toTaskRow(task, taskLabelMap[task.ID]))
		}
		// 条件列表求值（条件间 AND）；提取器与任务列表页共用 taskVal
		taskRows = filter.Apply(taskRows, conds, taskVal, time.Now())
		c.JSON(http.StatusOK, taskRows)
	}
}

// 获取工作区下的所有任务
func ListTasksByWorkspace(pool *pgxpool.Pool) gin.HandlerFunc {
	queries := store.New(pool)
	return func(c *gin.Context) {
		workspaceUUID, ok := handler.ParseUUIDParam(c, "workspaceId")
		if !ok {
			return
		}

		// P2 条件列表过滤：f= 参数 → 引擎条件列表（P2.md §2.5，Go 层求值）；
		// 遗留别名 filter= 仅当无 f= 时生效（前端 tab 迁移 f= 后退役）
		// /tasks?f=status.anyOf.todo,done&f=labels.incl.l1
		conds := filter.Parse(c.QueryArray("f"), taskFilterSpecs)
		if len(conds) == 0 {
			legacy, ok := legacyStatusConds(c.DefaultQuery("filter", "all"))
			if !ok {
				handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "filter 参数错误")
				return
			}
			conds = legacy
		}

		//query
		// P2：过滤求值移至 Go 层引擎，SQL statuses 数组参数退役恒传非 nil 空切片
		//（nil 会被 pgx 编码为 SQL NULL，cardinality(NULL)=NULL 使谓词静默返回空集）
		tasks, err := queries.ListTasksByWorkspace(c.Request.Context(), store.ListTasksByWorkspaceParams{
			WorkspaceID: workspaceUUID,
			Statuses:    make([]store.TaskStatus, 0),
		})
		if err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "获取任务列表失败")
			return
		}

		//基底序（status 枚举序 + created_at）由 SQL 固定 ORDER BY 保证，过滤不重排

		// 批量取标签并按 taskId 分组
		taskIds := make([]uuid.UUID, 0, len(tasks))
		for _, task := range tasks {
			taskIds = append(taskIds, task.ID)
		}
		taskLabelMap, ok := buildTaskLabelMap(c, queries, taskIds)
		if !ok {
			return
		}

		// convert to response format
		taskRows := make([]TaskRow, 0, len(tasks))
		for _, task := range tasks {
			taskRows = append(taskRows, toTaskRow(task, taskLabelMap[task.ID]))
		}
		// 条件列表求值（条件间 AND）；labels 联结数据已在行上，提取器直读
		taskRows = filter.Apply(taskRows, conds, taskVal, time.Now())
		c.JSON(http.StatusOK, taskRows)
	}
}

func CreateTask(pool *pgxpool.Pool) gin.HandlerFunc {
	queries := store.New(pool)
	return func(c *gin.Context) {
		workspaceUUID, ok := handler.ParseUUIDParam(c, "workspaceId")
		if !ok {
			return
		}

		//parse request body
		var req CreateTaskDto
		if err := c.ShouldBindJSON(&req); err != nil {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "请求体不是合法的 JSON")
			return
		}
		if strings.TrimSpace(req.Title) == "" {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "title 为必填字段")
			return
		}
		//校验枚举值是否合法 - status一定有值
		if !store.TaskStatus(req.Status).Valid() {
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

		//如果传了parentId - 则projectId和workspaceId取父任务的，忽略传入的projectId和workspaceId
		//传了projectId,需要校验 projectId 是否属于 workspaceId
		//传assigneeId，校验是否为本工作区成员（R3 仅工作区级，与项目 lead/members 解绑）
		if req.ParentId != nil && *req.ParentId != uuid.Nil {
			parentTask, err := q.GetTask(c.Request.Context(), store.GetTaskParams{
				ID:          *req.ParentId,
				WorkspaceID: workspaceUUID,
			})
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					handler.Error(c, http.StatusBadRequest, "CROSS_WORKSPACE", "父任务不存在于该工作区")
					return
				}
				handler.Error(c, http.StatusInternalServerError, "INTERNAL", "获取父任务失败")
				return
			}
			req.ProjectId = parentTask.ProjectID
		} else if req.ProjectId != nil && *req.ProjectId != uuid.Nil {
			_, err := q.GetProject(c.Request.Context(), store.GetProjectParams{
				ID:          *req.ProjectId,
				WorkspaceID: workspaceUUID,
			})
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					handler.Error(c, http.StatusBadRequest, "CROSS_WORKSPACE", "该项目不存在于该工作区")
					return
				}
				handler.Error(c, http.StatusInternalServerError, "INTERNAL", "获取项目失败")
				return
			}
		}
		if req.AssigneeId != nil && *req.AssigneeId != uuid.Nil {
			if !checkAssigneeLegal(c, q, workspaceUUID, *req.AssigneeId) {
				return
			}
		}

		//labelIds同样处理 -去重+校验（R6；错误码映射统一在 label.CheckLabelIDsLegal）
		handledLabelIds, ok := label.CheckLabelIDsLegal(c, q, workspaceUUID, store.LabelScopeTask, req.LabelIds)
		if !ok {
			return
		}

		//CreateTask
		task, err := q.CreateTask(c.Request.Context(), store.CreateTaskParams{
			WorkspaceID: workspaceUUID,
			ProjectID:   req.ProjectId,
			ParentID:    req.ParentId,
			Title:       req.Title,
			Description: req.Description,
			Status:      store.TaskStatus(req.Status),
			Priority:    int16(req.Priority),
			AssigneeID:  req.AssigneeId,
			DueDate:     req.DueDate,
		})
		if err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "创建任务失败")
			return
		}

		//AddTaskLabels
		if err := q.AddTaskLabels(c.Request.Context(), store.AddTaskLabelsParams{
			TaskID:   task.ID,
			LabelIds: handledLabelIds,
		}); err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "添加任务标签失败")
			return
		}

		if err := tx.Commit(c.Request.Context()); err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "创建任务-数据库事务提交失败")
			return
		}

		//提交后重读，组装TaskDetail并返回
		taskDetail, ok := buildTaskDetail(c, queries, workspaceUUID, task.ID)
		if !ok {
			return
		}
		c.JSON(http.StatusCreated, taskDetail)
	}
}

func GetTask(pool *pgxpool.Pool) gin.HandlerFunc {
	queries := store.New(pool)
	return func(c *gin.Context) {
		workspaceUUID, ok := handler.ParseUUIDParam(c, "workspaceId")
		if !ok {
			return
		}
		taskUUID, ok := handler.ParseUUIDParam(c, "taskId")
		if !ok {
			return
		}

		//get - queryTaskDetail
		taskDetail, ok := buildTaskDetail(c, queries, workspaceUUID, taskUUID)
		if !ok {
			return
		}
		c.JSON(http.StatusOK, taskDetail)
	}
}

func GetTaskSubtree(pool *pgxpool.Pool) gin.HandlerFunc {
	queries := store.New(pool)
	return func(c *gin.Context) {
		workspaceUUID, ok := handler.ParseUUIDParam(c, "workspaceId")
		if !ok {
			return
		}
		taskUUID, ok := handler.ParseUUIDParam(c, "taskId")
		if !ok {
			return
		}

		//先判断锚点是否存在：GetTask 带 3 个 LEFT JOIN + 父任务统计递归 CTE，仅用于存在性判断太重，
		//改用 IfTaskExist（EXISTS 点查，同 UpdateTaskLabels）
		taskExist, err := queries.IfTaskExist(c.Request.Context(), store.IfTaskExistParams{
			ID:          taskUUID,
			WorkspaceID: workspaceUUID,
		})
		if err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "获取任务失败")
			return
		}
		if !taskExist {
			handler.Error(c, http.StatusNotFound, "NOT_FOUND", "锚点任务不存在")
			return
		}

		//查询任务及其子任务
		wholeTasks, err := queries.GetTaskSubtree(c.Request.Context(), store.GetTaskSubtreeParams{
			WorkspaceID: workspaceUUID,
			ID:          taskUUID,
		})
		if err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "获取任务失败")
			return
		}

		// 批量取标签并按 taskId 分组
		taskIds := make([]uuid.UUID, 0, len(wholeTasks))
		for _, task := range wholeTasks {
			taskIds = append(taskIds, task.ID)
		}
		taskLabelMap, ok := buildTaskLabelMap(c, queries, taskIds)
		if !ok {
			return
		}

		taskNodes := make([]TaskNode, 0, len(wholeTasks))
		for _, node := range wholeTasks {
			taskNodes = append(taskNodes, toTaskNode(node, taskLabelMap[node.ID]))
		}
		c.JSON(http.StatusOK, taskNodes)
	}
}

func UpdateTask(pool *pgxpool.Pool) gin.HandlerFunc {
	queries := store.New(pool)
	return func(c *gin.Context) {
		workspaceUUID, ok := handler.ParseUUIDParam(c, "workspaceId")
		if !ok {
			return
		}
		taskUUID, ok := handler.ParseUUIDParam(c, "taskId")
		if !ok {
			return
		}

		var req UpdateTaskDto
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

		//查询
		got, err := q.GetTask(c.Request.Context(), store.GetTaskParams{
			ID:          taskUUID,
			WorkspaceID: workspaceUUID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				handler.Error(c, http.StatusNotFound, "NOT_FOUND", "任务不存在")
				return
			}
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "获取任务失败")
			return
		}

		//校验
		if req.Title.Set {
			if !req.Title.Valid || strings.TrimSpace(req.Title.Value) == "" {
				handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "title 为必填字段")
				return
			}
			got.Title = req.Title.Value
		}
		if req.Description.Set {
			if req.Description.Valid {
				got.Description = req.Description.Value
			} else {
				got.Description = ""
			}
		}
		if req.Status.Set {
			// status 是 NOT NULL 枚举，没有“空”的落库形态：显式 null 一律 400（api.md §2.4）
			if !req.Status.Valid || !store.TaskStatus(req.Status.Value).Valid() {
				handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "status 不符合规范")
				return
			}
			got.Status = store.TaskStatus(req.Status.Value)
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
		if req.DueDate.Set {
			got.DueDate = req.DueDate.ValuePtr()
		}
		if req.ProjectId.Set {
			if req.ProjectId.Valid {
				//cross workspace校验
				_, err := q.GetProject(c.Request.Context(), store.GetProjectParams{
					ID:          req.ProjectId.Value,
					WorkspaceID: workspaceUUID,
				})
				if err != nil {
					if errors.Is(err, pgx.ErrNoRows) {
						handler.Error(c, http.StatusBadRequest, "CROSS_WORKSPACE", "项目不存在")
						return
					}
					handler.Error(c, http.StatusInternalServerError, "INTERNAL", "获取项目失败")
					return
				}
				got.ProjectID = &req.ProjectId.Value
			} else {
				got.ProjectID = nil
			}
		}
		if req.AssigneeId.Set {
			if req.AssigneeId.Valid {
				if !checkAssigneeLegal(c, q, workspaceUUID, req.AssigneeId.Value) {
					return
				}
				got.AssigneeID = &req.AssigneeId.Value
			} else {
				got.AssigneeID = nil
			}
		}

		//递归更新子任务所属项目
		if req.ProjectId.Set {
			err = q.SyncSubtreeProject(c.Request.Context(), store.SyncSubtreeProjectParams{
				ParentID:  &taskUUID,
				ProjectID: got.ProjectID,
			})
			if err != nil {
				handler.Error(c, http.StatusInternalServerError, "INTERNAL", "更新子任务所属项目失败")
				return
			}
		}

		//更新任务
		_, err = q.UpdateTask(c.Request.Context(), store.UpdateTaskParams{
			ID:          taskUUID,
			ProjectID:   got.ProjectID,
			Title:       got.Title,
			Description: got.Description,
			Status:      got.Status,
			Priority:    got.Priority,
			AssigneeID:  got.AssigneeID,
			DueDate:     got.DueDate,
			WorkspaceID: workspaceUUID,
		})
		if err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "更新任务失败")
			return
		}

		if err := tx.Commit(c.Request.Context()); err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "更新任务失败-数据库事务提交失败")
			return
		}

		//提交后重读
		taskDetail, ok := buildTaskDetail(c, queries, workspaceUUID, taskUUID)
		if !ok {
			return
		}
		c.JSON(http.StatusOK, taskDetail)

	}
}

func SoftDeleteTask(pool *pgxpool.Pool) gin.HandlerFunc {
	queries := store.New(pool)
	return func(c *gin.Context) {
		workspaceUUID, ok := handler.ParseUUIDParam(c, "workspaceId")
		if !ok {
			return
		}
		taskUUID, ok := handler.ParseUUIDParam(c, "taskId")
		if !ok {
			return
		}

		// soft delete task
		affected, err := queries.SoftDeleteTaskSubtree(c.Request.Context(), store.SoftDeleteTaskSubtreeParams{
			ID:          taskUUID,
			WorkspaceID: workspaceUUID,
		})
		if err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "软删除任务失败")
			return
		}
		if affected == 0 {
			handler.Error(c, http.StatusNotFound, "NOT_FOUND", "任务不存在")
			return
		}
		c.Status(http.StatusNoContent)
	}
}

// util functions

// checkAssigneeLegal 校验 assignee 属于本工作区（R3 仅工作区级校验：与项目 lead/members 解绑，对齐 Linear）
// GetMember 带 id + workspace_id 双条件点查；未命中即 400 INVALID_ASSIGNEE
func checkAssigneeLegal(c *gin.Context, queries *store.Queries, workspaceUUID, assigneeID uuid.UUID) bool {
	_, err := queries.GetMember(c.Request.Context(), store.GetMemberParams{
		ID:          assigneeID,
		WorkspaceID: workspaceUUID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			handler.Error(c, http.StatusBadRequest, "INVALID_ASSIGNEE", "指定的成员不是本工作区成员")
			return false
		}
		handler.Error(c, http.StatusInternalServerError, "INTERNAL", "获取成员失败")
		return false
	}
	return true
}

// buildTaskLabelMap 一次取回全部任务的标签并按 taskId 分组（ListTasksByProject /
// ListTasksByWorkspace / GetTaskSubtree 共用），避免逐行查标签的 N+1。
// 组内 created_at 升序由 SQL 的 ORDER BY tl.task_id, l.created_at 保证（api.md §4），
// handler 只做 append 不重排；无标签的任务在 map 中无 key，由 toTaskRow/toTaskNode 兜底为 []。
// 失败时已写入 500 响应，返回 ok=false，调用方直接 return（同 buildTaskDetail 约定）
func buildTaskLabelMap(c *gin.Context, queries *store.Queries, taskIds []uuid.UUID) (map[uuid.UUID][]label.LabelRef, bool) {
	taskLabels, err := queries.ListLabelsByTaskIds(c.Request.Context(), taskIds)
	if err != nil {
		handler.Error(c, http.StatusInternalServerError, "INTERNAL", "获取任务标签失败")
		return nil, false
	}
	taskLabelMap := make(map[uuid.UUID][]label.LabelRef, len(taskLabels))
	for _, taskLabel := range taskLabels {
		taskLabelMap[taskLabel.TaskID] = append(taskLabelMap[taskLabel.TaskID],
			label.NewLabelRef(taskLabel.ID, taskLabel.Name, taskLabel.Color))
	}
	return taskLabelMap, true
}

// buildTaskDetail 重读任务并装配 TaskDetail（Create/Get/Update/PUT labels 统一入口）。
// 包内私有：四个调用方均在本包（PUT labels 也放本包以复用本函数，见 UpdateTaskLabels 注释）
func buildTaskDetail(c *gin.Context, queries *store.Queries, workspaceUUID, taskUUID uuid.UUID) (TaskDetail, bool) {
	got, err := queries.GetTask(c.Request.Context(), store.GetTaskParams{
		ID:          taskUUID,
		WorkspaceID: workspaceUUID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			handler.Error(c, http.StatusNotFound, "NOT_FOUND", "任务不存在")
			return TaskDetail{}, false
		}
		handler.Error(c, http.StatusInternalServerError, "INTERNAL", "获取任务失败")
		return TaskDetail{}, false
	}
	//获取task labels（sqlc :many 零行时返 nil，由 toTaskDetail 内部的 ToLabelRefs 兜底为 []）
	labels, err := queries.ListTaskLabels(c.Request.Context(), taskUUID)
	if err != nil {
		handler.Error(c, http.StatusInternalServerError, "INTERNAL", "获取任务标签失败")
		return TaskDetail{}, false
	}
	detail := toTaskDetail(got, labels)
	return detail, true
}

// UpdateTaskLabels 全量替换打标（api.md §9 PUT /tasks/:id/labels）。
// 放在 task 包：需复用 buildTaskDetail 装配响应；依赖方向 task → label，避免循环依赖
func UpdateTaskLabels(pool *pgxpool.Pool) gin.HandlerFunc {
	queries := store.New(pool)
	return func(c *gin.Context) {
		workspaceUUID, ok := handler.ParseUUIDParam(c, "workspaceId")
		if !ok {
			return
		}
		taskUUID, ok := handler.ParseUUIDParam(c, "taskId")
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

		//校验任务是否存在
		taskExist, err := q.IfTaskExist(c.Request.Context(), store.IfTaskExistParams{
			ID:          taskUUID,
			WorkspaceID: workspaceUUID,
		})
		if err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "获取任务失败")
			return
		}
		if !taskExist {
			handler.Error(c, http.StatusNotFound, "NOT_FOUND", "任务不存在")
			return
		}

		if req.LabelIds.Set {
			if req.LabelIds.Valid {
				//合法性校验（R6）：同 workspace + scope=task；去重避免联结表主键冲突
				ids, ok := label.CheckLabelIDsLegal(c, q, workspaceUUID, store.LabelScopeTask, req.LabelIds.Value)
				if !ok {
					return
				}
				//删除
				if err := q.DeleteTaskLabels(c.Request.Context(), taskUUID); err != nil {
					handler.Error(c, http.StatusInternalServerError, "INTERNAL", "删除任务标签失败")
					return
				}
				//添加（空数组 = 清空全部，unnest 空数组插入 0 行）
				if err := q.AddTaskLabels(c.Request.Context(), store.AddTaskLabelsParams{
					TaskID:   taskUUID,
					LabelIds: ids,
				}); err != nil {
					handler.Error(c, http.StatusInternalServerError, "INTERNAL", "添加任务标签失败")
					return
				}
			} else {
				//显式 null = 清空全部
				if err := q.DeleteTaskLabels(c.Request.Context(), taskUUID); err != nil {
					handler.Error(c, http.StatusInternalServerError, "INTERNAL", "删除任务标签失败")
					return
				}
			}
		}

		if err := tx.Commit(c.Request.Context()); err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "数据库事务提交失败")
			return
		}

		//提交后重新获取taskDetail
		taskDetail, ok := buildTaskDetail(c, queries, workspaceUUID, taskUUID)
		if !ok {
			return
		}
		c.JSON(http.StatusOK, taskDetail)
	}
}
