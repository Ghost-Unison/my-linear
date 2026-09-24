import { useEffect, useRef, useState } from "react"
import { Tabs } from "radix-ui"
import { Box, Layers, MoreHorizontal, Pencil, Trash2, UserRound } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { View } from "@/api/types"
import { NONE } from "@/lib/filter-state"
import type { ViewTaskBucket, ViewTaskDimension, ViewTaskSelection } from "@/lib/views-task-stats"
import { cn } from "@/lib/utils"
import { RoundIconButton } from "@/components/ui/round-icon-button"
import { MemberAvatar, WorkspaceAvatar } from "@/components/ui/avatar"
import { LabelDot } from "@/components/ui/label-options"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export function ViewActions({ onEdit, onDelete, disabled, active = true, onInactiveFocus }: {
  onEdit: () => void; onDelete: () => void; disabled: boolean
  active?: boolean; onInactiveFocus?: () => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const focusState = useRef({ active, onInactiveFocus })
  focusState.current = { active, onInactiveFocus }
  useEffect(() => {
    if (!active || disabled) setOpen(false)
  }, [active, disabled])
  return (
    <DropdownMenu modal={false} open={active && !disabled && open}
      onOpenChange={(next) => setOpen(active && !disabled && next)}>
      <DropdownMenuTrigger asChild>
        <RoundIconButton disabled={disabled || !active} label={t("view.edit")}>
          <MoreHorizontal className="size-4" />
        </RoundIconButton>
      </DropdownMenuTrigger>
      {active && <DropdownMenuContent align="end" onCloseAutoFocus={(event) => {
        // Portal 卸载回调可能延后执行，读取最新状态，禁止焦点返回已收起的触发器。
        if (!focusState.current.active) {
          event.preventDefault()
          focusState.current.onInactiveFocus?.()
        }
      }}>
        <DropdownMenuGroup>
          <DropdownMenuItem disabled={disabled} onSelect={onEdit}><Pencil />{t("view.edit")}</DropdownMenuItem>
          <DropdownMenuItem disabled={disabled} variant="destructive" onSelect={onDelete}><Trash2 />{t("view.delete")}</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>}
    </DropdownMenu>
  )
}

const dimensions: { value: ViewTaskDimension; label: string }[] = [
  { value: "assignee", label: "viewsPage.assignees" },
  { value: "label", label: "viewsPage.labels" },
  { value: "project", label: "viewsPage.projects" },
]

export function ViewDetailsSidebar({ view, workspaceName, dimension, selection, buckets, loading, failed,
  onDimension, onSelection, onEdit, onDelete, disabled, active = true, onInactiveFocus,
}: {
  view: View
  workspaceName: string
  dimension: ViewTaskDimension
  selection: ViewTaskSelection | null
  buckets: ViewTaskBucket[]
  loading: boolean
  failed: boolean
  onDimension: (value: ViewTaskDimension) => void
  onSelection: (value: ViewTaskSelection | null) => void
  onEdit: () => void
  onDelete: () => void
  disabled: boolean
  active?: boolean
  onInactiveFocus?: () => void
}) {
  const { t } = useTranslation()
  return (
    <aside aria-label={t("view.details")} className="flex h-full w-80 shrink-0 flex-col gap-3 overflow-y-auto pb-4 xl:w-96">
      <section className="rounded-lg border border-border bg-surface-1 p-4">
        <div className="flex items-center gap-3">
          <Layers className="size-4 shrink-0 text-muted-foreground" />
          <h2 className="min-w-0 flex-1 break-words text-sm font-semibold">{view.name}</h2>
          <ViewActions onEdit={onEdit} onDelete={onDelete} disabled={disabled} active={active} onInactiveFocus={onInactiveFocus} />
        </div>
        {view.description && <p className="mt-3 whitespace-pre-wrap break-words text-sm text-muted-foreground">{view.description}</p>}
      </section>
      <section className="flex items-center gap-4 rounded-lg border border-border bg-surface-1 p-4 text-sm">
        <span className="text-muted-foreground">{t("viewsPage.workspace")}</span>
        <WorkspaceAvatar name={workspaceName} />
        <span className="truncate" title={workspaceName}>{workspaceName}</span>
      </section>
      <Tabs.Root value={dimension} onValueChange={(value) => onDimension(value as ViewTaskDimension)}
        className="min-h-64 flex-1 rounded-lg border border-border bg-surface-1 p-3">
        <Tabs.List aria-label={t("view.details")} className="flex items-center gap-1.5">
          {dimensions.map((item) => (
            <Tabs.Trigger key={item.value} value={item.value} disabled={disabled}
              className="flex-1 rounded-full px-2 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent data-[state=active]:bg-secondary data-[state=active]:text-foreground">
              {t(item.label)}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value={dimension} className="mt-3 flex flex-col gap-1 outline-none">
          {loading ? <p role="status" className="p-4 text-center text-sm text-muted-foreground">{t("common.loading")}</p>
            : failed ? <p role="alert" className="p-4 text-sm text-destructive">{t("task.loadFailed")}</p>
            : buckets.length === 0 ? <p className="p-4 text-center text-sm text-muted-foreground">
              {t(dimension === "label" ? "viewsPage.noLabelsUsed" : "filter.emptyResult")}
            </p> : buckets.map((bucket) => {
              const selected = selection?.dimension === dimension && selection.value === bucket.value
              const label = bucket.value === NONE
                ? t(dimension === "assignee" ? "filter.noAssignee" : "task.noProject") : bucket.name
              return (
                <button key={bucket.value} type="button" disabled={disabled} aria-pressed={selected}
                  aria-label={`${label} · ${bucket.count}`} title={t(selected ? "viewsPage.clearFilter" : "viewsPage.seeTasks")}
                  onClick={() => onSelection(selected ? null : { dimension, value: bucket.value })}
                  className={cn("group flex items-center gap-2 rounded-lg px-3 py-3 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected && "bg-accent", selection && !selected && "text-muted-foreground")}>
                  {dimension === "assignee" ? (bucket.value === NONE ? <UserRound className="size-4 shrink-0" />
                    : <MemberAvatar name={label} color={bucket.color} />)
                    : dimension === "label" ? <LabelDot color={bucket.color ?? "#808080"} />
                      : <Box className="size-4 shrink-0" />}
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  <span className="hidden shrink-0 text-xs group-hover:inline group-focus-visible:inline">
                    {t(selected ? "viewsPage.clearFilter" : "viewsPage.seeTasks")}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{bucket.count}</span>
                </button>
              )
            })}
        </Tabs.Content>
      </Tabs.Root>
    </aside>
  )
}
