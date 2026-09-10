import { api } from "./client"
import type {
  CreateProjectInput,
  ProjectDetail,
  ProjectRow,
  UpdateProjectInput,
} from "./types"

// Project 接口见 docs/api.md §7（嵌套于 workspace）
// P2 增 f= 条件列表重复参数（api.md §7，Go 层过滤引擎求值）；
// sort/order 已退役（P2-B）：ordering 前端化，基底序由后端 SQL 固定（api.md §2.2）
export const listProjects = (workspaceId: string, params?: { f?: string[] }) => {
  const qs = new URLSearchParams()
  for (const cond of params?.f ?? []) qs.append("f", cond)
  const q = qs.toString()
  return api<ProjectRow[]>(`/workspaces/${workspaceId}/projects${q ? `?${q}` : ""}`)
}

export const createProject = (workspaceId: string, input: CreateProjectInput) =>
  api<ProjectDetail>(`/workspaces/${workspaceId}/projects`, {
    method: "POST",
    body: JSON.stringify(input),
  })

export const getProject = (workspaceId: string, projectId: string) =>
  api<ProjectDetail>(`/workspaces/${workspaceId}/projects/${projectId}`)

export const updateProject = (
  workspaceId: string,
  projectId: string,
  input: UpdateProjectInput,
) =>
  api<ProjectDetail>(`/workspaces/${workspaceId}/projects/${projectId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  })

// 软删除（R5）：其下任务脱离项目保留；204 幂等，404 = 不存在或已删
export const deleteProject = (workspaceId: string, projectId: string) =>
  api<void>(`/workspaces/${workspaceId}/projects/${projectId}`, {
    method: "DELETE",
  })
