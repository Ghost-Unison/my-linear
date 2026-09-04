import { useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { Plus } from "lucide-react"
import { ApiError } from "@/api/client"
import { useDeleteWorkspace, useWorkspace } from "@/hooks/useWorkspaces"
import { PageHeader, tabPill } from "@/components/layout/PageHeader"
import { WorkspaceAvatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/dialog"
import { OverviewSection } from "@/components/workspace/OverviewSection"
import { MembersSection } from "@/components/workspace/MembersSection"

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "members", label: "Members" },
  { key: "label", label: "Label" },
] as const

// /w/:workspaceId/home → 对齐 Linear Team Home：面包屑页头 + Tab 切换（Label 内容 P3 补充）
export function WorkspaceHomePage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: workspace, isLoading, isError, error } = useWorkspace(workspaceId)
  const deleteWorkspace = useDeleteWorkspace()
  const [confirmOpen, setConfirmOpen] = useState(false)
  // 添加成员弹窗状态上提：Add a member 按钮与 tab 同行（Linear 页头布局），
  // MembersSection 通过 addOpen/onAddOpenChange 受控
  const [memberAddOpen, setMemberAddOpen] = useState(false)

  // Tab 状态放 URL（?tab=），刷新/分享后仍停留在当前 tab
  const tab = searchParams.get("tab") ?? "overview"
  const setTab = (key: string) => {
    setSearchParams({ tab: key }, { replace: true })
    // 弹窗随 MembersSection 卸载，离开时重置避免下次进入自动弹出
    if (key !== "members") setMemberAddOpen(false)
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        加载中…
      </div>
    )
  }
  if (isError || !workspace) {
    // 404（含查询未启用）以外的错误展示真实原因，不混淆为“不存在”
    const notFound = !error || (error instanceof ApiError && error.status === 404)
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {notFound ? "workspace 不存在或已删除" : `加载失败：${error.message}`}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* 页头（Linear 风格，吸顶）：面包屑行 → 分割线 → tab 行（胶囊 tab + 当前 tab 的操作按钮） */}
      <PageHeader
        title={
          <>
            <WorkspaceAvatar name={workspace.name} className="size-5 text-[11px]" />
            <h1 className="text-sm font-medium">{workspace.name}</h1>
          </>
        }
        tabs={TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={tabPill(tab === t.key)}>
            {t.label}
          </button>
        ))}
        actions={
          tab === "members" ? (
            <Button variant="ghost" size="sm" onClick={() => setMemberAddOpen(true)}>
              <Plus />
              Add a member
            </Button>
          ) : undefined
        }
      />

      <div className="flex-1 overflow-y-auto px-6 py-6 scrollbar-gutter-stable">
        {tab === "overview" && (
          // 内容列限宽居中：与项目/任务详情页内容列同宽（max-w-3xl），跨页风格统一
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
            <OverviewSection key={workspace.id} workspace={workspace} />
            <section className="rounded-lg border border-destructive/40 p-6">
              <h2 className="text-sm font-medium">删除 workspace</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                将永久删除该 workspace 及其全部项目、任务与成员数据，无法恢复。
              </p>
              <Button
                variant="destructive"
                size="sm"
                className="mt-4"
                onClick={() => setConfirmOpen(true)}
              >
                删除 workspace
              </Button>
            </section>
          </div>
        )}
        {tab === "members" && (
          <MembersSection
            workspaceId={workspace.id}
            addOpen={memberAddOpen}
            onAddOpenChange={setMemberAddOpen}
          />
        )}
        {tab === "label" && (
          <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            Label 管理将在后续阶段提供
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={`删除 workspace「${workspace.name}」？`}
        description="该操作会级联删除其下全部数据（成员、项目、任务），无法恢复。"
        confirmText="永久删除"
        destructive
        pending={deleteWorkspace.isPending}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() =>
          deleteWorkspace.mutate(workspace.id, { onSuccess: () => navigate("/") })
        }
      />
    </div>
  )
}
