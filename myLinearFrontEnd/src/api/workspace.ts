import { api } from "./client"
import type { CreateWorkspaceInput, UpdateWorkspaceInput, Workspace } from "./types"

// Workspace 接口见 docs/api.md §5
export const listWorkspaces = () => api<Workspace[]>("/workspaces")

export const getWorkspace = (workspaceId: string) =>
  api<Workspace>(`/workspaces/${workspaceId}`)

export const createWorkspace = (input: CreateWorkspaceInput) =>
  api<Workspace>("/workspaces", { method: "POST", body: JSON.stringify(input) })

export const updateWorkspace = (workspaceId: string, input: UpdateWorkspaceInput) =>
  api<Workspace>(`/workspaces/${workspaceId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  })

/** 硬删除，级联其下全部数据；204 幂等 */
export const deleteWorkspace = (workspaceId: string) =>
  api<void>(`/workspaces/${workspaceId}`, { method: "DELETE" })
