import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  updateProject,
} from "@/api/project"
import type { CreateProjectInput, UpdateProjectInput } from "@/api/types"

// 项目域 key 唯一来源（useTasks / useMembers 的跨域失效与外科更新复用）：
// 列表 [..., {sort,order}]；详情 [..., projectId]；项目内任务 [..., projectId, "tasks"]
export const projectsKey = (workspaceId: string) => ["workspaces", workspaceId, "projects"] as const
export const projectDetailKey = (workspaceId: string, projectId: string) =>
  [...projectsKey(workspaceId), projectId] as const
export const projectTasksKey = (workspaceId: string, projectId: string) =>
  [...projectDetailKey(workspaceId, projectId), "tasks"] as const

export function useProjects(
  workspaceId: string | undefined,
  sort: string,
  order: string,
  enabled = true,
) {
  return useQuery({
    queryKey: [...projectsKey(workspaceId!), { sort, order }],
    queryFn: () => listProjects(workspaceId!, { sort, order }),
    enabled: !!workspaceId && enabled,
    // staleTime: Infinity —— 列表行（自身字段 + lead 内嵌引用 + taskCount）的全部变更入口：
    // 本模块三个 mutation 与成员改名/删除（lead）invalidate 本前缀，任务增删外科 bump taskCount、
    // 任务归属变更失效整前缀；失效无视 staleTime 强制刷新，故挂载时不再重复 GET /projects
    staleTime: Infinity,
  })
}

export function useCreateProject(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateProjectInput) => createProject(workspaceId, input),
    // 前缀匹配失效所有 sort/order 变体
    onSuccess: () => qc.invalidateQueries({ queryKey: projectsKey(workspaceId) }),
  })
}

export function useProject(workspaceId: string | undefined, projectId: string | undefined) {
  return useQuery({
    queryKey: projectDetailKey(workspaceId!, projectId!),
    queryFn: () => getProject(workspaceId!, projectId!),
    enabled: !!workspaceId && !!projectId,
  })
}

export function useUpdateProject(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, input }: { projectId: string; input: UpdateProjectInput }) =>
      updateProject(workspaceId, projectId, input),
    onSuccess: (project, { input }) => {
      // 先用响应更新详情缓存（chip 即时回显，PATCH 与 GET 同构不再 refetch）；
      // predicate 排除详情（刚写过）；项目任务行内嵌 project 名字，仅改名时失效其子树键，
      // 列表变体（[3] 为 sort 对象）照常失效
      const nameChanged = "name" in input
      qc.setQueryData(projectDetailKey(workspaceId, project.id), project)
      qc.invalidateQueries({
        queryKey: projectsKey(workspaceId),
        predicate: (q) =>
          q.queryKey[3] !== project.id || (nameChanged && q.queryKey.length > 4),
      })
    },
  })
}

export function useDeleteProject(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (projectId: string) => deleteProject(workspaceId, projectId),
    // 前缀失效列表行（taskCount）/各 sort 变体；页面侧导航回列表。
    // predicate 排除已删项目的详情/任务缓存：invalidate 时当前详情页尚未卸载，
    // 不排除则其活跃详情缓存会被 refetch 而必然 404（同 useDeleteTask 的处理）
    onSuccess: (_data, projectId) => {
      qc.invalidateQueries({
        queryKey: projectsKey(workspaceId),
        predicate: (q) => (q.queryKey[3] as string) !== projectId,
      })
    },
  })
}
