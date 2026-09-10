package project

import (
	"fmt"
	"time"

	"github.com/Ghost-Unison/my-linear/myLinearBackEnd/internal/handler"
	"github.com/Ghost-Unison/my-linear/myLinearBackEnd/internal/label"
	"github.com/Ghost-Unison/my-linear/myLinearBackEnd/internal/member"
	"github.com/Ghost-Unison/my-linear/myLinearBackEnd/internal/store"

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
	LabelIds    []uuid.UUID `json:"labelIds"`
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
	//项目Label更新不放在这里，用label.BatchUpdateLabelIDs单独处理
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
	Labels     []label.LabelRef  `json:"labels"`
	// P2-B 行完备补入：display options 的 Member 分组 / Members 列消费（name 升序，空为 []）
	Members []member.MemberRef `json:"members"`
}

// 详细信息
type ProjectDetail struct {
	ProjectRow
	Description string `json:"description"`
}

// toProjectRow 两种 sqlc row（列表 ListProjectsByWorkspaceRow / 详情 GetProjectRow）统一转为 ProjectRow，
// 与 task.toTaskRow 的类型开关写法保持一致，调用方无需关心底层查询类型。
//
// 分支内直接返回带字段名的字面量，不抽位置参数 builder：startDate/targetDate、createdAt/updatedAt、
// leadName/leadAvatarColor 等同类型相邻参数一旦调序，编译期无法发现。
//
// labelsRef / membersRef 兜底：来自 handler 的 map 分组时，无标签/无成员的项目取不到 key 得到 nil slice；
// 来自 sqlc :many 零行时同样是 nil。nil 序列化为 JSON null，违反"空数组为 []"契约（api.md §4）
func toProjectRow(pr any, labelsRef []label.LabelRef, membersRef []member.MemberRef) ProjectRow {
	if labelsRef == nil {
		labelsRef = make([]label.LabelRef, 0)
	}
	if membersRef == nil {
		membersRef = make([]member.MemberRef, 0)
	}
	switch v := pr.(type) {
	case store.ListProjectsByWorkspaceRow:
		return ProjectRow{
			ID:         v.ID,
			Name:       v.Name,
			Status:     string(v.Status),
			Priority:   int(v.Priority),
			Lead:       member.ToMemberRef(v.LeadID, v.LeadName, v.LeadAvatarColor),
			StartDate:  v.StartDate,
			TargetDate: v.TargetDate,
			TaskCount:  int(v.TaskCount),
			CreatedAt:  v.CreatedAt,
			UpdatedAt:  v.UpdatedAt,
			Labels:     labelsRef,
			Members:    membersRef,
		}
	case store.GetProjectRow:
		return ProjectRow{
			ID:         v.ID,
			Name:       v.Name,
			Status:     string(v.Status),
			Priority:   int(v.Priority),
			Lead:       member.ToMemberRef(v.LeadID, v.LeadName, v.LeadAvatarColor),
			StartDate:  v.StartDate,
			TargetDate: v.TargetDate,
			TaskCount:  int(v.TaskCount),
			CreatedAt:  v.CreatedAt,
			UpdatedAt:  v.UpdatedAt,
			Labels:     labelsRef,
			Members:    membersRef,
		}
	default:
		panic(fmt.Sprintf("project.toProjectRow: unsupported type %T", v))
	}
}

// toProjectDetail 详情装配：ProjectRow + description。
// 两个内嵌数组都收原始 sqlc 行、在此统一转 Ref，调用方不必记住哪个要预先转换；
// nil 安全由 label.ToLabelRefs / member.ToMemberRefs 内部的 make 保证（api.md §4 空为 []）。
// 与 toProjectRow 收 []LabelRef / []MemberRef 不同是必然的：列表路径两个内嵌数组来自 map 分组，已是 Ref
func toProjectDetail(pr store.GetProjectRow, labels []store.Label, members []store.Member) ProjectDetail {
	return ProjectDetail{
		ProjectRow:  toProjectRow(pr, label.ToLabelRefs(labels), member.ToMemberRefs(members)),
		Description: pr.Description,
	}
}
