import { useMemo, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { Plus } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { ProjectRef, TaskStatus, TaskTab } from "@/api/types"
import { displayError } from "@/lib/errors"
import { encodeConds, parseConds, writeConds, type FilterCond } from "@/lib/filter-state"
import { newTaskDisplay, type TaskDisplayState } from "@/lib/task-display-state"
import { useWorkspaces } from "@/hooks/useWorkspaces"
import { useWorkspaceTasks } from "@/hooks/useTasks"
import { PageHeader, tabPill } from "@/components/layout/PageHeader"
import { Breadcrumb } from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { FilterButton } from "@/components/filter/filter-menu"
import { FilterChipRow } from "@/components/filter/filter-chips"
import { TaskDisplayButton } from "@/components/display/task-display-menu"
import { CreateTaskDialog } from "@/components/task/CreateTaskDialog"
import { TaskGroupList } from "@/components/task/TaskGroupList"

// 顶部 tab（P0.md §3）：纯前端隐式基底作用域，请求时合成 f= status 条件（后端 filter= 已退役）
const TAB_KEYS: TaskTab[] = ["active", "backlog", "all"]

// tab → 基底条件（不显示为 chip）：Active = todo + in_progress、Backlog = backlog、All = 不附加
const TAB_CONDS: Record<TaskTab, FilterCond[]> = {
  active: [{ field: "status", op: "isAnyOf", values: ["todo", "in_progress"] }],
  backlog: [{ field: "status", op: "is", values: ["backlog"] }],
  all: [],
}

// /w/:workspaceId/tasks → 任务列表（按状态分组 + 树形子任务，见 P0.md §3）
// 结构对齐 Linear：面包屑行 → tab 行（右侧 Filter + New task）→ 条件 chip 行 → 分组列表
export function TaskListPage() {
  const { t } = useTranslation()
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: workspaces } = useWorkspaces()

  // tab 与条件均放 URL（?tab=&f=），刷新/分享后仍停留；缺省/非法 tab 回退 all
  //（侧栏 Tasks 入口与删除后导航均不带参 → 统一落 All 视图）
  const rawTab = searchParams.get("tab")
  const tab: TaskTab = rawTab === "active" || rawTab === "backlog" ? rawTab : "all"
  // P2 条件列表镜像进 URL（?f= 重复参数）；与后端 Parse 同规则丢弃非法条目，
  // 保证 chip 行显示与后端求值永远一致
  const conds = useMemo(() => parseConds(searchParams, "tasks_page"), [searchParams])
  const setConds = (next: FilterCond[]) => {
    const sp = new URLSearchParams(searchParams)
    writeConds(sp, next)
    setSearchParams(sp, { replace: true })
  }
  // 请求 f= = tab 基底条件 + chip 条件（AND 叠加）；切 tab 只改写 tab 键，保留 f=
  const fParams = useMemo(() => encodeConds([...TAB_CONDS[tab], ...conds]), [tab, conds])
  const setTab = (key: TaskTab) => {
    const sp = new URLSearchParams(searchParams)
    sp.set("tab", key)
    setSearchParams(sp, { replace: true })
  }

  const { data: tasks, isLoading, isError, error } = useWorkspaceTasks(workspaceId, fParams)

  // display 状态每 tab 一份（用户定案 2026-09）：纯前端内存，切 tab 不丢、刷新复位；
  // 各 tab 默认态同用户图1（status 分组 + sub/nested 双开）
  const [displayByTab, setDisplayByTab] = useState<Record<TaskTab, TaskDisplayState>>(() => ({
    active: newTaskDisplay(),
    backlog: newTaskDisplay(),
    all: newTaskDisplay(),
  }))
  const display = displayByTab[tab]
  const setDisplay = (next: TaskDisplayState) =>
    setDisplayByTab((prev) => ({ ...prev, [tab]: next }))

  const [createOpen, setCreateOpen] = useState(false)
  const [createStatus, setCreateStatus] = useState<TaskStatus>("todo")
  // 组头 "+" 预填：status 必传；project 组路径命中时锁定归属
  const [createProject, setCreateProject] = useState<ProjectRef | undefined>(undefined)
  const openCreate = (status: TaskStatus, project?: ProjectRef) => {
    setCreateStatus(status)
    setCreateProject(project)
    setCreateOpen(true)
  }

  const workspaceName =
    workspaces?.find((w) => w.id === workspaceId)?.name ?? t("common.workspaceFallback")

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={
          <Breadcrumb
            items={[{ label: workspaceName, to: `/w/${workspaceId}/home` }, { label: t("nav.tasks") }]}
          />
        }
        tabs={TAB_KEYS.map((key) => (
          <button key={key} onClick={() => setTab(key)} className={tabPill(tab === key)}>
            {t(`enums.taskFilter.${key}`)}
          </button>
        ))}
        actions={
          <>
            <FilterButton
              workspaceId={workspaceId!}
              surface="tasks_page"
              conds={conds}
              onChange={setConds}
            />
            {/* Completed tasks 行仅 All tab（其余 tab 基底条件已排除 completed） */}
            <TaskDisplayButton
              state={display}
              onChange={setDisplay}
              showCompletedRow={tab === "all"}
            />
            {/* 与 New project / Add a member 同款 ghost 按钮 */}
            <Button variant="ghost" size="sm" onClick={() => openCreate("todo")}>
              <Plus />
              {t("task.newTask")}
            </Button>
          </>
        }
      />

      {/* 条件 chip 行（tab 行与列表之间）：仅存在条件时渲染 */}
      {conds.length > 0 && (
        <FilterChipRow
          workspaceId={workspaceId!}
          surface="tasks_page"
          conds={conds}
          onChange={setConds}
        />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 scrollbar-gutter-stable">
        {isLoading && <p className="py-4 text-sm text-muted-foreground">{t("common.loading")}</p>}
        {isError && (
          <p className="py-4 text-sm text-destructive">
            {displayError(t, error, "task.loadFailed")}
          </p>
        )}
        {!isLoading && !isError && (tasks?.length ?? 0) === 0 && (
          <div className="rounded-lg border border-dashed border-border p-10 text-center">
            <p className="text-sm text-muted-foreground">
              {conds.length > 0 ? t("filter.emptyResult") : t("task.emptyFilter")}
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-4"
              onClick={() => openCreate(tab === "backlog" ? "backlog" : "todo")}
            >
              <Plus />
              {t("task.newTask")}
            </Button>
          </div>
        )}
        {(tasks?.length ?? 0) > 0 && (
          <TaskGroupList
            tasks={tasks!}
            state={display}
            workspaceId={workspaceId!}
            onOpenTask={(id) => navigate(`/w/${workspaceId}/tasks/${id}`)}
            onNewTask={openCreate}
            onOpenProject={(id) => navigate(`/w/${workspaceId}/projects/${id}`)}
          />
        )}
      </div>

      {/* 列表页入口不锁定项目（任务可不归属项目），弹窗内自选；project 组头 "+" 预填锁定 */}
      <CreateTaskDialog
        open={createOpen}
        workspaceId={workspaceId!}
        project={createProject}
        defaultStatus={createStatus}
        onClose={() => setCreateOpen(false)}
      />
    </div>
  )
}
