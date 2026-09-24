import { useMutation, useQuery, useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query"
import { createView, deleteView, getView, listViews, updateView } from "@/api/view"
import { ApiError } from "@/api/client"
import type { CreateViewInput, UpdateViewInput, View, ViewEntityType, ViewSurface } from "@/api/types"

// View 域 key（P2.md §4）：列表按 surface（+ projectId for project_issues）分变体；
// 单条详情 [...viewsKey, viewId]。视图 CRUD 只影响 view 域自身（config 不参与列表行渲染），
// 故 mutation 仅失效本前缀，不跨域。
export const viewsKey = (workspaceId: string) => ["workspaces", workspaceId, "views"] as const
export const viewsListKey = (
  workspaceId: string,
  surface: ViewSurface,
  projectId?: string,
  entityType?: ViewEntityType,
) => [...viewsKey(workspaceId), { surface, projectId, entityType }] as const
export const viewKey = (workspaceId: string, viewId: string) => [...viewsKey(workspaceId), viewId] as const

type ListScope = { surface: ViewSurface; projectId?: string; entityType?: ViewEntityType }

function listScope(key: QueryKey): ListScope | undefined {
  const scope = key[3]
  return key.length === 4 && scope !== null && typeof scope === "object" && "surface" in scope
    ? scope as ListScope
    : undefined
}

function matchesScope(scope: ListScope, view: View) {
  return scope.surface === view.surface &&
    (scope.projectId ?? null) === (view.projectId ?? null) &&
    (!scope.entityType || scope.entityType === view.entityType)
}

/** 同步已加载的全部列表变体与单条；先取消旧请求，避免在途 GET 覆盖 mutation 响应。 */
async function syncView(qc: QueryClient, workspaceId: string, view: View) {
  const matching = (key: QueryKey) => {
    const scope = listScope(key)
    return !!scope && matchesScope(scope, view)
  }
  await qc.cancelQueries({
    queryKey: viewsKey(workspaceId),
    predicate: (query) => query.queryKey[3] === view.id || matching(query.queryKey),
  })
  qc.setQueryData(viewKey(workspaceId, view.id), view)
  qc.setQueriesData<View[]>({
    queryKey: viewsKey(workspaceId),
    predicate: (query) => matching(query.queryKey),
  }, (old) => {
    if (!old) return undefined
    return old.some((item) => item.id === view.id)
      ? old.map((item) => item.id === view.id ? view : item)
      : [...old, view]
  })
  // 尚未完成首轮 GET 的列表不能凭单条响应构造完整数据；让活跃列表重新取数。
  await qc.invalidateQueries({
    queryKey: viewsKey(workspaceId),
    predicate: (query) => matching(query.queryKey) && query.state.data === undefined,
  })
}

export function useView(workspaceId: string | undefined, viewId: string | undefined) {
  return useQuery({
    queryKey: viewKey(workspaceId!, viewId!),
    queryFn: () => getView(workspaceId!, viewId!),
    enabled: !!workspaceId && !!viewId,
    retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 1,
    staleTime: Infinity,
  })
}

/**
 * 按 surface 列表查询（project_issues 面带 projectId 做项目级隔离，P2.md §4.1）。
 * staleTime: Infinity —— 变更入口只有本模块 CRUD mutation（均失效本前缀，强制刷新），
 * 挂载时不重复 GET（同 useLabels/useMembers 约定）
 */
export function useViews(
  workspaceId: string | undefined,
  surface: ViewSurface,
  projectId?: string,
  entityType?: ViewEntityType,
) {
  return useQuery({
    queryKey: viewsListKey(workspaceId!, surface, projectId, entityType),
    queryFn: () => listViews(workspaceId!, surface, projectId, entityType),
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
    onSuccess: (view) => syncView(qc, workspaceId, view),
  })
}

export function useUpdateView(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ viewId, input }: { viewId: string; input: UpdateViewInput }) =>
      updateView(workspaceId, viewId, input),
    // PATCH 与 GET 同构（View）：响应直写列表缓存对应变体，不再额外 GET
    onSuccess: (view) => syncView(qc, workspaceId, view),
  })
}

export function useDeleteView(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (viewId: string) => deleteView(workspaceId, viewId),
    // 硬删除后失效本前缀各 surface 变体（被删 view 所属变体 refetch 剔除该行）
    onSuccess: async (_data, viewId) => {
      await qc.cancelQueries({
        queryKey: viewsKey(workspaceId),
        predicate: (query) => query.queryKey[3] === viewId || !!listScope(query.queryKey),
      })
      qc.setQueriesData<View[]>({
        queryKey: viewsKey(workspaceId),
        predicate: (query) => !!listScope(query.queryKey),
      }, (old) => old?.filter((view) => view.id !== viewId))
      // Infinity 详情必须移除，不能只依赖列表失效，否则再次进入仍会读到已删除对象。
      qc.removeQueries({ queryKey: viewKey(workspaceId, viewId), exact: true })
      await qc.invalidateQueries({
        queryKey: viewsKey(workspaceId),
        predicate: (query) => !!listScope(query.queryKey),
      })
    },
  })
}
