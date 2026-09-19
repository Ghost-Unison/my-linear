import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createView, deleteView, listViews, updateView } from "@/api/view"
import type { CreateViewInput, UpdateViewInput, View, ViewSurface } from "@/api/types"

// View 域 key（P2.md §4）：列表按 surface（+ projectId for project_issues）分变体；
// 单条详情 [...viewsKey, viewId]。视图 CRUD 只影响 view 域自身（config 不参与列表行渲染），
// 故 mutation 仅失效本前缀，不跨域。
export const viewsKey = (workspaceId: string) => ["workspaces", workspaceId, "views"] as const
export const viewsListKey = (workspaceId: string, surface: ViewSurface, projectId?: string) =>
  [...viewsKey(workspaceId), { surface, projectId }] as const

/**
 * 按 surface 列表查询（project_issues 面带 projectId 做项目级隔离，P2.md §4.1）。
 * staleTime: Infinity —— 变更入口只有本模块 CRUD mutation（均失效本前缀，强制刷新），
 * 挂载时不重复 GET（同 useLabels/useMembers 约定）
 */
export function useViews(
  workspaceId: string | undefined,
  surface: ViewSurface,
  projectId?: string,
) {
  return useQuery({
    queryKey: viewsListKey(workspaceId!, surface, projectId),
    queryFn: () => listViews(workspaceId!, surface, projectId),
    enabled: !!workspaceId && (surface !== "project_issues" || !!projectId),
    staleTime: Infinity,
  })
}

export function useCreateView(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateViewInput) => createView(workspaceId, input),
    // POST 响应即完整 View，直写对应 surface 变体缓存（created_at 升序，新 view 必在末尾 → append），
    // 免去 GET 回源；old 缺席时 updater 返回 undefined，setQueryData 跳过不造半截缓存
    onSuccess: (view) => {
      qc.setQueryData(
        viewsListKey(workspaceId, view.surface, view.projectId ?? undefined),
        (old: View[] | undefined) => (old ? [...old, view] : undefined),
      )
    },
  })
}

export function useUpdateView(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ viewId, input }: { viewId: string; input: UpdateViewInput }) =>
      updateView(workspaceId, viewId, input),
    // PATCH 与 GET 同构（View）：响应直写列表缓存对应变体，不再额外 GET
    onSuccess: (view) => {
      qc.setQueryData(
        viewsListKey(workspaceId, view.surface, view.projectId ?? undefined),
        (old: View[] | undefined) => old?.map((v) => (v.id === view.id ? view : v)),
      )
    },
  })
}

export function useDeleteView(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (viewId: string) => deleteView(workspaceId, viewId),
    // 硬删除后失效本前缀各 surface 变体（被删 view 所属变体 refetch 剔除该行）
    onSuccess: () => qc.invalidateQueries({ queryKey: viewsKey(workspaceId) }),
  })
}
