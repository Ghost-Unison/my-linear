import { useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { ArrowDown, ArrowUp, Box, Plus } from "lucide-react"
import type { ProjectRow } from "@/api/types"
import { useProjects } from "@/hooks/useProjects"
import { useWorkspaces } from "@/hooks/useWorkspaces"
import { colorFor } from "@/lib/color"
import { displayError } from "@/lib/errors"
import { cn } from "@/lib/utils"
import { MemberAvatar } from "@/components/ui/avatar"
import { Breadcrumb } from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { PageHeader, tabPill } from "@/components/layout/PageHeader"
import { PriorityIcon, usePriorityLabel } from "@/components/ui/priority-icon"
import { CreateProjectDialog } from "@/components/project/CreateProjectDialog"
import {
  ProjectStatusIcon,
  useProjectStatusLabel,
} from "@/components/project/project-status"

// 表头 / 数据行共用同一套列宽：名称弹性，其余定宽，任务数右对齐
// 固定列合计 48rem + 5 间距 ≈ 53rem，配 min-w 保证窄屏横向滚动而非压缩 Name 列
const ROW_GRID = "grid-cols-[minmax(0,1fr)_9rem_9rem_11rem_15rem_4rem]"
const TABLE_MIN_W = "min-w-[63rem]"

// 后端 sort 白名单（api.md §7）：name/createdAt/priority/status；表头仅 name/status/priority 可点
const SORTABLE = new Set(["name", "status", "priority"])

// /w/:workspaceId/projects → 项目列表（P0.md §2：行只读，点击进详情页；不做行内编辑）
export function ProjectListPage() {
  const { t } = useTranslation()
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  // 排序状态放 URL（?sort=&order=），刷新/分享后仍保持
  const sort = searchParams.get("sort") ?? "createdAt"
  const order = searchParams.get("order") ?? "desc"
  const { data: projects, isLoading, isError, error } = useProjects(workspaceId, sort, order)
  const { data: workspaces } = useWorkspaces()
  const [createOpen, setCreateOpen] = useState(false)
  const workspaceName =
    workspaces?.find((w) => w.id === workspaceId)?.name ?? t("common.workspaceFallback")

  // 点同一列切换升降序；点新列重置为 asc
  const toggleSort = (field: string) => {
    if (sort === field) {
      setSearchParams({ sort: field, order: order === "asc" ? "desc" : "asc" }, { replace: true })
    } else {
      setSearchParams({ sort: field, order: "asc" }, { replace: true })
    }
  }

  const headerCell = (field: string | null, label: string, className?: string) => {
    if (!field || !SORTABLE.has(field)) {
      return (
        <span key={label} className={className}>
          {label}
        </span>
      )
    }
    return (
      <button
        key={label}
        onClick={() => toggleSort(field)}
        className={cn(
          "flex items-center gap-1 text-left transition-colors hover:text-foreground",
          sort === field && "text-foreground",
          className,
        )}
      >
        {label}
        {sort === field &&
          (order === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </button>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* 页头（Linear 风格）：面包屑行 → 分割线 → tab 行（All projects + 右上 New project）。
          All projects 为选中态胶囊占位（当前只有一个视图，未来筛选 tab 在此扩展） */}
      <PageHeader
        title={
          <Breadcrumb
            items={[
              { label: workspaceName, to: `/w/${workspaceId}/home` },
              { label: t("nav.projects") },
            ]}
          />
        }
        tabs={<span className={tabPill(true)}>{t("project.allProjects")}</span>}
        actions={
          <Button variant="ghost" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus />
            {t("project.newProject")}
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {/* 窄屏允许横向滚动（min-w 撑开 grid，Name 列不被压成 0 宽） */}
        <div className="overflow-x-auto">
          <div className={TABLE_MIN_W}>
            <div
              className={`mt-2 grid ${ROW_GRID} gap-4 border-b border-border pb-2 text-xs font-medium text-muted-foreground`}
            >
              {headerCell("name", t("common.name"))}
              {headerCell("status", t("common.status"))}
              {headerCell("priority", t("common.priority"))}
              {headerCell(null, t("project.lead"))}
              {headerCell(null, t("project.dates"))}
              {headerCell(null, t("nav.tasks"), "justify-end")}
            </div>

            {isLoading && (
              <p className="py-4 text-sm text-muted-foreground">{t("common.loading")}</p>
            )}
            {isError && (
              <p className="py-4 text-sm text-destructive">
                {displayError(t, error, "errors.loadFailed")}
              </p>
            )}
            {!isLoading && projects?.length === 0 && (
              <p className="py-4 text-sm text-muted-foreground">{t("project.empty")}</p>
            )}

            {projects?.map((p) => (
              <ProjectListRow
                key={p.id}
                project={p}
                onOpen={() => navigate(`/w/${workspaceId}/projects/${p.id}`)}
              />
            ))}
          </div>
        </div>
      </div>

      <CreateProjectDialog
        open={createOpen}
        workspaceId={workspaceId!}
        onClose={() => setCreateOpen(false)}
      />
    </div>
  )
}

function ProjectListRow({ project: p, onOpen }: { project: ProjectRow; onOpen: () => void }) {
  const statusLabel = useProjectStatusLabel()
  const priorityLabel = usePriorityLabel()
  const start = p.startDate ?? ""
  const target = p.targetDate ?? ""
  return (
    <div
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      tabIndex={0}
      title={p.name}
      className={`group grid ${ROW_GRID} cursor-pointer items-center gap-4 border-b border-border py-2 transition-colors last:border-0 hover:bg-accent/50`}
    >
      {/* 项目无 icon/color 字段，图标底色按名字散列取确定性颜色（同头像约定） */}
      <span className="flex min-w-0 items-center gap-2.5">
        <span
          className="flex size-5 shrink-0 items-center justify-center rounded"
          style={{ backgroundColor: colorFor(p.name) }}
        >
          <Box className="size-3 text-white" />
        </span>
        <span className="truncate text-sm">{p.name}</span>
      </span>
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <ProjectStatusIcon status={p.status} />
        {statusLabel(p.status)}
      </span>
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <PriorityIcon value={p.priority} />
        {priorityLabel(p.priority)}
      </span>
      <span className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
        {p.lead ? (
          <>
            <MemberAvatar name={p.lead.name} color={p.lead.avatarColor || undefined} />
            <span className="truncate">{p.lead.name}</span>
          </>
        ) : (
          "—"
        )}
      </span>
      <span className="text-sm text-muted-foreground">
        {start || target ? `${start || "—"} → ${target || "—"}` : "—"}
      </span>
      <span className="text-right text-sm text-muted-foreground">{p.taskCount}</span>
    </div>
  )
}
