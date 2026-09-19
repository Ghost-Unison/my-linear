// 页面级 view tab 行（P2.md §4.4）：预设 tab + 该页 surface 的 view tab（固定层叠图标 + name）
// + "+" 按钮（打开行内新建 panel）。编辑期 tab 行出现临时 view tab（虚线框 + 铅笔图标），
// Save 成功转正 / Cancel 消失。偏离点：currentState ≠ view.config 时 view tab 显示偏离点。
// 本组件只渲染 tab 行内容（置于 PageHeader 的 tabs 槽），不持有状态——激活/编辑/偏离由页面侧驱动。
import { useEffect, useId, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Eye, Layers, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react"
import { HoverCard } from "radix-ui"
import type { View } from "@/api/types"
import { cn } from "@/lib/utils"
import { decodeProjectConfig } from "@/lib/view-state"
import { findSpec, opLabelKey, type FieldSpec, type FilterCond } from "@/lib/filter-state"
import { useValueLabel } from "@/components/filter/filter-options"
import { tabPill } from "@/components/layout/PageHeader"
import { Button, buttonVariants } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

/** 编辑会话描述（页面侧持有）：mode=new 时 viewId 缺席，name 为 draft 名（空 = 占位文案） */
export interface ViewEditing {
  mode: "new" | "edit"
  viewId?: string
  name: string
}

interface ViewTabsProps {
  workspaceId: string
  /** 预设 tab 文案（projects_page = "All projects"） */
  presetLabel: string
  views: View[]
  /** 当前激活 view id；null = 预设 tab 激活 */
  activeViewId: string | null
  /** 编辑会话；null = 非编辑期 */
  editing: ViewEditing | null
  /** 存在偏离（currentState ≠ view.config）的 view id 集合 → 偏离点 */
  deviatedViewIds: ReadonlySet<string>
  onSelectPreset: () => void
  onSelectView: (id: string) => void
  onNewView: () => void
  onEditView: (id: string) => void
  onDeleteView: (id: string) => void
  /** 仅禁用写入动作，不影响 tab 导航和只读详情。 */
  busy?: boolean
}

export function ViewTabs({
  workspaceId,
  presetLabel,
  views,
  activeViewId,
  editing,
  deviatedViewIds,
  onSelectPreset,
  onSelectView,
  onNewView,
  onEditView,
  onDeleteView,
  busy = false,
}: ViewTabsProps) {
  const { t } = useTranslation()
  const presetRef = useRef<HTMLButtonElement>(null)
  const [details, setDetails] = useState<{
    view: View
    returnFocus: HTMLButtonElement | null
  } | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const showDetails = (view: View, returnFocus: HTMLButtonElement | null) => {
    setDetails({ view, returnFocus })
    setDetailsOpen(true)
  }
  const closeDetails = () => {
    setDetailsOpen(false)
    // 保留已保存摘要供退出动画使用；原触发器移除时回到预设 tab。
    requestAnimationFrame(() => {
      const target = details?.returnFocus
      const focusTarget = target?.isConnected ? target : presetRef.current
      focusTarget?.focus({ preventScroll: true })
    })
  }
  // 预设 tab 激活 = 无 view 激活且非编辑期（编辑期焦点在临时 tab）
  const presetActive = activeViewId === null && editing === null

  return (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-0.5">
        <button
          ref={presetRef}
          type="button"
          onClick={onSelectPreset}
          aria-current={presetActive ? "page" : undefined}
          className={cn(tabPill(presetActive), "shrink-0 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50")}
        >
          {presetLabel}
        </button>

        {views.map((v) => {
          // 编辑已有 view：该 view 的 tab 转为临时态（虚线 + 铅笔 + draft 名）
          const isEditingThis = editing?.mode === "edit" && editing.viewId === v.id
          if (isEditingThis) {
            return (
              <TempViewTab
                key={v.id}
                name={editing!.name.trim() || v.name}
              />
            )
          }
          const active = activeViewId === v.id && editing === null
          return (
            <SavedViewTab
              key={v.id}
              workspaceId={workspaceId}
              view={v}
              active={active}
              deviated={deviatedViewIds.has(v.id)}
              busy={busy}
              detailsOpen={detailsOpen}
              onSelectView={onSelectView}
              onEditView={onEditView}
              onDeleteView={onDeleteView}
              onDetails={showDetails}
            />
          )
        })}

        {/* 新建编辑期：临时 tab 追加在末尾（draft 名或占位文案） */}
        {editing?.mode === "new" && (
          <TempViewTab name={editing.name.trim() || t("view.newViewPlaceholder")} />
        )}

        {/* "+" 新建按钮：编辑期隐藏（已处于编辑会话） */}
        {editing === null && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onNewView}
            disabled={busy}
            title={t("view.newView")}
            aria-label={t("view.newView")}
            className="shrink-0 rounded-full"
          >
            <Plus />
          </Button>
        )}
      </div>

      <Dialog open={detailsOpen} onClose={closeDetails} className="max-w-lg">
        {details && (
          <ViewDetailsContent
            workspaceId={workspaceId}
            view={details.view}
            open={detailsOpen}
            onClose={closeDetails}
          />
        )}
      </Dialog>
    </>
  )
}

/** 已保存 tab：导航、悬浮摘要和动作菜单互不触发。 */
function SavedViewTab({
  workspaceId, view, active, deviated, busy, detailsOpen,
  onSelectView, onEditView, onDeleteView, onDetails,
}: Pick<ViewTabsProps, "workspaceId" | "onSelectView" | "onEditView" | "onDeleteView" | "busy"> & {
  view: View
  active: boolean
  deviated: boolean
  detailsOpen: boolean
  onDetails: (view: View, trigger: HTMLButtonElement | null) => void
}) {
  const { t } = useTranslation()
  const [hoverOpen, setHoverOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const skipMenuFocus = useRef(false)
  const openMenu = () => {
    setHoverOpen(false)
    setMenuOpen(true)
  }

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <HoverCard.Root
        openDelay={350}
        closeDelay={150}
        open={hoverOpen && !menuOpen && !detailsOpen}
        onOpenChange={(open) => setHoverOpen(open && !menuOpen && !detailsOpen)}
      >
        <HoverCard.Trigger asChild>
          <button
            type="button"
            onClick={() => {
              setHoverOpen(false)
              onSelectView(view.id)
            }}
            onContextMenu={(event) => {
              event.preventDefault()
              openMenu()
            }}
            onKeyDown={(event) => {
              if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                event.preventDefault()
                openMenu()
              }
            }}
            aria-current={active ? "page" : undefined}
            className={cn(tabPill(active), "flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50")}
          >
            <Layers className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />
            <span className="max-w-40 truncate">{view.name}</span>
            {deviated && (
              <span
                className="size-1.5 shrink-0 rounded-full bg-primary"
                title={t("view.deviated")}
                role="img"
                aria-label={t("view.deviated")}
              />
            )}
          </button>
        </HoverCard.Trigger>
        <HoverCard.Portal>
          <HoverCard.Content
            align="start"
            sideOffset={8}
            className="z-50 max-h-(--radix-hover-card-content-available-height) w-96 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
          >
            {/* 不强制挂载：只有卡片实际显示后才启用字段回显查询。 */}
            <SavedViewSummary workspaceId={workspaceId} view={view} />
          </HoverCard.Content>
        </HoverCard.Portal>
      </HoverCard.Root>

      <DropdownMenu
        open={menuOpen}
        onOpenChange={(open) => {
          setMenuOpen(open)
          if (open) setHoverOpen(false)
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            ref={menuButtonRef}
            type="button"
            title={t("view.actions", { name: view.name })}
            aria-label={t("view.actions", { name: view.name })}
            className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "shrink-0 rounded-full")}
          >
            <MoreHorizontal aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          onCloseAutoFocus={(event) => {
            if (skipMenuFocus.current) {
              event.preventDefault()
              skipMenuFocus.current = false
            }
          }}
        >
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={() => {
              skipMenuFocus.current = true
              onDetails(view, menuButtonRef.current)
            }}>
              <Eye aria-hidden="true" />
              {t("view.details")}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={busy} onSelect={() => onEditView(view.id)}>
              <Pencil aria-hidden="true" />
              {t("view.edit")}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" disabled={busy} onSelect={() => onDeleteView(view.id)}>
              <Trash2 aria-hidden="true" />
              {t("view.delete")}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/** 悬浮与详情共用服务端保存的摘要，不读取页面当前筛选或编辑草稿。 */
function SavedViewSummary({ workspaceId, view }: { workspaceId: string; view: View }) {
  const { t } = useTranslation()
  const surface = view.surface === "views_page"
    ? view.entityType === "project" ? "projects_page" : "tasks_page"
    : view.surface
  const filters = decodeProjectConfig(view.config).filters.flatMap((cond) => {
    const spec = findSpec(surface, cond.field)
    return spec ? [{ cond, spec }] : []
  })

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <h3 className="whitespace-pre-wrap text-sm font-semibold [overflow-wrap:anywhere]">{view.name}</h3>
      {view.description && (
        <p className="whitespace-pre-wrap text-sm text-muted-foreground [overflow-wrap:anywhere]">
          {view.description}
        </p>
      )}
      <div className="flex min-w-0 flex-col gap-2">
        <h4 className="text-xs font-medium text-muted-foreground">{t("view.savedFilters")}</h4>
        {filters.length ? (
          <ul className="flex min-w-0 flex-wrap gap-1.5">
            {filters.map(({ cond, spec }, index) => (
              <SavedFilterChip key={`${cond.field}-${index}`} workspaceId={workspaceId} cond={cond} spec={spec} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t("view.noFilters")}</p>
        )}
      </div>
    </div>
  )
}

/** 每个字段独立调用回显 hook；所有值完整展示，且无编辑、删除等交互。 */
function SavedFilterChip({ workspaceId, cond, spec }: {
  workspaceId: string
  cond: FilterCond
  spec: FieldSpec
}) {
  const { t } = useTranslation()
  const valueLabel = useValueLabel(workspaceId, spec)
  return (
    <li className="flex max-w-full flex-wrap items-baseline gap-x-1 rounded-md border border-border px-2 py-1 text-xs [overflow-wrap:anywhere]">
      <span className="text-muted-foreground">{t(spec.labelKey)}</span>
      <span className="text-muted-foreground">{t(opLabelKey(spec, cond.op, cond.values.length))}</span>
      <span className="min-w-0 whitespace-pre-wrap">{cond.values.map(valueLabel).join(", ")}</span>
    </li>
  )
}

/** 现有轻量 Dialog 的标题关联、初始焦点和键盘焦点约束在此补齐。 */
function ViewDetailsContent({ workspaceId, view, open, onClose }: {
  workspaceId: string
  view: View
  open: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()
  const titleId = useId()
  const contentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const content = contentRef.current
    const dialog = content?.closest('[role="dialog"]')
    dialog?.setAttribute("aria-labelledby", titleId)
    const focusContent = () => content?.querySelector<HTMLElement>('[tabindex="0"], button')?.focus({ preventScroll: true })
    const frame = requestAnimationFrame(focusContent)
    const keepFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !content?.contains(event.target)) focusContent()
    }
    document.addEventListener("focusin", keepFocus)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener("focusin", keepFocus)
    }
  }, [open, titleId])

  return (
    <div
      ref={contentRef}
      className="flex min-w-0 flex-col gap-4"
      onKeyDown={(event) => {
        if (open && event.key === "Tab") {
          event.preventDefault()
          const targets = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[tabindex="0"], button'))
          const index = targets.findIndex((target) => target === document.activeElement)
          const next = (index + (event.shiftKey ? -1 : 1) + targets.length) % targets.length
          targets[next]?.focus({ preventScroll: true })
        }
      }}
    >
      <h2 id={titleId} className="text-base font-semibold">{t("view.details")}</h2>
      <div
        tabIndex={0}
        role="region"
        aria-label={t("view.details")}
        className="max-h-[60vh] overflow-y-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <SavedViewSummary workspaceId={workspaceId} view={view} />
      </div>
      <div className="flex justify-end">
        <Button variant="secondary" onClick={onClose}>{t("common.close")}</Button>
      </div>
    </div>
  )
}

/** 临时 view tab（编辑期）：虚线框 + 铅笔图标 + draft 名（P2.md §4.4） */
function TempViewTab({ name }: { name: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-dashed border-border px-3 py-1 text-sm text-foreground">
      <Pencil className="size-3.5 shrink-0 opacity-70" />
      <span className="max-w-40 truncate">{name}</span>
    </span>
  )
}
