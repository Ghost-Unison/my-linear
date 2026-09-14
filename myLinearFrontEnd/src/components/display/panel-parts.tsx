// Display 面板共享原语（project / task 两侧面板共用，2026-09 任务切片抽出）：
// Row 行布局 / ValuePicker 值药丸单选下拉 / Switch 迷你开关。
// 交互约定同 P2.md §3：内层下拉 portal 挂 body、mousedown 阻断冒泡（防外层 usePopover 误判外部点击）。
import { useRef } from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import { Check, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { usePopover } from "@/components/ui/popover"
import { useFixedPanelStyle } from "@/components/ui/select"

/** 面板行：左标签右控件（Linear 同位布局） */
export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  )
}

/** 值药丸单选下拉（点击即选即关）：trigger 为 Linear 值药丸形态，飞出清单复用 fixed+portal 定位 */
export function ValuePicker({
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

/** 迷你开关（Show empty groups / Show sub-issues 等）：Linear 同位小滑钮形态 */
export function Switch({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
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

/** 面板底部 Reset（回全局默认，蓝点熄灭态）：仅非默认态渲染（用户定案 2026-09 任务切片，两侧面板统一）；
 *  无边框纯文字按钮（2026-09 修订） */
export function ResetRow({ onReset }: { onReset: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="mt-1 flex justify-center border-t border-border px-3 pb-1 pt-2">
      <button
        type="button"
        onClick={onReset}
        className="rounded-md px-6 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
      >
        {t("display.reset")}
      </button>
    </div>
  )
}
