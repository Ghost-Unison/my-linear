package task

import (
	"fmt"
	"mylinear/internal/handler"
	"mylinear/internal/member"
	"mylinear/internal/project"
	"mylinear/internal/store"
	"time"

	"cloud.google.com/go/civil"
	"github.com/google/uuid"
)

// 创建任务
type CreateTaskDto struct {
	Title       string      `json:"title"`
	Description string      `json:"description"`
	Status      string      `json:"status"`
	Priority    int         `json:"priority"`
	ProjectId   *uuid.UUID  `json:"projectId"`
	ParentId    *uuid.UUID  `json:"parentId"`
	AssigneeId  *uuid.UUID  `json:"assigneeId"`
	DueDate     *civil.Date `json:"dueDate"`
}

// 更新任务 - 不能直接改ParentId
type UpdateTaskDto struct {
	Title       handler.Nullable[string]     `json:"title"`
	Description handler.Nullable[string]     `json:"description"`
	Status      handler.Nullable[string]     `json:"status"`
	Priority    handler.Nullable[int]        `json:"priority"`
	AssigneeId  handler.Nullable[uuid.UUID]  `json:"assigneeId"`
	DueDate     handler.Nullable[civil.Date] `json:"dueDate"`
	ProjectId   handler.Nullable[uuid.UUID]  `json:"projectId"`
}

// 任务信息
type TaskRow struct {
	ID       uuid.UUID  `json:"id"`
	ParentId *uuid.UUID `json:"parentId"`
	// 父任务标题：状态筛选（active/backlog）平铺视图下父任务可能不在结果集，
	// 行内以 "> parentTitle" 面包屑体现归属（对齐 Linear）；无父为 null
	ParentTitle *string             `json:"parentTitle"`
	Title       string              `json:"title"`
	Status      string              `json:"status"`
	Priority    int                 `json:"priority"`
	Project     *project.ProjectRef `json:"project"`
	Assignee    *member.MemberRef   `json:"assignee"`
	DueDate     *civil.Date         `json:"dueDate"`
	CreatedAt   time.Time           `json:"createdAt"`
	UpdatedAt   time.Time           `json:"updatedAt"`
}

// 任务详情
type TaskDetail struct {
	TaskRow
	Description string `json:"description"`
	// 父任务引用：子任务详情页 "Sub-issue of" 行渲染（对齐 Linear）；无父为 null
	Parent *ParentRef `json:"parent"`
}

// 父任务引用：status/title + 父任务后代完成统计（口径同 Sub-issues 区徽标，api.md §4）
type ParentRef struct {
	ID         uuid.UUID `json:"id"`
	Title      string    `json:"title"`
	Status     string    `json:"status"`
	DoneCount  int64     `json:"doneCount"`
	TotalCount int64     `json:"totalCount"`
}

// 任务子树
type TaskNode struct {
	ID       uuid.UUID           `json:"id"`
	ParentId *uuid.UUID          `json:"parentId"`
	Depth    int                 `json:"depth"`
	Title    string              `json:"title"`
	Status   string              `json:"status"`
	Priority int                 `json:"priority"`
	Project  *project.ProjectRef `json:"project"`
	Assignee *member.MemberRef   `json:"assignee"`
	DueDate  *civil.Date         `json:"dueDate"`
}

// ProjectRef AssigneeRef解引用空指针的判断
func toProjectRef(projectID *uuid.UUID, projectName *string) *project.ProjectRef {
	if projectID == nil || projectName == nil {
		return nil
	}
	//projectname 插入时做了判断，应该不会为空，仅作兜底；上方早退已保证此处非 nil，仍判空防异常数据 panic
	name := ""
	if *projectName != "" {
		name = *projectName
	}
	return &project.ProjectRef{ID: *projectID, Name: name}
}

func toAssigneeRef(assigneeID *uuid.UUID, assigneeName *string, assigneeAvatarColor *string) *member.MemberRef {
	if assigneeID == nil {
		return nil
	}
	//成员的name和avatarColor插入时应该不会为空，仅作兜底
	name, aColor := "", ""
	if assigneeName != nil {
		name = *assigneeName
	}
	if assigneeAvatarColor != nil {
		aColor = *assigneeAvatarColor
	}

	return &member.MemberRef{ID: *assigneeID, Name: name, AvatarColor: aColor}
}

// Go中没有联合类型，也不能直接从泛型参数访问具体字段，需要使用类型断言
// ListTasksByProjectRow / ListTasksByWorkspaceRow to TaskRow
func toTaskRow(tk any) TaskRow {
	switch v := tk.(type) {
	case store.ListTasksByProjectRow:
		return buildTaskRow(v.ID, v.ProjectID, v.ProjectName, v.ParentID, v.ParentTitle, v.Title, v.Status, v.Priority,
			v.AssigneeID, v.AssigneeName, v.AssigneeAvatarColor, v.DueDate, v.CreatedAt, v.UpdatedAt)
	case store.ListTasksByWorkspaceRow:
		return buildTaskRow(v.ID, v.ProjectID, v.ProjectName, v.ParentID, v.ParentTitle, v.Title, v.Status, v.Priority,
			v.AssigneeID, v.AssigneeName, v.AssigneeAvatarColor, v.DueDate, v.CreatedAt, v.UpdatedAt)
	default:
		panic(fmt.Sprintf("task.ToResp: unsupported type %T", tk))
	}
}

// 公共字段构造，避免两个分支重复代码；可空字段做 nil 保护，防止 panic
func buildTaskRow(id uuid.UUID, projectID *uuid.UUID, projectName *string, parentID *uuid.UUID, parentTitle *string,
	title string, status store.TaskStatus, priority int16,
	assigneeID *uuid.UUID, assigneeName *string, assigneeAvatarColor *string,
	dueDate *civil.Date, createdAt, updatedAt time.Time) TaskRow {

	row := TaskRow{
		ID:          id,
		Title:       title,
		Status:      string(status),
		Priority:    int(priority),
		Project:     toProjectRef(projectID, projectName),
		Assignee:    toAssigneeRef(assigneeID, assigneeName, assigneeAvatarColor),
		DueDate:     dueDate,
		ParentTitle: parentTitle,
		CreatedAt:   createdAt,
		UpdatedAt:   updatedAt,
	}
	if parentID != nil {
		row.ParentId = parentID
	}
	return row
}

// GetTaskRow -> TaskDetail
func toTaskDetail(tk store.GetTaskRow) TaskDetail {
	return TaskDetail{
		TaskRow: TaskRow{
			ID:          tk.ID,
			ParentId:    tk.ParentID,
			ParentTitle: tk.ParentTitle,
			Title:       tk.Title,
			Status:      string(tk.Status),
			Priority:    int(tk.Priority),
			Project:     toProjectRef(tk.ProjectID, tk.ProjectName),
			Assignee:    toAssigneeRef(tk.AssigneeID, tk.AssigneeName, tk.AssigneeAvatarColor),
			DueDate:     tk.DueDate,
			CreatedAt:   tk.CreatedAt,
			UpdatedAt:   tk.UpdatedAt,
		},
		Description: tk.Description,
		Parent:      toParentRef(tk.ParentID, tk.ParentTitle, tk.ParentStatus, tk.ParentSubDone, tk.ParentSubTotal),
	}
}

// 父任务引用组装：软删级联保证父任务存活，三列同 NULL 仅发生在无父时；统计 NULL 兜底 0
func toParentRef(parentID *uuid.UUID, parentTitle *string, parentStatus *store.TaskStatus,
	done, total *int64) *ParentRef {
	if parentID == nil || parentTitle == nil || parentStatus == nil {
		return nil
	}
	ref := &ParentRef{ID: *parentID, Title: *parentTitle, Status: string(*parentStatus)}
	if done != nil {
		ref.DoneCount = *done
	}
	if total != nil {
		ref.TotalCount = *total
	}
	return ref
}

func toTaskNode(tk store.GetTaskSubtreeRow) TaskNode {
	return TaskNode{
		ID:       tk.ID,
		ParentId: tk.ParentID,
		Depth:    int(tk.Depth),
		Title:    tk.Title,
		Status:   string(tk.Status),
		Priority: int(tk.Priority),
		Project:  toProjectRef(tk.ProjectID, tk.ProjectName),
		Assignee: toAssigneeRef(tk.AssigneeID, tk.AssigneeName, tk.AssigneeAvatarColor),
		DueDate:  tk.DueDate,
	}
}
