package task

import (
	"fmt"
	"time"

	"github.com/Ghost-Unison/my-linear/myLinearBackEnd/internal/handler"
	"github.com/Ghost-Unison/my-linear/myLinearBackEnd/internal/label"
	"github.com/Ghost-Unison/my-linear/myLinearBackEnd/internal/member"
	"github.com/Ghost-Unison/my-linear/myLinearBackEnd/internal/project"
	"github.com/Ghost-Unison/my-linear/myLinearBackEnd/internal/store"

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
	LabelIds    []uuid.UUID `json:"labelIds"`
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
	//任务Label更新不放在这里，用label.BatchUpdateLabelIDs单独处理
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
	Labels      []label.LabelRef    `json:"labels"`
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
	Labels   []label.LabelRef    `json:"labels"`
}

// toProjectRef 可空 project 二元组转 ProjectRef 指针：projectID 为 NULL（任务不归属项目）时返回 nil。
// 上方早退已保证 projectName 非 nil，直接解引用；assignee 侧的同形逻辑见 member.ToMemberRef
func toProjectRef(projectID *uuid.UUID, projectName *string) *project.ProjectRef {
	if projectID == nil || projectName == nil {
		return nil
	}
	return &project.ProjectRef{ID: *projectID, Name: *projectName}
}

// Go中没有联合类型，也不能直接从泛型参数访问具体字段，需要使用类型断言
// ListTasksByProjectRow / ListTasksByWorkspaceRow / GetTaskRow to TaskRow
//
// 分支内直接返回带字段名的字面量，不抽位置参数 builder：assigneeName/assigneeAvatarColor、
// createdAt/updatedAt 等同类型相邻参数一旦调序，编译期无法发现（与 project.toProjectRow 同一约定）。
//
// labelsRef 兜底：来自 handler 的 map 分组时，无标签的任务取不到 key 得到 nil slice；
// 来自 sqlc :many 零行时同样是 nil。nil 序列化为 JSON null，违反"空 labels 为 []"契约（api.md §4）
func toTaskRow(tk any, labelsRef []label.LabelRef) TaskRow {
	if labelsRef == nil {
		labelsRef = make([]label.LabelRef, 0)
	}
	switch v := tk.(type) {
	case store.ListTasksByProjectRow:
		return TaskRow{
			ID:          v.ID,
			ParentId:    v.ParentID,
			ParentTitle: v.ParentTitle,
			Title:       v.Title,
			Status:      string(v.Status),
			Priority:    int(v.Priority),
			Project:     toProjectRef(v.ProjectID, v.ProjectName),
			Assignee:    member.ToMemberRef(v.AssigneeID, v.AssigneeName, v.AssigneeAvatarColor),
			DueDate:     v.DueDate,
			CreatedAt:   v.CreatedAt,
			UpdatedAt:   v.UpdatedAt,
			Labels:      labelsRef,
		}
	case store.ListTasksByWorkspaceRow:
		return TaskRow{
			ID:          v.ID,
			ParentId:    v.ParentID,
			ParentTitle: v.ParentTitle,
			Title:       v.Title,
			Status:      string(v.Status),
			Priority:    int(v.Priority),
			Project:     toProjectRef(v.ProjectID, v.ProjectName),
			Assignee:    member.ToMemberRef(v.AssigneeID, v.AssigneeName, v.AssigneeAvatarColor),
			DueDate:     v.DueDate,
			CreatedAt:   v.CreatedAt,
			UpdatedAt:   v.UpdatedAt,
			Labels:      labelsRef,
		}
	case store.GetTaskRow:
		return TaskRow{
			ID:          v.ID,
			ParentId:    v.ParentID,
			ParentTitle: v.ParentTitle,
			Title:       v.Title,
			Status:      string(v.Status),
			Priority:    int(v.Priority),
			Project:     toProjectRef(v.ProjectID, v.ProjectName),
			Assignee:    member.ToMemberRef(v.AssigneeID, v.AssigneeName, v.AssigneeAvatarColor),
			DueDate:     v.DueDate,
			CreatedAt:   v.CreatedAt,
			UpdatedAt:   v.UpdatedAt,
			Labels:      labelsRef,
		}
	default:
		panic(fmt.Sprintf("task.toTaskRow: unsupported type %T", tk))
	}
}

// toTaskDetail 详情装配：TaskRow + description + 父任务引用。
// labels 收原始 sqlc 行、在此转 Ref（与 project.toProjectDetail 一致），nil 由 ToLabelRefs 内部的 make 兜底
func toTaskDetail(tk store.GetTaskRow, labels []store.Label) TaskDetail {
	return TaskDetail{
		TaskRow:     toTaskRow(tk, label.ToLabelRefs(labels)),
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

func toTaskNode(tk store.GetTaskSubtreeRow, labelsRef []label.LabelRef) TaskNode {
	if labelsRef == nil {
		labelsRef = make([]label.LabelRef, 0)
	}
	return TaskNode{
		ID:       tk.ID,
		ParentId: tk.ParentID,
		Depth:    int(tk.Depth),
		Title:    tk.Title,
		Status:   string(tk.Status),
		Priority: int(tk.Priority),
		Project:  toProjectRef(tk.ProjectID, tk.ProjectName),
		Assignee: member.ToMemberRef(tk.AssigneeID, tk.AssigneeName, tk.AssigneeAvatarColor),
		DueDate:  tk.DueDate,
		Labels:   labelsRef,
	}
}
