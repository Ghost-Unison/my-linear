import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createMember, deleteMember, listMembers, updateMember } from "@/api/member"
import type { CreateMemberInput, Member, UpdateMemberInput } from "@/api/types"
// 成员改名/删除会连带改变项目行 lead 等 JOIN 内嵌引用，需跨域失效 projects 前缀（key 复用唯一来源）
import { projectsKey } from "./useProjects"

const key = (workspaceId: string) => ["workspaces", workspaceId, "members"] as const

export function useMembers(workspaceId: string | undefined) {
  return useQuery({
    queryKey: key(workspaceId!),
    queryFn: () => listMembers(workspaceId!),
    enabled: !!workspaceId,
    // staleTime: Infinity —— 成员列表的唯一变更入口是本模块三个 mutation（均已 invalidate 本 key，
    // 失效无视 staleTime 强制刷新），挂载时不再重复 GET /members
    staleTime: Infinity,
  })
}

export function useCreateMember(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateMemberInput) => createMember(workspaceId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(workspaceId) }),
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
      qc.setQueryData(key(workspaceId), (old: Member[] | undefined) =>
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
      qc.invalidateQueries({ queryKey: key(workspaceId) })
      qc.invalidateQueries({ queryKey: projectsKey(workspaceId) })
    },
  })
}
