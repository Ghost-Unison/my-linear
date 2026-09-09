// 条件 chip 行（tab 行与表头之间，P2.md §2.1）：每条条件一枚 chip，三段可点——
// 字段段静态 / 操作符段弹该字段随值个数联动的操作符清单切换 / 值段重开勾选清单编辑
//（日期字段为阶梯单选清单）；× 删除。行尾 "+" 与页头 filter 按钮共用同一纯添加
// 级联菜单（DropdownMenu 飞出式），Clear 全清；Save 预留（视图持久化切片 C 接通前禁用）。
import { useState } from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import { Check, Plus, X } from "lucide-react"
import {
  NONE,
  OVERDUE,
  defaultOpOf,
  findSpec,
  menuOps,
  normalizeOp,
  opLabelKey,
  toggleValues,
  type FilterCond,
  type Surface,
} from "@/lib/filter-state"
import { cn } from "@/lib/utils"
import { usePopover } from "@/components/ui/popover"
import { useFixedPanelStyle } from "@/components/ui/select"
import { FilterDropdown } from "./filter-menu"
import { LadderEditList, OPTION, PANEL, ValueCheckList, useValueLabel } from "./filter-options"

interface ChipRowProps {
  workspaceId: string
  surface: Surface
  conds: FilterCond[]
  onChange: (next: FilterCond[]) => void
  /** 已处于 px-6 内容区（项目详情 Issues tab）时去掉 mx-6，避免双重内边距 */
  bare?: boolean
}

export function FilterChipRow({ workspaceId, surface, conds, onChange, bare }: ChipRowProps) {
  const { t } = useTranslation()
  return (
    // 灰底面板区分页头按钮区与下方列表区（Linear 实测）；chips 左侧换行、Clear/Save 右侧
    <div className={cn("mb-2 flex items-center gap-3 rounded-md bg-surface-1 px-3 py-2", !bare && "mx-6")}>
      <div className="flex flex-1 flex-wrap items-center gap-1.5">
        {conds.map((c, i) => (
          <FilterChip
            key={`${c.field}.${c.op}.${i}`}
            workspaceId={workspaceId}
            surface={surface}
            cond={c}
            index={i}
            conds={conds}
            onChange={onChange}
          />
        ))}
        <FilterDropdown
          workspaceId={workspaceId}
          surface={surface}
          conds={conds}
          onChange={onChange}
          trigger={
            <button
              type="button"
              title={t("filter.addFilter")}
              aria-label={t("filter.addFilter")}
              className="inline-flex size-6 items-center justify-center rounded border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Plus className="size-3.5" />
            </button>
          }
        />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => onChange([])}
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("filter.clear")}
        </button>
        {/* Save 预留：视图持久化切片（C）接通前禁用 */}
        <button
          type="button"
          disabled
          title={t("common.save")}
          className="cursor-not-allowed rounded border border-border px-2.5 py-1 text-xs text-muted-foreground opacity-60"
        >
          {t("common.save")}
        </button>
      </div>
    </div>
  )
}

function FilterChip({
  workspaceId,
  surface,
  cond,
  index,
  conds,
  onChange,
}: ChipRowProps & { cond: FilterCond; index: number }) {
  const { t } = useTranslation()
  // parseConds 白名单保证命中（findSpec 恒有值），用 ! 断言省去早退；值段回显按字段来源启用查询
  const spec = findSpec(surface, cond.field)!
  const valueLabel = useValueLabel(workspaceId, spec)
  const { open, setOpen, ref, panelRef } = usePopover()
  // 单浮层双内容：操作符清单 / 值编辑清单，mode 兼做锚点重算依赖
  const [mode, setMode] = useState<"op" | "values" | null>(null)
  const panelStyle = useFixedPanelStyle(open, ref, mode)
  const openWith = (m: "op" | "values") => {
    if (open && mode === m) {
      setOpen(false)
      return
    }
    setMode(m)
    setOpen(true)
  }
  const replace = (next: FilterCond) =>
    onChange(conds.map((c, i) => (i === index ? next : c)))
  const toggleValue = (v: string) => {
    const next = toggleValues(spec, cond.values, v)
    if (next.length === 0) onChange(conds.filter((_, i) => i !== index))
    else replace({ ...cond, op: normalizeOp(spec, cond.op, next), values: next })
  }
  // 日期值编辑：阶梯单选替换；none/overdue 哨兵行切 is 操作符，阶梯行离开 is/isNot 回方向默认操作符
  const pickDate = (v: string) => {
    const op =
      v === NONE || v === OVERDUE
        ? "is"
        : cond.op === "is" || cond.op === "isNot"
          ? defaultOpOf(spec)
          : cond.op
    replace({ ...cond, op, values: [v] })
  }
  const SEG = "px-2 py-1 transition-colors hover:bg-accent"
  return (
    <div ref={ref} className="flex items-stretch overflow-hidden rounded border border-border bg-surface-2 text-xs">
      <span className="px-2 py-1 text-muted-foreground">{t(spec.labelKey)}</span>
      <button type="button" className={cn(SEG, "border-l border-border")} onClick={() => openWith("op")}>
        {t(opLabelKey(spec, cond.op, cond.values.length))}
      </button>
      <button
        type="button"
        className={cn(SEG, "max-w-56 truncate border-l border-border")}
        onClick={() => openWith("values")}
      >
        {cond.values.map((v) => valueLabel(v)).join(", ")}
      </button>
      <button
        type="button"
        aria-label={t("filter.removeCond")}
        title={t("filter.removeCond")}
        className={cn(SEG, "border-l border-border text-muted-foreground hover:text-foreground")}
        onClick={() => onChange(conds.filter((_, i) => i !== index))}
      >
        <X className="size-3" />
      </button>
      {open &&
        panelStyle &&
        createPortal(
          <div ref={panelRef} className={PANEL} style={panelStyle}>
            {mode === "op" ? (
              <div>
                {menuOps(spec, cond.values).map((op) => (
                  <button
                    key={op}
                    type="button"
                    className={OPTION}
                    onClick={() => {
                      replace({ ...cond, op })
                      setOpen(false)
                    }}
                  >
                    <span className="flex-1 truncate text-left">
                      {t(opLabelKey(spec, op, cond.values.length))}
                    </span>
                    {op === cond.op && <Check className="size-3.5 shrink-0" />}
                  </button>
                ))}
              </div>
            ) : spec.kind === "day" || spec.kind === "moment" ? (
              <LadderEditList spec={spec} selected={cond.values} onPick={pickDate} />
            ) : (
              <ValueCheckList
                workspaceId={workspaceId}
                spec={spec}
                selected={cond.values}
                onToggle={toggleValue}
              />
            )}
          </div>,
          document.body,
        )}
    </div>
  )
}
