import { api } from "./client"
import type {
  CreateLabelInput,
  Label,
  LabelScope,
  ProjectDetail,
  TaskDetail,
  UpdateLabelInput,
} from "./types"

// Label 接口见 docs/api.md §9（CRUD 嵌套于 workspace，打标 PUT 挂在任务/项目资源下）

// scope 可选：缺席返回该 workspace 全部标签（管理区一次拉全量，按 scope 分两个 section 渲染）
export const listLabels = (workspaceId: string, scope?: LabelScope) =>
  api<Label[]>(
    `/workspaces/${workspaceId}/labels${scope ? `?scope=${scope}` : ""}`,
  )

// 同 scope 重名 → 409 NAME_CONFLICT；name 空 / color 非 hex / scope 非法 → 400
export const createLabel = (workspaceId: string, input: CreateLabelInput) =>
  api<Label>(`/workspaces/${workspaceId}/labels`, {
    method: "POST",
    body: JSON.stringify(input),
  })

export const updateLabel = (
  workspaceId: string,
  labelId: string,
  input: UpdateLabelInput,
) =>
  api<Label>(`/workspaces/${workspaceId}/labels/${labelId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  })

// 硬删除；task_label / project_label 联结行由外键 CASCADE，任务/项目本体不受影响；204 幂等
export const deleteLabel = (workspaceId: string, labelId: string) =>
  api<void>(`/workspaces/${workspaceId}/labels/${labelId}`, { method: "DELETE" })

// ---- 打标 PUT（全量替换语义，api.md §9）----
// labelIds 缺席 = 不动；[] 与显式 null 均 = 清空全部；响应为带新 labels 的 Detail，
// 前端直接 setQueryData 更新详情缓存而不 refetch（见 useLabels.ts）

export const setTaskLabels = (
  workspaceId: string,
  taskId: string,
  labelIds: string[],
) =>
  api<TaskDetail>(`/workspaces/${workspaceId}/tasks/${taskId}/labels`, {
    method: "PUT",
    body: JSON.stringify({ labelIds }),
  })

export const setProjectLabels = (
  workspaceId: string,
  projectId: string,
  labelIds: string[],
) =>
  api<ProjectDetail>(`/workspaces/${workspaceId}/projects/${projectId}/labels`, {
    method: "PUT",
    body: JSON.stringify({ labelIds }),
  })
