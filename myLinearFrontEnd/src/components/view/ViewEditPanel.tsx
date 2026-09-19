// 行内视图编辑 panel（P2.md §1.9 形态 / §6 V2 item 3）：name 行（层叠图标 + name 输入 + 右靠
// Cancel/Save）+ Description 行 + chip 行（draft 条件 chips + 行尾右靠 filter/display 双按钮）。
// 新建模式（V2）：draft 初值 filters 空 + display 继承当前页面；Save = Create view。
// 编辑模式（V3 接线）：draft = view.config 深拷贝；Save = 元数据 + config PATCH。
// 编辑期是隔离沙箱：本 panel 的 filter/display 按钮与页头顶部按钮操作同一 draft（页面侧接线），
// chip 只落本 panel 一处（顶部 chip 行编辑期隐藏），预览口径 = 仅 draft 条件（§1.9）。
import { useTranslation } from "react-i18next"
import { Layers, Trash2 } from "lucide-react"
import { Separator } from "radix-ui"
import type { FilterCond, Surface } from "@/lib/filter-state"
import type { ProjectDisplayState } from "@/lib/display-state"
import { Button, PendingLabel } from "@/components/ui/button"
import { FilterButton, type FilterMenuControl } from "@/components/filter/filter-menu"
import { FilterChip } from "@/components/filter/filter-chips"
import { DisplayButton } from "@/components/display/display-menu"

interface ViewEditPanelProps {
  mode: "new" | "edit"
  name: string
  description: string
  workspaceId: string
  surface: Surface
  /** draft 条件列表（沙箱预览口径 = 仅 draft） */
  filters: FilterCond[]
  /** draft display（新建继承当前页面 / Edit = config.display） */
  display: ProjectDisplayState
  /** 编辑期 Reset 基线（新建 = DEFAULT_DISPLAY / Edit = config.display，§1.9 Reset 三档） */
  resetTarget: ProjectDisplayState
  saving?: boolean
  filterControl?: FilterMenuControl
  displayControl?: FilterMenuControl
  onReset?: () => void
  onDelete?: () => void
  onNameChange: (v: string) => void
  onDescriptionChange: (v: string) => void
  onFiltersChange: (next: FilterCond[]) => void
  onDisplayChange: (next: ProjectDisplayState) => void
  onSave: () => void
  onCancel: () => void
}

export function ViewEditPanel({
  mode,
  name,
  description,
  workspaceId,
  surface,
  filters,
  display,
  resetTarget,
  saving,
  filterControl,
  displayControl,
  onReset,
  onDelete,
  onNameChange,
  onDescriptionChange,
  onFiltersChange,
  onDisplayChange,
  onSave,
  onCancel,
}: ViewEditPanelProps) {
  const { t } = useTranslation()
  // name trim 非空方可提交（后端同规则，api.md §10）；saving 期禁二次点击
  const canSave = name.trim().length > 0 && !saving
  const saveLabel = mode === "new" ? t("view.createView") : t("common.save")
  const pendingLabel = mode === "new" ? t("common.creating") : t("common.saving")

  return (
    <fieldset disabled={saving} aria-label={mode === "new" ? t("view.newView") : t("view.edit")} className="mx-6 mb-2 min-w-0 rounded-md border border-border bg-surface-1">
      {/* name 行：层叠图标 + 透明输入 + 右靠 Cancel / Save（新建 = Create view） */}
      <div className="flex items-center gap-2 px-3 pt-3">
        <Layers className="size-4 shrink-0 text-muted-foreground" />
        <input
          autoFocus
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && canSave && onSave()}
          placeholder={t("view.namePlaceholder")}
          aria-label={t("view.namePlaceholder")}
          className="min-w-0 flex-1 bg-transparent text-sm font-medium text-foreground outline-none placeholder:text-muted-foreground"
        />
        <div className="flex shrink-0 items-center gap-2">
          {onDelete && (
            <Button variant="ghost" size="icon" onClick={onDelete} aria-label={t("view.delete")} title={t("view.delete")}>
              <Trash2 />
            </Button>
          )}
          {onReset && <Button variant="ghost" size="sm" onClick={onReset}>{t("display.reset")}</Button>}
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" size="sm" onClick={onSave} disabled={!canSave}>
            <PendingLabel pending={!!saving} label={saveLabel} pendingLabel={pendingLabel} />
          </Button>
        </div>
      </div>

      {/* Description 行（可选，透明单行输入） */}
      <div className="px-3 pt-2">
        <input
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder={t("view.descriptionPlaceholder")}
          aria-label={t("view.descriptionPlaceholder")}
          className="w-full bg-transparent text-xs text-muted-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>

      <Separator.Root decorative className="mx-3 mt-3 h-px bg-border" />

      {/* chip 行：draft 条件 chips（左，可换行）+ 行尾右靠 filter/display 双按钮（添加入口即 filter 按钮） */}
      <div className="flex items-center gap-3 px-3 py-3">
        <div className="flex flex-1 flex-wrap items-center gap-1.5">
          {filters.map((c, i) => (
            <FilterChip
              key={`${c.field}.${c.op}.${i}`}
              workspaceId={workspaceId}
              surface={surface}
              cond={c}
              index={i}
              conds={filters}
              onChange={onFiltersChange}
            />
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <FilterButton
            {...filterControl}
            showIndicator={false}
            workspaceId={workspaceId}
            surface={surface}
            conds={filters}
            onChange={onFiltersChange}
          />
          <DisplayButton {...displayControl} state={display} onChange={onDisplayChange} resetTarget={resetTarget} />
        </div>
      </div>
    </fieldset>
  )
}
