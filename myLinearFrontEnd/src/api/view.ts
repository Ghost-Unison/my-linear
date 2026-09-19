import { api } from "./client"
import type { CreateViewInput, UpdateViewInput, View, ViewSurface } from "./types"

// View 接口见 docs/api.md §10（saved_view CRUD，P2）：surface 必传；
// projectId 仅 project_issues 面必传（项目级 scope，P2.md §4.1）

export const listViews = (
  workspaceId: string,
  surface: ViewSurface,
  projectId?: string,
) => {
  const qs = new URLSearchParams({ surface })
  if (projectId) qs.set("projectId", projectId)
  return api<View[]>(`/workspaces/${workspaceId}/views?${qs.toString()}`)
}

export const createView = (workspaceId: string, input: CreateViewInput) =>
  api<View>(`/workspaces/${workspaceId}/views`, {
    method: "POST",
    body: JSON.stringify(input),
  })

export const getView = (workspaceId: string, viewId: string) =>
  api<View>(`/workspaces/${workspaceId}/views/${viewId}`)

export const updateView = (
  workspaceId: string,
  viewId: string,
  input: UpdateViewInput,
) =>
  api<View>(`/workspaces/${workspaceId}/views/${viewId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  })

// 硬删除；204 幂等（同 label 约定）
export const deleteView = (workspaceId: string, viewId: string) =>
  api<void>(`/workspaces/${workspaceId}/views/${viewId}`, { method: "DELETE" })
