import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  listWorkspaces,
  updateWorkspace,
} from "@/api/workspace"
import type { UpdateWorkspaceInput, Workspace } from "@/api/types"

const KEY = ["workspaces"] as const

export function useWorkspaces() {
  // staleTime: Infinity —— 列表的唯一变更入口是本模块三个 mutation（均已 invalidate 本 key，
  // 失效无视 staleTime 强制刷新），故挂载时无需 refetch：
  // 消除每次切页因面包屑/侧栏挂载新 observer 而重复 GET /workspaces
  return useQuery({ queryKey: KEY, queryFn: listWorkspaces, staleTime: Infinity })
}

export function useWorkspace(workspaceId: string | undefined) {
  return useQuery({
    queryKey: [...KEY, workspaceId],
    queryFn: () => getWorkspace(workspaceId!),
    enabled: !!workspaceId,
    // staleTime: Infinity —— 详情变更入口仅本模块 update/create（均响应直写详情缓存）、
    // delete（直接移除缓存），挂载不再重复 GET /workspaces/:id（如新建后进入新工作区）
    staleTime: Infinity,
  })
}

export function useCreateWorkspace() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createWorkspace,
    // 响应与 GET 同构（Workspace）：直写详情缓存 + 列表末尾追加
    // （ListWorkspaces 按 created_at ASC，新行必在末尾），零额外 GET；
    // 列表缓存尚不存在时保持空缺，待挂载自取
    onSuccess: (ws) => {
      qc.setQueryData([...KEY, ws.id], ws)
      qc.setQueryData(KEY, (old: Workspace[] | undefined) => (old ? [...old, ws] : old))
    },
  })
}

export function useUpdateWorkspace() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateWorkspaceInput }) =>
      updateWorkspace(id, input),
    // PATCH 与 GET 同构（Workspace）：响应直写详情 + 列表行缓存，零额外 GET；
    // workspace 名字的消费方仅这两份缓存（侧栏/面包屑），无其他内嵌引用需失效
    onSuccess: (ws) => {
      qc.setQueryData([...KEY, ws.id], ws)
      qc.setQueryData(KEY, (old: Workspace[] | undefined) =>
        old?.map((w) => (w.id === ws.id ? ws : w)),
      )
    },
  })
}

export function useDeleteWorkspace() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteWorkspace,
    // 外科移除列表行 + 删除详情缓存：invalidate 会让侧栏活跃列表立即 refetch，
    // 而删除后的列表状态可由缓存派生（页面侧随即导航离开）
    onSuccess: (_data, id) => {
      qc.setQueryData(KEY, (old: Workspace[] | undefined) => old?.filter((w) => w.id !== id))
      qc.removeQueries({ queryKey: [...KEY, id] })
    },
  })
}
