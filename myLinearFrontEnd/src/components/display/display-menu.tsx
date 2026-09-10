// Display options 按钮（页头第二个圆形滑杆按钮）+ popover 面板（P2.md §3 + B 切片修订注）：
// Grouping / Sub-grouping / Ordering / Timeframe / Show closed projects +
// List options（Show empty groups 开关 / Display properties 列 chip）+
// 底部 Reset（回全局默认 DEFAULT_DISPLAY，蓝点熄灭态）。
// 纯前端内存状态（总决策 2）：面板操作只写页面 state，不发请求、不进 URL；
// 展示样式行本切片仅 List（Board/Timeline 后置，用户定案 1）。
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import { ArrowDown, ArrowUp, Check, ChevronDown, List, SlidersHorizontal } from "lucide-react"
import {
  COLUMNS,
  DEFAULT_DISPLAY,
  GROUP_FIELDS,
  ORDER_FIELDS,
  TIMEFRAMES,
  groupFieldLabelKey,
  isDefaultDisplay,
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
import { useFixedPanelStyle } from "@/components/ui/select"
import { RoundIconButton } from "@/components/ui/round-icon-button"

/** 面板定宽 320（Linear 同位观感）；按钮在页头右缘，恒右对齐 trigger 右缘向左展开 */
const PANEL_W = 320

interface DisplayButtonProps {
  state: ProjectDisplayState
  onChange: (next: ProjectDisplayState) => void
}

/** 页头 display 按钮：Linear 圆形风格，非默认态亮蓝点（同 filter 按钮约定） */
export function DisplayButton({ state, onChange }: DisplayButtonProps) {
  const { t } = useTranslation()
  const { open, setOpen, ref, panelRef } = usePopover()
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
        active={!isDefaultDisplay(state)}
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

            {/* 面板底部 Reset：回到全局默认（蓝点熄灭态，用户定案）；无边框纯文字按钮（2026-09 修订） */}
            <div className="mt-1 flex justify-center border-t border-border px-3 pb-1 pt-2">
              <button
                type="button"
                onClick={() => onChange(DEFAULT_DISPLAY)}
                className="rounded-md px-6 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
              >
                {t("display.reset")}
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}

/** 面板行：左标签右控件（Linear 同位布局） */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  )
}

/** 值药丸单选下拉（点击即选即关）：trigger 为 Linear 值药丸形态，飞出清单复用 fixed+portal 定位 */
function ValuePicker({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
  ariaLabel: string
}) {
  const { open, setOpen, ref, panelRef } = usePopover()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelStyle = useFixedPanelStyle(open, triggerRef)
  const current = options.find((o) => o.value === value)
  return (
    <div ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        onClick={() => setOpen(!open)}
        className="inline-flex h-7 max-w-40 items-center gap-1 rounded-md bg-secondary px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
      >
        <span className="truncate">{current?.label}</span>
        <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
      </button>
      {open &&
        panelStyle &&
        createPortal(
          // z-[70]：面板本体 z-[60]，内嵌下拉须更高一层。
          // 本 portal 挂在 body 下、不在外层面板 panelRef 内，mousedown 须阻断冒泡，
          // 否则外层 usePopover 的 document 监听会把“点内层选项”误判为外部点击而关掉整个面板
          <div
            ref={panelRef}
            style={panelStyle}
            onMouseDown={(e) => e.stopPropagation()}
            className="fixed z-[70] max-h-60 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-lg"
          >
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-accent"
                onClick={() => {
                  onChange(o.value)
                  setOpen(false)
                }}
              >
                <span className="flex-1 truncate">{o.label}</span>
                {o.value === value && <Check className="size-3.5 shrink-0" />}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}

/** 迷你开关（Show empty groups）：Linear 同位小滑钮形态 */
function Switch({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      onClick={onToggle}
      className={cn(
        "relative h-4 w-7 shrink-0 rounded-full transition-colors",
        on ? "bg-primary" : "bg-secondary",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 size-3 rounded-full bg-white transition-all",
          on ? "left-3.5" : "left-0.5",
        )}
      />
    </button>
  )
}
