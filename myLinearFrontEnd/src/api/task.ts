import { api } from "./client"
import type {
  CreateTaskInput,
  TaskDetail,
  TaskNode,
  TaskRow,
  UpdateTaskInput,
} from "./types"

// Task 接口见 docs/api.md §8（嵌套于 workspace）；项目任务列表见 §7 末尾

// 项目详情页任务列表：平铺含子任务（parentId 组树），按 status 枚举序、createdAt 排序；
// P2 条件列表 f= 重复参数（project 字段隐含，契约见 api.md §7 / P2.md §2.2）
export const listProjectTasks = (workspaceId: string, projectId: string, f: readonly string[] = []) => {
  const qs = new URLSearchParams()
  for (const cond of f) qs.append("f", cond)
  const q = qs.toString()
  return api<TaskRow[]>(`/workspaces/${workspaceId}/projects/${projectId}/tasks${q ? `?${q}` : ""}`)
}

// 任务列表页主查询：P2 条件列表 f= 重复参数（tab 基底作用域由页面侧合成进 f=，同 listProjects 范式）
export const listWorkspaceTasks = (workspaceId: string, f: readonly string[]) => {
  const qs = new URLSearchParams()
  for (const cond of f) qs.append("f", cond)
  const q = qs.toString()
  return api<TaskRow[]>(`/workspaces/${workspaceId}/tasks${q ? `?${q}` : ""}`)
}

export const createTask = (workspaceId: string, input: CreateTaskInput) =>
  api<TaskDetail>(`/workspaces/${workspaceId}/tasks`, {
    method: "POST",
    body: JSON.stringify(input),
  })

export const getTask = (workspaceId: string, taskId: string) =>
  api<TaskDetail>(`/workspaces/${workspaceId}/tasks/${taskId}`)

// 子任务区数据源：递归 CTE 取全部后代（depth > 0），前端组装树并计算 x/y 徽标
export const getTaskSubtree = (workspaceId: string, taskId: string) =>
  api<TaskNode[]>(`/workspaces/${workspaceId}/tasks/${taskId}/subtree`)

export const updateTask = (workspaceId: string, taskId: string, input: UpdateTaskInput) =>
  api<TaskDetail>(`/workspaces/${workspaceId}/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  })

// 软删除（R5）：单条递归 UPDATE 级联整棵子树；204 幂等，404 = 不存在或已删
export const deleteTask = (workspaceId: string, taskId: string) =>
  api<void>(`/workspaces/${workspaceId}/tasks/${taskId}`, { method: "DELETE" })
