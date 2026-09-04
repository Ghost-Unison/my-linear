import { api } from "./client"
import type {
  CreateTaskInput,
  TaskDetail,
  TaskFilter,
  TaskNode,
  TaskRow,
  UpdateTaskInput,
} from "./types"

// Task 接口见 docs/api.md §8（嵌套于 workspace）；项目任务列表见 §7 末尾

// 项目详情页任务列表：平铺含子任务（parentId 组树），按 status 枚举序、createdAt 排序
export const listProjectTasks = (workspaceId: string, projectId: string) =>
  api<TaskRow[]>(`/workspaces/${workspaceId}/projects/${projectId}/tasks`)

// 任务列表页主查询：filter=all|active|backlog（active = todo + in_progress）
export const listWorkspaceTasks = (workspaceId: string, filter: TaskFilter) =>
  api<TaskRow[]>(`/workspaces/${workspaceId}/tasks?filter=${filter}`)

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
