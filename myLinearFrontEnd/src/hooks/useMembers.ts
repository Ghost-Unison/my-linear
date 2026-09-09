import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query"
import { createMember, deleteMember, listMembers, updateMember } from "@/api/member"
import type { CreateMemberInput, Member, UpdateMemberInput } from "@/api/types"
// 成员改名/删除会连带改变项目行 lead 等 JOIN 内嵌引用，需跨域失效 projects 前缀（key 复用唯一来源）
import { projectsKey } from "./useProjects"

export const membersKey = (workspaceId: string) => ["workspaces", workspaceId, "members"] as const

/** enabled 供常驻挂载的弹窗按 open 惰性启用（同 useProjects）：弹窗未开时不必预取成员选项 */
export function useMembers(workspaceId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: membersKey(workspaceId!),
    queryFn: () => listMembers(workspaceId!),
    enabled: !!workspaceId && enabled,
    // staleTime: Infinity —— 成员列表的唯一变更入口是本模块三个 mutation（均已 invalidate 本 key，
    // 失效无视 staleTime 强制刷新），挂载时不再重复 GET /members
    staleTime: Infinity,
  })
}

/** 预取成员集：打开 filter 菜单时调用，标记 key 不过期（页面内 mutation 仍会 invalidate 强刷），
 *  之后 useMembers 挂载命中缓存秒开。queryKey/queryFn/staleTime 与 useMembers 单源 */
export const prefetchMembers = (qc: QueryClient, workspaceId: string) =>
  qc.prefetchQuery({
    queryKey: membersKey(workspaceId),
    queryFn: () => listMembers(workspaceId),
    staleTime: Infinity,
  })

export function useCreateMember(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateMemberInput) => createMember(workspaceId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: membersKey(workspaceId) }),
  })
}

export function useUpdateMember(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ memberId, input }: { memberId: string; input: UpdateMemberInput }) =>
      updateMember(workspaceId, memberId, input),
    // PATCH 与 GET 同构（Member）：响应直写列表行缓存，不再额外 GET /members；
    // 项目行 lead 内嵌引用无法由响应派生，仍失效 projects 前缀（成员页上其非活跃，仅标记待挂载取）
    onSuccess: (member) => {
      qc.setQueryData(membersKey(workspaceId), (old: Member[] | undefined) =>
        old?.map((m) => (m.id === member.id ? member : m)),
      )
      qc.invalidateQueries({ queryKey: projectsKey(workspaceId) })
    },
  })
}

export function useDeleteMember(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (memberId: string) => deleteMember(workspaceId, memberId),
    // 删除后其 lead 归属由数据库 SET NULL，项目行 lead 展示随之变化（projects 前缀）
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: membersKey(workspaceId) })
      qc.invalidateQueries({ queryKey: projectsKey(workspaceId) })
    },
  })
}
