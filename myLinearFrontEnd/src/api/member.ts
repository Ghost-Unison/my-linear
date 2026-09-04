import { api } from "./client"
import type { CreateMemberInput, Member, UpdateMemberInput } from "./types"

// Member 接口见 docs/api.md §6（嵌套于 workspace）
export const listMembers = (workspaceId: string) =>
  api<Member[]>(`/workspaces/${workspaceId}/members`)

export const createMember = (workspaceId: string, input: CreateMemberInput) =>
  api<Member>(`/workspaces/${workspaceId}/members`, {
    method: "POST",
    body: JSON.stringify(input),
  })

export const updateMember = (
  workspaceId: string,
  memberId: string,
  input: UpdateMemberInput,
) =>
  api<Member>(`/workspaces/${workspaceId}/members/${memberId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  })

/** 硬删除；其名下任务 assignee、项目 lead 由数据库置 NULL */
export const deleteMember = (workspaceId: string, memberId: string) =>
  api<void>(`/workspaces/${workspaceId}/members/${memberId}`, { method: "DELETE" })
