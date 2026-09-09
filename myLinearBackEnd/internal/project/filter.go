package project

import (
	"net/http"
	"strconv"

	"github.com/Ghost-Unison/my-linear/myLinearBackEnd/internal/filter"
	"github.com/Ghost-Unison/my-linear/myLinearBackEnd/internal/handler"
	"github.com/Ghost-Unison/my-linear/myLinearBackEnd/internal/store"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// projectFilterSpecs 项目列表可过滤字段白名单（P2.md §2.2，Linear 实测真值表）：字段 → 值形态 + 值域校验。
// member 仅 contains 族两操作符且无 none 选项；labels 为四操作符族 + No labels 哨兵；
// 日期阶梯分方向：created/updated = ago 七档，start/target = from now（target 仅三档），
// start date 额外提供 No start date 空值条件
var projectFilterSpecs = map[string]filter.Spec{
	"status":     {Kind: filter.Single, Validate: func(v string) bool { return store.ProjectStatus(v).Valid() }},
	"priority":   {Kind: filter.Single, Validate: isPriority},
	"lead":       {Kind: filter.Single, AllowNone: true, Validate: isUUID},
	"member":     {Kind: filter.Multi, Ops: []string{"inclAny", "exclAny"}, Validate: isUUID},
	"labels":     {Kind: filter.Multi, AllowNone: true, Validate: isUUID},
	"startDate":  {Kind: filter.Day, AllowNone: true, FromNow: true},
	"targetDate": {Kind: filter.Day, FromNow: true, Ladders: []string{"3mo", "6mo", "1y"}},
	"createdAt":  {Kind: filter.Moment},
	"updatedAt":  {Kind: filter.Moment},
}

func isUUID(v string) bool { _, err := uuid.Parse(v); return err == nil }

func isPriority(v string) bool {
	n, err := strconv.Atoi(v)
	return err == nil && n >= 0 && n <= 4
}

// projectValGetter 装配过滤提取器：member 字段依赖批量取回的 project→member id 映射
// （仅 member 条件存在时取，见 needsMemberSets）；其余字段直读 ProjectRow
func projectValGetter(memberSets map[uuid.UUID]map[string]struct{}) func(ProjectRow, string) filter.Val {
	return func(row ProjectRow, field string) filter.Val {
		switch field {
		case "status":
			return filter.Val{Single: row.Status}
		case "priority":
			return filter.Val{Single: strconv.Itoa(row.Priority)}
		case "lead":
			if row.Lead == nil {
				return filter.Val{Null: true}
			}
			return filter.Val{Single: row.Lead.ID.String()}
		case "member":
			// 无成员的项目取到 nil map = 空集合（伪值 none 语义由引擎处理）
			return filter.Val{Set: memberSets[row.ID]}
		case "labels":
			set := make(map[string]struct{}, len(row.Labels))
			for _, l := range row.Labels {
				set[l.ID.String()] = struct{}{}
			}
			return filter.Val{Set: set}
		case "startDate":
			if row.StartDate == nil {
				return filter.Val{Null: true}
			}
			return filter.Val{D: *row.StartDate}
		case "targetDate":
			if row.TargetDate == nil {
				return filter.Val{Null: true}
			}
			return filter.Val{D: *row.TargetDate}
		case "createdAt":
			return filter.Val{T: row.CreatedAt}
		case "updatedAt":
			return filter.Val{T: row.UpdatedAt}
		}
		return filter.Val{}
	}
}

// needsMemberSets 是否有条件依赖项目成员集合（决定要不要批量取映射）
func needsMemberSets(conds []filter.Cond) bool {
	for _, cd := range conds {
		if cd.Field == "member" {
			return true
		}
	}
	return false
}

// buildProjectMemberSets 批量取 project→member id 映射（ListProjectMemberIdsByProjectIds，
// 与 buildProjectLabelMap 同构避免 N+1）。失败时已写入 500 响应，返回 ok=false
func buildProjectMemberSets(c *gin.Context, queries *store.Queries, projectIds []uuid.UUID) (map[uuid.UUID]map[string]struct{}, bool) {
	rows, err := queries.ListProjectMemberIdsByProjectIds(c.Request.Context(), projectIds)
	if err != nil {
		handler.Error(c, http.StatusInternalServerError, "INTERNAL", "获取项目成员失败")
		return nil, false
	}
	sets := make(map[uuid.UUID]map[string]struct{}, len(projectIds))
	for _, r := range rows {
		if sets[r.ProjectID] == nil {
			sets[r.ProjectID] = make(map[string]struct{})
		}
		sets[r.ProjectID][r.MemberID.String()] = struct{}{}
	}
	return sets, true
}
