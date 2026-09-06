import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query"
import {
  createLabel,
  deleteLabel,
  listLabels,
  setProjectLabels,
  setTaskLabels,
  updateLabel,
} from "@/api/label"
import type {
  CreateLabelInput,
  Label,
  LabelScope,
  UpdateLabelInput,
} from "@/api/types"
// 标签改名/改色/删除会连带改变任务行、项目行、子树节点内嵌的 LabelRef（行完备原则 §2.9），
// 需跨域失效 tasks / projects 前缀（key 复用唯一来源，同 useMembers → projectsKey 约定）
import { projectDetailKey, projectsKey } from "./useProjects"
import { taskDetailKey, tasksKey } from "./useTasks"

// 标签域 key：全量 [..., "labels"]；按 scope 过滤 [..., "labels", { scope }]
// （对象段对齐 projects 的 { sort, order } 变体约定，invalidate 前缀匹配天然覆盖两种形状）
export const labelsKey = (workspaceId: string) => ["workspaces", workspaceId, "labels"] as const
const labelsScopeKey = (workspaceId: string, scope: LabelScope) =>
  [...labelsKey(workspaceId), { scope }] as const

/**
 * scope 可选：缺席拉全量（管理区两个 section 共享一份缓存），传则按 scope 过滤（打标 popover）。
 * enabled 供常驻挂载的弹窗按 open 惰性启用（同 useProjects）：弹窗未开时不必预取选项列表
 */
export function useLabels(workspaceId: string | undefined, scope?: LabelScope, enabled = true) {
  return useQuery({
    queryKey: scope ? labelsScopeKey(workspaceId!, scope) : labelsKey(workspaceId!),
    queryFn: () => listLabels(workspaceId!, scope),
    enabled: !!workspaceId && enabled,
    // staleTime: Infinity —— 标签列表的变更入口只有本模块 CRUD mutation（均已失效本前缀，
    // 失效无视 staleTime 强制刷新），挂载时不再重复 GET /labels（同 useMembers）
    staleTime: Infinity,
  })
}

// ---- 标签 CRUD（管理区唯一入口，P1“先定义后使用”策略）----

// CRUD 成功后统一失效三域：labels 自身 + tasks/projects 前缀。
// 改名/改色/删除都会使缓存行内嵌的 LabelRef 过期（删除时联结行由外键 CASCADE，
// 任务/项目本体不变但行内 labels 少一项）；非活跃缓存仅标记，待挂载时取
function invalidateLabelConsumers(qc: QueryClient, workspaceId: string) {
  qc.invalidateQueries({ queryKey: labelsKey(workspaceId) })
  qc.invalidateQueries({ queryKey: tasksKey(workspaceId) })
  qc.invalidateQueries({ queryKey: projectsKey(workspaceId) })
}

export function useCreateLabel(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateLabelInput) => createLabel(workspaceId, input),
    // 新标签尚未挂到任何任务/项目，只需更新标签域自身；POST 响应即完整 Label，直写两种
    // 形状的列表缓存（全量 + 对应 scope 变体）免去 GET 回源（同 useUpdateLabel）——失效前缀会
    // 把同页其他 scope 的活跃查询（如项目详情页上 CreateTaskDialog 的 task 标签选项）一并拖去 refetch。
    // 列表按 created_at ASC（后端固定，展示层不再排序），新标签必在末尾 → append 与服务端顺序一致；
    // old 缺席时 updater 返回 undefined，setQueryData 直接跳过，不会造出半截缓存
    // （staleTime: Infinity 下半截缓存会被当成完整数据而永不回源）
    onSuccess: (label) => {
      qc.setQueryData(labelsKey(workspaceId), (old: Label[] | undefined) =>
        old ? [...old, label] : undefined,
      )
      qc.setQueryData(labelsScopeKey(workspaceId, label.scope), (old: Label[] | undefined) =>
        old ? [...old, label] : undefined,
      )
    },
  })
}

export function useUpdateLabel(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ labelId, input }: { labelId: string; input: UpdateLabelInput }) =>
      updateLabel(workspaceId, labelId, input),
    // PATCH 与 GET 同构（Label）：响应直写两种形状的列表缓存（全量 + scope 变体），不再额外 GET；
    // 行内嵌 LabelRef 无法由响应派生，仍跨域失效 tasks/projects 前缀
    onSuccess: (label) => {
      qc.setQueryData(labelsKey(workspaceId), (old: Label[] | undefined) =>
        old?.map((l) => (l.id === label.id ? label : l)),
      )
      qc.setQueryData(
        labelsScopeKey(workspaceId, label.scope),
        (old: Label[] | undefined) => old?.map((l) => (l.id === label.id ? label : l)),
      )
      qc.invalidateQueries({ queryKey: tasksKey(workspaceId) })
      qc.invalidateQueries({ queryKey: projectsKey(workspaceId) })
    },
  })
}

export function useDeleteLabel(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (labelId: string) => deleteLabel(workspaceId, labelId),
    onSuccess: () => invalidateLabelConsumers(qc, workspaceId),
  })
}

// ---- 打标 PUT（全量替换，响应为带新 labels 的 Detail）----

export function useSetTaskLabels(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, labelIds }: { taskId: string; labelIds: string[] }) =>
      setTaskLabels(workspaceId, taskId, labelIds),
    onSuccess: (task) => {
      // 响应直写详情缓存（PUT 与 GET 同构，不再 refetch，同 useUpdateTask）；
      // 列表行 / 祖先子树内嵌本任务 labels，照常失效（predicate 排除刚写过的详情；
      // 打标不触发 R4 子树同步，自身子树不含本任务行，无需失效）
      qc.setQueryData(taskDetailKey(workspaceId, task.id), task)
      qc.invalidateQueries({
        queryKey: tasksKey(workspaceId),
        predicate: (q) => q.queryKey[3] !== task.id,
      })
    },
  })
}

export function useSetProjectLabels(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, labelIds }: { projectId: string; labelIds: string[] }) =>
      setProjectLabels(workspaceId, projectId, labelIds),
    onSuccess: (project) => {
      // 响应直写详情缓存；列表行同嵌 labels（P1 不渲染但契约携带，保持缓存一致），
      // predicate 排除刚写过的详情与各 sort 变体之外的键（对齐 useUpdateProject 的形状判断）
      qc.setQueryData(projectDetailKey(workspaceId, project.id), project)
      qc.invalidateQueries({
        queryKey: projectsKey(workspaceId),
        predicate: (q) => q.queryKey[3] !== project.id,
      })
    },
  })
}
