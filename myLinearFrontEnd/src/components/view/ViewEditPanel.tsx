// 行内视图编辑 panel（P2.md §1.9 形态 / §6 V2 item 3）：name 行（层叠图标 + name 输入 + 右靠
// Cancel/Save）+ Description 行 + chip 行（draft 条件 chips + 行尾右靠 filter/display 双按钮）。
// 新建模式（V2）：普通 "+" 的 filters 为空，Save → new 带生效条件；display 继承点击前生效状态（含 draft）；Save = Create view。
// 编辑模式：优先恢复该 View 暂存草稿，无草稿时深拷贝保存配置；Save 提交元数据 + config。
// 新建/编辑期是隔离沙箱：页头 Filter/Display 隐藏，仅本 panel 内的按钮操作 draft。
// chip 只落本 panel 一处（浏览临时条隐藏），预览口径 = 仅 draft 条件（§1.9）。
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Layers, Trash2 } from "lucide-react"
import { Separator } from "radix-ui"
import type { FilterCond, Surface } from "@/lib/filter-state"
import { Button, PendingLabel } from "@/components/ui/button"
import { FilterButton, type FilterMenuControl } from "@/components/filter/filter-menu"
import { FilterChip } from "@/components/filter/filter-chips"

interface ViewEditPanelProps {
  mode: "new" | "edit"
  name: string
  description: string
  workspaceId: string
  surface: Surface
  /** draft 条件列表（沙箱预览口径 = 仅 draft） */
  filters: FilterCond[]
  /** 页面注入对应 Display 按钮：操作草稿，Reset 基准为保存值；新建没有基准。 */
  displayButton: ReactNode
  saving?: boolean
  filterControl?: FilterMenuControl
  onReset?: () => void
  onDelete?: () => void
  onNameChange: (v: string) => void
  onDescriptionChange: (v: string) => void
  onFiltersChange: (next: FilterCond[]) => void
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
  displayButton,
  saving,
  filterControl,
  onReset,
  onDelete,
  onNameChange,
  onDescriptionChange,
  onFiltersChange,
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
          {displayButton}
        </div>
      </div>
    </fieldset>
  )
}
