// 任务列表 Display options 按钮 + popover 面板（tasks_page 切片，P2.md §3 + 2026-09 任务切片修订注）：
// Grouping / Sub-grouping / Ordering / Completed tasks（仅 All tab）/ Show sub-issues +
// List options（Nested sub-issues 条件行 / Show empty groups / Display properties 列 chip）+
// 底部 Reset（仅非默认态）。样式与项目侧面板同构（共享 panel-parts 原语）。
// 纯前端内存状态（总决策 2）：面板操作只写页面 state（每 tab 一份），不发请求、不进 URL。
// 后置后续优化（本切片不渲染控件，见 P2.md 修订注）：
// - Grouping 行前的组序拖拽入口（Linear Group ordering 面板，用户图2）；
// - Order completed by recency 行（无完成时间字段，用户图4）。
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import { ArrowDown, ArrowUp, List, SlidersHorizontal } from "lucide-react"
import {
  DEFAULT_TASK_DISPLAY,
  TASK_COLUMNS,
  TASK_GROUP_FIELDS,
  TASK_ORDER_FIELDS,
  isDefaultTaskDisplay,
  taskGroupFieldLabelKey,
  taskOrderColumn,
  taskOrderFieldLabelKey,
  type TaskDisplayState,
  type TaskGroupField,
  type TaskOrderField,
} from "@/lib/task-display-state"
import { cn } from "@/lib/utils"
import { usePopover } from "@/components/ui/popover"
import { RoundIconButton } from "@/components/ui/round-icon-button"
import { ResetRow, Row, Switch, ValuePicker } from "@/components/display/panel-parts"

/** 面板定宽 320（Linear 同位观感，与项目侧面板一致）；恒右对齐 trigger 右缘向左展开 */
const PANEL_W = 320

interface TaskDisplayButtonProps {
  state: TaskDisplayState
  onChange: (next: TaskDisplayState) => void
  /** Completed tasks 行仅 All tab 展示（其余 tab 基底条件已排除 completed，用户定案 2026-09） */
  showCompletedRow: boolean
}

/** 页头 display 按钮：Linear 圆形风格，非默认态亮蓝点（同 filter 按钮约定） */
export function TaskDisplayButton({ state, onChange, showCompletedRow }: TaskDisplayButtonProps) {
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

  const set = (patch: Partial<TaskDisplayState>) => onChange({ ...state, ...patch })
  // 一级回 No grouping = 二级直接清除（用户定案 3）；一级切新值与二级撞车时二级归位 none
  const setGrouping = (f: TaskGroupField) =>
    f === "none"
      ? set({ grouping: "none", subGrouping: "none" })
      : set({ grouping: f, subGrouping: state.subGrouping === f ? "none" : state.subGrouping })
  // Ordering → Display properties 联动（用户定案 6）：排序属性自动勾选对应列；切字段方向复位 asc
  const setOrderField = (f: TaskOrderField) => {
    const col = taskOrderColumn(f)
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
        active={!isDefaultTaskDisplay(state)}
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
            {/* 展示样式行：本切片仅 List 一档（选中态药丸；Board/Timeline 后置） */}
            <div className="px-3 pb-2 pt-1">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-4 py-1.5 text-xs font-medium text-foreground">
                <List className="size-3.5" />
                {t("display.list")}
              </span>
            </div>

            <Row label={t("display.grouping")}>
              {/* 组序拖拽入口按钮（Linear 同位 ⇅）后置后续优化，本切片不渲染 */}
              <ValuePicker
                ariaLabel={t("display.grouping")}
                value={state.grouping}
                options={TASK_GROUP_FIELDS.map((f) => ({
                  value: f,
                  label: t(taskGroupFieldLabelKey(f)),
                }))}
                onChange={(v) => setGrouping(v as TaskGroupField)}
              />
            </Row>
            {/* Sub-grouping 行仅一级 ≠ none 时展示（用户定案 3）；选项排除一级已选属性 */}
            {state.grouping !== "none" && (
              <Row label={t("display.subGrouping")}>
                <ValuePicker
                  ariaLabel={t("display.subGrouping")}
                  value={state.subGrouping}
                  options={TASK_GROUP_FIELDS.filter((f) => f !== state.grouping).map((f) => ({
                    value: f,
                    label: t(taskGroupFieldLabelKey(f)),
                  }))}
                  onChange={(v) => set({ subGrouping: v as TaskGroupField })}
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
                options={TASK_ORDER_FIELDS.map((f) => ({
                  value: f,
                  label: t(taskOrderFieldLabelKey(f)),
                }))}
                onChange={(v) => setOrderField(v as TaskOrderField)}
              />
            </Row>

            <div className="my-2 border-t border-border" />
            {/* Completed tasks 行仅 All tab（用户定案 2026-09）；Done/Canceled 都算 completed */}
            {showCompletedRow && (
              <Row label={t("display.completedTasks")}>
                <ValuePicker
                  ariaLabel={t("display.completedTasks")}
                  value={state.showCompleted}
                  options={[
                    { value: "all", label: t("display.closedAll") },
                    { value: "none", label: t("display.closedNone") },
                  ]}
                  onChange={(v) => set({ showCompleted: v as "none" | "all" })}
                />
              </Row>
            )}
            <Row label={t("display.showSubIssues")}>
              <Switch
                on={state.showSubIssues}
                label={t("display.showSubIssues")}
                // 两开关独立：show sub 关时 nested 仅隐藏不重置，回开时保留原值（验证矩阵 tdp-09 修订）
                onToggle={() => set({ showSubIssues: !state.showSubIssues })}
              />
            </Row>

            <div className="my-2 border-t border-border" />
            <div className="px-3 pb-1 text-xs font-medium text-foreground">{t("display.listOptions")}</div>
            {/* Nested sub-issues 行仅 show sub-issues 开时展示（用户图9） */}
            {state.showSubIssues && (
              <Row label={t("display.nestedSubIssues")}>
                <Switch
                  on={state.nestedSubIssues}
                  label={t("display.nestedSubIssues")}
                  onToggle={() => set({ nestedSubIssues: !state.nestedSubIssues })}
                />
              </Row>
            )}
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
              {TASK_COLUMNS.map((c) => (
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

            {/* 面板底部 Reset：仅非默认态渲染（用户定案 2026-09） */}
            {!isDefaultTaskDisplay(state) && (
              <ResetRow
                onReset={() =>
                  onChange({ ...DEFAULT_TASK_DISPLAY, visible: { ...DEFAULT_TASK_DISPLAY.visible } })
                }
              />
            )}
          </div>,
          document.body,
        )}
    </div>
  )
}
