// 对象模型对应 docs/api.md §4；PATCH 语义见 §1（缺席=不修改，显式 null=置空）

export interface Workspace {
  id: string
  name: string
  description: string
  createdAt: string
  updatedAt: string
}

export interface Member {
  id: string
  name: string
  email: string | null
  avatarColor: string
}

export interface CreateWorkspaceInput {
  name: string
  description?: string
}

export interface UpdateWorkspaceInput {
  name?: string
  description?: string
}

export interface CreateMemberInput {
  name: string
  email?: string
  avatarColor?: string
}

export interface UpdateMemberInput {
  name?: string
  /** 显式 null = 清空 email（api.md §1 PATCH 语义） */
  email?: string | null
  avatarColor?: string
}

// ---- Project（api.md §7）----

export type ProjectStatus = "backlog" | "planned" | "in_progress" | "completed" | "canceled"

/** 嵌入用精简成员引用 */
export interface MemberRef {
  id: string
  name: string
  avatarColor: string
}

export interface ProjectRow {
  id: string
  name: string
  status: ProjectStatus
  /** 0 No priority / 1 Urgent / 2 High / 3 Medium / 4 Low */
  priority: number
  lead: MemberRef | null
  /** 业务日期 YYYY-MM-DD（后端 civil.Date 编解码，见 api.md §2.7） */
  startDate: string | null
  targetDate: string | null
  taskCount: number
  createdAt: string
  updatedAt: string
}

export interface ProjectDetail extends ProjectRow {
  description: string
  members: MemberRef[]
}

export interface CreateProjectInput {
  name: string
  description?: string
  /** 前端必传，默认 backlog */
  status: ProjectStatus
  /** 前端必传，默认 0 */
  priority: number
  leadId?: string
  memberIds?: string[]
  /** YYYY-MM-DD */
  startDate?: string
  targetDate?: string
}

export interface UpdateProjectInput {
  name?: string
  description?: string
  status?: ProjectStatus
  priority?: number
  /** 显式 null = 移除负责人（api.md §1 PATCH 语义） */
  leadId?: string | null
  /** 全量替换语义：传则整体覆盖，缺席不动（api.md §7） */
  memberIds?: string[]
  /** 显式 null = 置空；YYYY-MM-DD */
  startDate?: string | null
  targetDate?: string | null
}

// ---- Task（api.md §8）----

export type TaskStatus = "backlog" | "todo" | "in_progress" | "done" | "canceled"

export interface ProjectRef {
  id: string
  name: string
}

export interface TaskRow {
  id: string
  parentId: string | null
  /** 父任务标题：状态筛选平铺视图下父任务可能不在结果集，行内以 "> parentTitle" 面包屑体现；无父为 null */
  parentTitle: string | null
  title: string
  status: TaskStatus
  /** 0 No priority / 1 Urgent / 2 High / 3 Medium / 4 Low */
  priority: number
  project: ProjectRef | null
  assignee: MemberRef | null
  /** 业务日期 YYYY-MM-DD（后端 civil.Date 编解码，见 api.md §2.7） */
  dueDate: string | null
  createdAt: string
  updatedAt: string
}

/** 父任务引用：子任务详情页 "Sub-issue of" 行（api.md §8 GetTask）；done/total = 父任务后代完成统计 */
export interface ParentRef {
  id: string
  title: string
  status: TaskStatus
  doneCount: number
  totalCount: number
}

export interface TaskDetail extends TaskRow {
  description: string
  parent: ParentRef | null
}

export interface CreateTaskInput {
  title: string
  description?: string
  /** 前端必传（默认选中点击的分组，见 P0.md §3） */
  status: TaskStatus
  /** 前端必传，默认 0 */
  priority: number
  projectId?: string
  parentId?: string
  assigneeId?: string
  /** YYYY-MM-DD */
  dueDate?: string
}

export interface UpdateTaskInput {
  title?: string
  description?: string
  status?: TaskStatus
  priority?: number
  /** 显式 null = 取消指派（api.md §1 PATCH 语义） */
  assigneeId?: string | null
  /** 显式 null = 置空；YYYY-MM-DD */
  dueDate?: string | null
  /** 显式 null = 脱离项目；变更时后端同步整棵子树的 project（R4） */
  projectId?: string | null
}

/** 任务列表页筛选 tab（api.md §8：active = todo + in_progress） */
export type TaskFilter = "active" | "backlog" | "all"

/** 子树节点（GET .../tasks/:id/subtree，api.md §8）：响应仅含 depth > 0 的后代，按 depth、createdAt 排序 */
export interface TaskNode {
  id: string
  parentId: string | null
  depth: number
  title: string
  status: TaskStatus
  /** 0 No priority / 1 Urgent / 2 High / 3 Medium / 4 Low */
  priority: number
  /** 与锚点任务一致（R4）；带上用于徽标悬浮提示与点击跳转 */
  project: ProjectRef | null
  assignee: MemberRef | null
  /** 业务日期 YYYY-MM-DD（后端 civil.Date 编解码） */
  dueDate: string | null
}
