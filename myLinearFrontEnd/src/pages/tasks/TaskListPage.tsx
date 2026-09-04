import { useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { Plus } from "lucide-react"
import type { TaskFilter, TaskStatus } from "@/api/types"
import { errorMessage } from "@/api/client"
import { useWorkspaces } from "@/hooks/useWorkspaces"
import { useWorkspaceTasks } from "@/hooks/useTasks"
import { PageHeader, tabPill } from "@/components/layout/PageHeader"
import { Breadcrumb } from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { CreateTaskDialog } from "@/components/task/CreateTaskDialog"
import { TaskGroupList } from "@/components/task/TaskGroupList"

// 顶部固定筛选 tab（P0.md §3）：Active = todo + in_progress（api.md §8）
const FILTERS: { key: TaskFilter; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "backlog", label: "Backlog" },
  { key: "all", label: "All" },
]

// /w/:workspaceId/tasks → 任务列表（按状态分组 + 树形子任务，见 P0.md §3）
// 结构对齐 Linear：面包屑行 → 筛选 tab 行（右侧 New task）→ 分组列表
export function TaskListPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: workspaces } = useWorkspaces()

  // 筛选状态放 URL（?filter=），刷新/分享后仍停留；缺省/非法值回退 all
  // （对齐 api.md §8 后端默认；侧栏 Tasks 入口与删除后导航均不带参 → 统一落 All 视图）
  const raw = searchParams.get("filter")
  const filter: TaskFilter = raw === "backlog" || raw === "active" ? raw : "all"
  const setFilter = (key: TaskFilter) => setSearchParams({ filter: key }, { replace: true })

  const { data: tasks, isLoading, isError, error } = useWorkspaceTasks(workspaceId, filter)

  const [createOpen, setCreateOpen] = useState(false)
  const [createStatus, setCreateStatus] = useState<TaskStatus>("todo")
  const openCreate = (status: TaskStatus) => {
    setCreateStatus(status)
    setCreateOpen(true)
  }

  const workspaceName = workspaces?.find((w) => w.id === workspaceId)?.name ?? "Workspace"

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={
          <Breadcrumb
            items={[{ label: workspaceName, to: `/w/${workspaceId}/home` }, { label: "Tasks" }]}
          />
        }
        tabs={FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)} className={tabPill(filter === f.key)}>
            {f.label}
          </button>
        ))}
        actions={
          // 与 New project / Add a member 同款 ghost 按钮
          <Button variant="ghost" size="sm" onClick={() => openCreate("todo")}>
            <Plus />
            New task
          </Button>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 scrollbar-gutter-stable">
        {isLoading && <p className="py-4 text-sm text-muted-foreground">加载中…</p>}
        {isError && (
          <p className="py-4 text-sm text-destructive">{errorMessage(error, "任务加载失败")}</p>
        )}
        {!isLoading && !isError && (tasks?.length ?? 0) === 0 && (
          <div className="rounded-lg border border-dashed border-border p-10 text-center">
            <p className="text-sm text-muted-foreground">该筛选下还没有任务</p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-4"
              onClick={() => openCreate(filter === "backlog" ? "backlog" : "todo")}
            >
              <Plus />
              New task
            </Button>
          </div>
        )}
        {(tasks?.length ?? 0) > 0 && (
          <TaskGroupList
            tasks={tasks!}
            // All = 全量树形（跨状态置灰）；Active/Backlog = 筛选平铺（父任务以面包屑体现）
            view={filter === "all" ? "tree" : "flat"}
            onOpenTask={(id) => navigate(`/w/${workspaceId}/tasks/${id}`)}
            onNewTask={openCreate}
            onOpenProject={(id) => navigate(`/w/${workspaceId}/projects/${id}`)}
          />
        )}
      </div>

      {/* 列表页入口不锁定项目（任务可不归属项目），弹窗内自选 */}
      <CreateTaskDialog
        open={createOpen}
        workspaceId={workspaceId!}
        defaultStatus={createStatus}
        onClose={() => setCreateOpen(false)}
      />
    </div>
  )
}
