package project

import (
	"mylinear/internal/handler"
	"mylinear/internal/member"
	"mylinear/internal/store"
	"time"

	"cloud.google.com/go/civil"
	"github.com/google/uuid"
)

// 创建项目
type CreateProjectDto struct {
	Name        string      `json:"name"`
	Description string      `json:"description"`
	Status      string      `json:"status"`
	Priority    int         `json:"priority"`
	LeadId      *uuid.UUID  `json:"leadId"`
	MemberIds   []uuid.UUID `json:"memberIds"`
	StartDate   *civil.Date `json:"startDate"`
	TargetDate  *civil.Date `json:"targetDate"`
}

// 更新项目
type UpdateProjectDto struct {
	Name        handler.Nullable[string]      `json:"name"`
	Description handler.Nullable[string]      `json:"description"`
	Status      handler.Nullable[string]      `json:"status"`
	Priority    handler.Nullable[int]         `json:"priority"`
	LeadId      handler.Nullable[uuid.UUID]   `json:"leadId"`
	MemberIds   handler.Nullable[[]uuid.UUID] `json:"memberIds"`
	StartDate   handler.Nullable[civil.Date]  `json:"startDate"`
	TargetDate  handler.Nullable[civil.Date]  `json:"targetDate"`
}

// 精简 ： 嵌入信息
type ProjectRef struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
}

// 返回项目信息
type ProjectRow struct {
	ID         uuid.UUID         `json:"id"`
	Name       string            `json:"name"`
	Status     string            `json:"status"`
	Priority   int               `json:"priority"`
	Lead       *member.MemberRef `json:"lead"`
	StartDate  *civil.Date       `json:"startDate"`
	TargetDate *civil.Date       `json:"targetDate"`
	TaskCount  int               `json:"taskCount"`
	CreatedAt  time.Time         `json:"createdAt"`
	UpdatedAt  time.Time         `json:"updatedAt"`
}

// 详细信息
type ProjectDetail struct {
	ProjectRow
	Description string             `json:"description"`
	Members     []member.MemberRef `json:"members"`
}

// 可空 lead 三元组转 MemberRef；leadID 为 NULL（无负责人）时整体返回 nil，禁止直接解引用可空指针
func toLeadRef(leadID *uuid.UUID, name, avatarColor *string) *member.MemberRef {
	if leadID == nil {
		return nil
	}
	// leadID 非空时 JOIN 必命中（member.name/avatar_color NOT NULL avatar_color前端应该会传默认值，不会为空），
	// 判空仅作悬空引用兜底，防止异常数据 panic
	n, a := "", ""
	if name != nil {
		n = *name
	}
	if avatarColor != nil {
		a = *avatarColor
	}
	return &member.MemberRef{ID: *leadID, Name: n, AvatarColor: a}
}

// 按workspace查询结果转为ProjectRow
func toProjectRow(pj store.ListProjectsByWorkspaceRow) ProjectRow {
	return ProjectRow{
		ID:         pj.ID,
		Name:       pj.Name,
		Status:     string(pj.Status),
		Priority:   int(pj.Priority),
		Lead:       toLeadRef(pj.LeadID, pj.LeadName, pj.LeadAvatarColor),
		StartDate:  pj.StartDate,
		TargetDate: pj.TargetDate,
		TaskCount:  int(pj.TaskCount),
		CreatedAt:  pj.CreatedAt,
		UpdatedAt:  pj.UpdatedAt,
	}
}

// 按id查询结果转为ProjectRow
func toProjectRow2(pj store.GetProjectRow) ProjectRow {
	return ProjectRow{
		ID:         pj.ID,
		Name:       pj.Name,
		Status:     string(pj.Status),
		Priority:   int(pj.Priority),
		Lead:       toLeadRef(pj.LeadID, pj.LeadName, pj.LeadAvatarColor),
		StartDate:  pj.StartDate,
		TargetDate: pj.TargetDate,
		TaskCount:  int(pj.TaskCount),
		CreatedAt:  pj.CreatedAt,
		UpdatedAt:  pj.UpdatedAt,
	}
}
