// Display options 按钮（页头第二个圆形滑杆按钮）+ popover 面板（P2.md §3 + B 切片修订注）：
// Grouping / Sub-grouping / Ordering / Timeframe / Show closed projects +
// List options（Show empty groups 开关 / Display properties 列 chip）+
// 底部 Reset（回全局默认 DEFAULT_DISPLAY，蓝点熄灭态）。
// 纯前端内存状态（总决策 2）：面板操作只写页面 state，不发请求、不进 URL；
// 展示样式行本切片仅 List（Board/Timeline 后置，用户定案 1）。
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import { ArrowDown, ArrowUp, List, SlidersHorizontal } from "lucide-react"
import {
  COLUMNS,
  DEFAULT_DISPLAY,
  GROUP_FIELDS,
  ORDER_FIELDS,
  TIMEFRAMES,
  groupFieldLabelKey,
  isSameDisplay,
  needsTimeframe,
  orderFieldColumn,
  orderFieldLabelKey,
  timeframeLabelKey,
  type GroupField,
  type OrderField,
  type ProjectDisplayState,
  type Timeframe,
} from "@/lib/display-state"
import { cn } from "@/lib/utils"
import { usePopover } from "@/components/ui/popover"
import { RoundIconButton } from "@/components/ui/round-icon-button"
import { ResetRow, Row, Switch, ValuePicker } from "@/components/display/panel-parts"

/** 面板定宽 320（Linear 同位观感）；按钮在页头右缘，恒右对齐 trigger 右缘向左展开 */
const PANEL_W = 320

interface DisplayButtonProps {
  state: ProjectDisplayState
  onChange: (next: ProjectDisplayState) => void
  /** Reset 目标（P2.md §1.9 三档）：预设 tab = DEFAULT_DISPLAY（缺席默认）；
   *  view tab = 该 view 的 config.display；编辑期 = 进入编辑时基线 */
  resetTarget?: ProjectDisplayState
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/** 页头 display 按钮：Linear 圆形风格，非默认态亮蓝点（同 filter 按钮约定） */
export function DisplayButton({
  state,
  onChange,
  resetTarget,
  open: controlledOpen,
  onOpenChange,
}: DisplayButtonProps) {
  const { t } = useTranslation()
  const { open, setOpen, ref, panelRef } = usePopover({ open: controlledOpen, onOpenChange })
  const resetBase = resetTarget ?? DEFAULT_DISPLAY
  const isModified = !isSameDisplay(state, resetBase)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [style, setStyle] = useState<CSSProperties | null>(null)
  useLayoutEffect(() => {
    if (!open) return
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    setStyle({ top: rect.bottom + 4, right: window.innerWidth - rect.right, width: PANEL_W })
  }, [open])

  const set = (patch: Partial<ProjectDisplayState>) => onChange({ ...state, ...patch })
  // 一级回 No grouping = 二级直接清除（用户定案 3）；一级切新值与二级撞车时二级归位 none
  const setGrouping = (f: GroupField) =>
    f === "none"
      ? set({ grouping: "none", subGrouping: "none" })
      : set({ grouping: f, subGrouping: state.subGrouping === f ? "none" : state.subGrouping })
  // Ordering → Display properties 联动（用户定案 6）：排序属性自动勾选对应列；切字段方向复位 asc
  const setOrderField = (f: OrderField) => {
    const col = orderFieldColumn(f)
    set({
      orderField: f,
      orderDir: "asc",
      ...(col && !state.visible[col] ? { visible: { ...state.visible, [col]: true } } : {}),
    })
  }

  return (
    <div ref={ref}>
      <RoundIconButton
        ref={triggerRef}
        label={t("display.button")}
        active={isModified}
        onClick={() => setOpen(!open)}
      >
        <SlidersHorizontal className="size-4" />
      </RoundIconButton>
      {open &&
        style &&
        createPortal(
          <div
            ref={panelRef}
            style={style}
            className="fixed z-[60] rounded-lg border border-border bg-popover py-2 shadow-lg"
          >
            {/* 展示样式行：本切片仅 List 一档（选中态药丸） */}
            <div className="px-3 pb-2 pt-1">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-4 py-1.5 text-xs font-medium text-foreground">
                <List className="size-3.5" />
                {t("display.list")}
              </span>
            </div>

            <Row label={t("display.grouping")}>
              <ValuePicker
                ariaLabel={t("display.grouping")}
                value={state.grouping}
                options={GROUP_FIELDS.map((f) => ({ value: f, label: t(groupFieldLabelKey(f)) }))}
                onChange={(v) => setGrouping(v as GroupField)}
              />
            </Row>
            {/* Sub-grouping 行仅一级 ≠ none 时展示（用户定案 3）；选项排除一级已选属性 */}
            {state.grouping !== "none" && (
              <Row label={t("display.subGrouping")}>
                <ValuePicker
                  ariaLabel={t("display.subGrouping")}
                  value={state.subGrouping}
                  options={GROUP_FIELDS.filter((f) => f !== state.grouping).map((f) => ({
                    value: f,
                    label: t(groupFieldLabelKey(f)),
                  }))}
                  onChange={(v) => set({ subGrouping: v as GroupField })}
                />
              </Row>
            )}
            <Row label={t("display.ordering")}>
              {/* Manual = 基底序无方向概念，方向按钮不展示（Linear 同位） */}
              {state.orderField !== "manual" && (
                <button
                  type="button"
                  title={state.orderDir === "asc" ? t("display.orderAsc") : t("display.orderDesc")}
                  aria-label={state.orderDir === "asc" ? t("display.orderAsc") : t("display.orderDesc")}
                  onClick={() => set({ orderDir: state.orderDir === "asc" ? "desc" : "asc" })}
                  className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  {state.orderDir === "asc" ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />}
                </button>
              )}
              <ValuePicker
                ariaLabel={t("display.ordering")}
                value={state.orderField}
                options={ORDER_FIELDS.map((f) => ({ value: f, label: t(orderFieldLabelKey(f)) }))}
                onChange={(v) => setOrderField(v as OrderField)}
              />
            </Row>
            {/* Timeframe 行：一级或二级任一按日期分组才展示（用户定案 7） */}
            {needsTimeframe(state) && (
              <Row label={t("display.timeframeRow")}>
                <ValuePicker
                  ariaLabel={t("display.timeframeRow")}
                  value={state.timeframe}
                  options={TIMEFRAMES.map((tf) => ({ value: tf, label: t(timeframeLabelKey(tf)) }))}
                  onChange={(v) => set({ timeframe: v as Timeframe })}
                />
              </Row>
            )}

            <div className="my-2 border-t border-border" />
            <Row label={t("display.showClosed")}>
              <ValuePicker
                ariaLabel={t("display.showClosed")}
                value={state.showClosed}
                options={[
                  { value: "none", label: t("display.closedNone") },
                  { value: "all", label: t("display.closedAll") },
                ]}
                onChange={(v) => set({ showClosed: v as "none" | "all" })}
              />
            </Row>

            <div className="my-2 border-t border-border" />
            <div className="px-3 pb-1 text-xs font-medium text-foreground">{t("display.listOptions")}</div>
            <Row label={t("display.showEmptyGroups")}>
              <Switch
                on={state.showEmptyGroups}
                label={t("display.showEmptyGroups")}
                onToggle={() => set({ showEmptyGroups: !state.showEmptyGroups })}
              />
            </Row>
            <div className="px-3 pb-1.5 pt-2 text-xs text-muted-foreground">
              {t("display.displayProperties")}
            </div>
            <div className="flex flex-wrap gap-1.5 px-3 pb-2">
              {COLUMNS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => set({ visible: { ...state.visible, [c.key]: !state.visible[c.key] } })}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs transition-colors",
                    state.visible[c.key]
                      ? "bg-secondary font-medium text-foreground"
                      : "bg-secondary/40 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t(c.labelKey)}
                </button>
              ))}
            </div>

            {/* 面板底部 Reset：仅非 resetTarget 态渲染（三档目标由页面侧传入，P2.md §1.9；两侧面板统一） */}
            {isModified && <ResetRow onReset={() => onChange(resetBase)} />}
          </div>,
          document.body,
        )}
    </div>
  )
}
