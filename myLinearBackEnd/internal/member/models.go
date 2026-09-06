package member

import (
	"github.com/Ghost-Unison/my-linear/myLinearBackEnd/internal/handler"
	"github.com/Ghost-Unison/my-linear/myLinearBackEnd/internal/store"

	"github.com/google/uuid"
)

// 创建成员请求 { "name": "必填", "email": "可选", "avatarColor": "可选" }
// POST 创建时无旧值要保护，“没传”与“传 null”同义（都是“没有这个值”），
// 因此可空字段用普通 *string 即可（nil → NULL），Nullable 三态只为 PATCH 服务
type CreateMemberDTO struct {
	Name        string  `json:"name"`
	Email       *string `json:"email"`
	AvatarColor string  `json:"avatarColor"`
}

// MemberResp（api.md §4：email 可 null）
type MemberResp struct {
	ID          uuid.UUID `json:"id"`
	Name        string    `json:"name"`
	Email       *string   `json:"email"`
	AvatarColor string    `json:"avatarColor"`
}

// 精简 ： 嵌入用
type MemberRef struct {
	ID          uuid.UUID `json:"id"`
	Name        string    `json:"name"`
	AvatarColor string    `json:"avatarColor"`
}

// toResp转换 - get update返回
func toResp(mb store.Member) MemberResp {
	return MemberResp{
		ID:          mb.ID,
		Name:        mb.Name,
		Email:       mb.Email, // *string 直接透传；nil 序列化为 null，禁止 *mb.Email（NULL 时 panic）
		AvatarColor: mb.AvatarColor,
	}
}

// 作为引用时转换 - project中
func ToMemberRefs(mbs []store.Member) []MemberRef {
	refs := make([]MemberRef, 0, len(mbs))
	for _, mb := range mbs {
		refs = append(refs, MemberRef{
			ID:          mb.ID,
			Name:        mb.Name,
			AvatarColor: mb.AvatarColor,
		})
	}
	return refs
}

// UpdateMemberDTO 更新成员请求体 （api.md:name, email, avatarColor 可选）
type UpdateMemberDTO struct {
	Name        handler.Nullable[string] `json:"name"`
	Email       handler.Nullable[string] `json:"email"`
	AvatarColor handler.Nullable[string] `json:"avatarColor"`
}
