import { useEffect, useState } from "react"
import { Link, NavLink, useParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { ChevronRight, Folder, Home, ListTodo, Plus } from "lucide-react"
import { useWorkspaces } from "@/hooks/useWorkspaces"
import { cn } from "@/lib/utils"
import { WorkspaceAvatar } from "@/components/ui/avatar"
import { LanguageSwitcher } from "@/components/layout/LanguageSwitcher"
import type { Workspace } from "@/api/types"

// 左侧栏：workspace 可展开导航树（Home/Projects/Tasks），见 P0.md §0；Views 入口 P1 才展示
export function Sidebar() {
  const { t } = useTranslation()
  const { data: workspaces, isLoading } = useWorkspaces()
  const { workspaceId: activeId } = useParams()
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())

  // 当前路由所在 workspace 自动展开
  useEffect(() => {
    if (!activeId) return
    setExpanded((prev) => (prev.has(activeId) ? prev : new Set(prev).add(activeId)))
  }, [activeId])

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-card">
      <div className="flex h-12 items-center gap-2 px-4">
        <span className="flex size-4 items-center justify-center rounded bg-primary text-[10px] font-bold text-white">
          m
        </span>
        <span className="text-sm font-semibold tracking-tight">myLinear</span>
      </div>

      <div className="flex items-center justify-between px-3 pb-1 pt-2">
        <span className="text-xs font-medium text-muted-foreground">{t("nav.workspaces")}</span>
        <Link
          to="/w/new"
          title={t("nav.newWorkspace")}
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Plus className="size-4" />
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        {isLoading && (
          <p className="px-2 py-1 text-xs text-muted-foreground">{t("common.loading")}</p>
        )}
        {!isLoading && workspaces?.length === 0 && (
          <p className="px-2 py-1 text-xs text-muted-foreground">{t("nav.emptyWorkspaces")}</p>
        )}
        {workspaces?.map((ws) => (
          <WorkspaceNode
            key={ws.id}
            workspace={ws}
            expanded={expanded.has(ws.id)}
            onToggle={() => toggle(ws.id)}
          />
        ))}
      </nav>

      {/* 侧栏底部：语言切换（EN / 中），持久化到 localStorage */}
      <div className="border-t border-border px-3 py-3">
        <LanguageSwitcher />
      </div>
    </aside>
  )
}

function WorkspaceNode({
  workspace,
  expanded,
  onToggle,
}: {
  workspace: Workspace
  expanded: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const items = [
    { to: `/w/${workspace.id}/home`, label: t("nav.home"), icon: Home },
    { to: `/w/${workspace.id}/projects`, label: t("nav.projects"), icon: Folder },
    { to: `/w/${workspace.id}/tasks`, label: t("nav.tasks"), icon: ListTodo },
  ]

  return (
    <div className="mb-0.5">
      <div className="flex h-8 items-center gap-0.5 rounded-md pr-1 text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground">
        <button
          onClick={onToggle}
          aria-label={expanded ? t("common.collapse") : t("common.expand")}
          aria-expanded={expanded}
          className="flex size-6 shrink-0 items-center justify-center rounded-md"
        >
          <ChevronRight
            className={cn("size-3.5 transition-transform", expanded && "rotate-90")}
          />
        </button>
        <Link
          to={`/w/${workspace.id}/home`}
          className="flex min-w-0 flex-1 items-center gap-2"
          title={workspace.name}
        >
          <WorkspaceAvatar name={workspace.name} />
          <span className="truncate">{workspace.name}</span>
        </Link>
      </div>
      {expanded && (
        <div className="mb-1 ml-5.75 flex flex-col gap-0.5 border-l border-border pl-1.5">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "flex h-7 items-center gap-2 rounded-md px-2 text-[13px] transition-colors",
                  isActive
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )
              }
            >
              <item.icon className="size-3.5" />
              {item.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}
