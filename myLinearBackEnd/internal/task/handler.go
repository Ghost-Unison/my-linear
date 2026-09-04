package task

import (
	"errors"
	"github.com/Ghost-Unison/my-linear/myLinearBackEnd/internal/handler"
	"github.com/Ghost-Unison/my-linear/myLinearBackEnd/internal/store"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// 获取项目下的任务，不放在project下，放在project下需要引入task，会造成循环依赖
func GetTasksByProject(pool *pgxpool.Pool) gin.HandlerFunc {
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

		//query
		tasks, err := queries.ListTasksByProject(c.Request.Context(), store.ListTasksByProjectParams{
			WorkspaceID: workspaceUUID,
			ProjectID:   &projectUUID,
		})
		if err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "获取任务失败")
			return
		}

		var taskRows = make([]TaskRow, 0, len(tasks))
		for _, task := range tasks {
			taskRows = append(taskRows, toTaskRow(task))
		}
		c.JSON(http.StatusOK, taskRows)
	}
}

// 获取工作区下的所有任务
func ListTasksByWorkspace(pool *pgxpool.Pool) gin.HandlerFunc {
	queries := store.New(pool)
	return func(c *gin.Context) {
		workspaceUUID, ok := parseUUIDParam(c, "workspaceId")
		if !ok {
			return
		}

		//filter by query params
		filter := c.DefaultQuery("filter", "all") //all | active = todo+inprogress | backlog
		if filter != "all" && filter != "active" && filter != "backlog" {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "filter 参数错误")
			return
		}
		// 必须保持非 nil 空切片：nil 会被 pgx 编码为 SQL NULL，
		// cardinality(NULL)=NULL 使整个谓词为 NULL，查询静默返回空集. 使用sqlc生成的枚举需要提前注册
		statuses := make([]store.TaskStatus, 0)
		if filter == "active" {
			statuses = append(statuses, store.TaskStatusTodo, store.TaskStatusInProgress)
		} else if filter == "backlog" {
			statuses = append(statuses, store.TaskStatusBacklog)
		}

		//query
		tasks, err := queries.ListTasksByWorkspace(c.Request.Context(), store.ListTasksByWorkspaceParams{
			WorkspaceID: workspaceUUID,
			Statuses:    statuses,
		})
		if err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "获取任务列表失败")
			return
		}

		//没有自定义字段排序，在sql中默认按status和createTime升序固定排序

		// convert to response format
		resp := make([]TaskRow, 0, len(tasks))
		for _, task := range tasks {
			resp = append(resp, toTaskRow(task))
		}
		c.JSON(http.StatusOK, resp)
	}
}

func CreateTask(pool *pgxpool.Pool) gin.HandlerFunc {
	queries := store.New(pool)
	return func(c *gin.Context) {
		//parse request body
		var req CreateTaskDto
		if err := c.ShouldBindJSON(&req); err != nil {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "请求体不是合法的 JSON")
			return
		}
		if req.Title == "" {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "title 为必填字段")
			return
		}

		workspaceUUID, ok := parseUUIDParam(c, "workspaceId")
		if !ok {
			return
		}

		//如果传了parentId - 则projectId和workspaceId取父任务的，忽略传入的projectId和workspaceId
		//传了projectId,需要校验 projectId 是否属于 workspaceId
		//传assigneeId，校验是否为本工作区成员（R3 仅工作区级，与项目 lead/members 解绑）
		if req.ParentId != nil && *req.ParentId != uuid.Nil {
			parentTask, err := queries.GetTask(c.Request.Context(), store.GetTaskParams{
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
			_, err := queries.GetProject(c.Request.Context(), store.GetProjectParams{
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
			if !checkAssigneeLegal(c, queries, workspaceUUID, *req.AssigneeId) {
				return
			}
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

		task, err := queries.CreateTask(c.Request.Context(), store.CreateTaskParams{
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
		workspaceUUID, ok := parseUUIDParam(c, "workspaceId")
		if !ok {
			return
		}

		taskUUID, ok := parseUUIDParam(c, "taskId")
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
		taskUUID, ok := parseUUIDParam(c, "taskId")
		if !ok {
			return
		}

		workspaceUUID, ok := parseUUIDParam(c, "workspaceId")
		if !ok {
			return
		}

		//先GetTask判断锚点
		_, err := queries.GetTask(c.Request.Context(), store.GetTaskParams{
			ID:          taskUUID,
			WorkspaceID: workspaceUUID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				handler.Error(c, http.StatusNotFound, "NOT_FOUND", "锚点任务不存在")
				return
			}
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "获取任务失败")
			return
		}

		//查询任务及其子任务
		wholeTask, err := queries.GetTaskSubtree(c.Request.Context(), store.GetTaskSubtreeParams{
			WorkspaceID: workspaceUUID,
			ID:          taskUUID,
		})
		if err != nil {
			handler.Error(c, http.StatusInternalServerError, "INTERNAL", "获取任务失败")
			return
		}
		resp := make([]TaskNode, 0, len(wholeTask))
		for _, node := range wholeTask {
			resp = append(resp, toTaskNode(node))
		}
		c.JSON(http.StatusOK, resp)
	}
}

func UpdateTask(pool *pgxpool.Pool) gin.HandlerFunc {
	queries := store.New(pool)
	return func(c *gin.Context) {
		workspaceUUID, ok := parseUUIDParam(c, "workspaceId")
		if !ok {
			return
		}

		taskUUID, ok := parseUUIDParam(c, "taskId")
		if !ok {
			return
		}

		//查询
		got, err := queries.GetTask(c.Request.Context(), store.GetTaskParams{
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
		var req UpdateTaskDto
		if err := c.ShouldBindJSON(&req); err != nil {
			handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "请求体不是合法的 JSON")
			return
		}
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
			if !store.TaskStatus(req.Status.Value).Valid() {
				handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "status 不符合规范")
				return
			}
			got.Status = store.TaskStatus(req.Status.Value)
			//一定有值，不可能设置为空
		}
		if req.Priority.Set {
			if req.Priority.Value < 0 || req.Priority.Value > 4 {
				handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", "priority 不符合规范")
				return
			}
			got.Priority = int16(req.Priority.Value)
			//一定有值，不可能设置为空
		}
		if req.DueDate.Set {
			got.DueDate = req.DueDate.ValuePtr()
		}
		if req.ProjectId.Set {
			if req.ProjectId.Valid {
				//cross workspace校验
				_, err := queries.GetProject(c.Request.Context(), store.GetProjectParams{
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
				if !checkAssigneeLegal(c, queries, workspaceUUID, req.AssigneeId.Value) {
					return
				}
				got.AssigneeID = &req.AssigneeId.Value
			} else {
				got.AssigneeID = nil
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
		workspaceUUID, ok := parseUUIDParam(c, "workspaceId")
		if !ok {
			return
		}

		taskUUID, ok := parseUUIDParam(c, "taskId")
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

// helper
func parseUUIDParam(c *gin.Context, name string) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param(name))
	if err != nil {
		handler.Error(c, http.StatusBadRequest, "VALIDATION_FAILED", name+" 不符合 UUID 格式")
		return uuid.Nil, false
	}
	return id, true
}

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

// buildTaskDetail 重读任务并装配 TaskDetail (Create/Get/Update统一入口)
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
	detail := toTaskDetail(got)
	return detail, true
}
