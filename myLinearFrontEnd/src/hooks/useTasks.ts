import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query"
import {
  createTask,
  deleteTask,
  getTask,
  getTaskSubtree,
  listProjectTasks,
  listWorkspaceTasks,
  updateTask,
} from "@/api/task"
import type {
  CreateTaskInput,
  ProjectDetail,
  ProjectRow,
  TaskDetail,
  TaskNode,
  UpdateTaskInput,
} from "@/api/types"
import { projectDetailKey, projectTasksKey, projectsKey } from "./useProjects"

// 任务增删对 project 行的影响仅 taskCount（COUNT 含子任务，见 project.sql）：
// 外科式 +/- 列表全部 sort 变体（key[3] 为 sort 对象）与项目详情缓存，
// 避免整前缀 invalidate 导致本页活跃的项目选项查询（name&asc）被无谓 refetch
function bumpProjectTaskCount(
  qc: QueryClient,
  workspaceId: string,
  projectId: string,
  delta: number,
) {
  qc.setQueriesData(
    {
      queryKey: projectsKey(workspaceId),
      predicate: (q) => q.queryKey.length === 4 && typeof q.queryKey[3] === "object",
    },
    (old: ProjectRow[] | undefined) =>
      old?.map((p) => (p.id === projectId ? { ...p, taskCount: p.taskCount + delta } : p)),
  )
  qc.setQueryData(
    projectDetailKey(workspaceId, projectId),
    (old: ProjectDetail | undefined) =>
      old ? { ...old, taskCount: old.taskCount + delta } : old,
  )
}

// 任务域缓存：列表 / 详情 / 子树共享 tasks 前缀，任一任务变更后整域前缀失效。
// key 唯一来源导出（同 projectsKey 约定）：useLabels 的标签改名/改色/删除跨域失效与打标外科更新复用
export const tasksKey = (workspaceId: string) => ["workspaces", workspaceId, "tasks"] as const
export const taskDetailKey = (workspaceId: string, taskId: string) =>
  [...tasksKey(workspaceId), taskId] as const
const taskSubtreeKey = (workspaceId: string, taskId: string) =>
  [...taskDetailKey(workspaceId, taskId), "subtree"] as const

export function useProjectTasks(
  workspaceId: string | undefined,
  projectId: string | undefined,
  // P2 条件列表（f= 编码串数组，同 useWorkspaceTasks 范式）：进 queryKey → 过滤切换发请求
  f: readonly string[] = [],
  enabled = true,
) {
  return useQuery({
    queryKey: [...projectTasksKey(workspaceId!, projectId!), "list", [...f]],
    queryFn: () => listProjectTasks(workspaceId!, projectId!, f),
    enabled: !!workspaceId && !!projectId && enabled,
  })
}

export function useWorkspaceTasks(workspaceId: string | undefined, f: readonly string[], enabled = true) {
  return useQuery({
    // f= 编码串数组进 queryKey（同 useProjects 范式）：tab/chip 条件切换即发请求
    queryKey: [...tasksKey(workspaceId!), "list", [...f]],
    queryFn: () => listWorkspaceTasks(workspaceId!, f),
    enabled: !!workspaceId && enabled,
  })
}

export function useTask(workspaceId: string | undefined, taskId: string | undefined) {
  return useQuery({
    queryKey: taskDetailKey(workspaceId!, taskId!),
    queryFn: () => getTask(workspaceId!, taskId!),
    enabled: !!workspaceId && !!taskId,
  })
}

export function useTaskSubtree(workspaceId: string | undefined, taskId: string | undefined) {
  return useQuery({
    queryKey: taskSubtreeKey(workspaceId!, taskId!),
    queryFn: () => getTaskSubtree(workspaceId!, taskId!),
    enabled: !!workspaceId && !!taskId,
  })
}

export function useCreateTask(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateTaskInput) => createTask(workspaceId, input),
    onSuccess: (task, input) => {
      // 任务域：列表行/祖先子树需刷新；排除锚任务详情（新子任务不改变锚任务自身字段）
      qc.invalidateQueries({
        queryKey: tasksKey(workspaceId),
        predicate: (q) => q.queryKey.length > 4 || q.queryKey[3] !== input.parentId,
      })
      // 项目域：taskCount 外科 +1；行数据仅失效该项目的任务列表（项目详情页挂载时才 refetch）
      if (task.project) {
        bumpProjectTaskCount(qc, workspaceId, task.project.id, 1)
        qc.invalidateQueries({ queryKey: projectTasksKey(workspaceId, task.project.id) })
      }
    },
  })
}

export function useUpdateTask(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, input }: { taskId: string; input: UpdateTaskInput }) =>
      updateTask(workspaceId, taskId, input),
    onSuccess: (task, { input }) => {
      // 先用响应更新详情缓存（chip 即时回显，PATCH 与 GET 同构不再 refetch）；
      // predicate 排除详情（刚写过）；自身子树仅 project 变更时受影响（R4 同步整棵子树），
      // 列表行/祖先子树内嵌本任务字段照常失效（非活跃仅标记，待挂载取）
      const projectChanged = "projectId" in input
      qc.setQueryData(taskDetailKey(workspaceId, task.id), task)
      qc.invalidateQueries({
        queryKey: tasksKey(workspaceId),
        predicate: (q) =>
          q.queryKey[3] !== task.id || (projectChanged && q.queryKey.length > 4),
      })
      // 项目行 taskCount / 任务行内嵌 project 引用仅归属变更时受影响
      if (projectChanged) {
        qc.invalidateQueries({ queryKey: projectsKey(workspaceId) })
      }
    },
  })
}

export function useDeleteTask(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (taskId: string) => deleteTask(workspaceId, taskId),
    // 失效任务域（predicate 排除死键）+ 外科 bump 项目行 taskCount；页面侧导航离开（对齐 Linear 回任务列表）。
    // 列表页 staleTime=0 挂载必 refetch，无需 await / refetchType:"all"（该组合原只为回父任务页防闪已删节点）；
    // predicate 排除已删子树的详情/子树缓存：invalidate 时当前详情页尚未卸载，
    // 不排除则其活跃缓存会被 refetch 而必然 404
    onSuccess: (_data, taskId) => {
      const subtree = qc.getQueryData<TaskNode[]>(taskSubtreeKey(workspaceId, taskId)) ?? []
      const dead = new Set<string>([taskId, ...subtree.map((n) => n.id)])
      qc.invalidateQueries({
        queryKey: tasksKey(workspaceId),
        predicate: (q) => !dead.has(q.queryKey[3] as string),
      })
      // 项目域：已删子树共享同一 project（R4），taskCount 外科 -dead.size；
      // 行数据仅失效该项目的任务列表（非活跃仅标记，待挂载取）
      const projectId = qc.getQueryData<TaskDetail>(taskDetailKey(workspaceId, taskId))?.project
        ?.id
      if (projectId) {
        bumpProjectTaskCount(qc, workspaceId, projectId, -dead.size)
        qc.invalidateQueries({ queryKey: projectTasksKey(workspaceId, projectId) })
      }
    },
  })
}
