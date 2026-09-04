import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { createPortal } from "react-dom"
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, X } from "lucide-react"
import { DayPicker } from "react-day-picker"
import { cn } from "@/lib/utils"
import { usePopover } from "./popover"

/** wire 格式 YYYY-MM-DD 的解析/格式化。Date 仅作日历显示载体（本地零点），从不过线 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function parseDate(value: string): Date | undefined {
  if (!DATE_RE.test(value)) return undefined
  const [y, m, d] = value.split("-").map(Number)
  const date = new Date(y, m - 1, d)
  // 溢出校验：2026-02-30 会被 Date 滚动成 3 月，视为非法
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    return undefined
  }
  return date
}

function formatDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

interface DatePickerProps {
  /** 当前值（"YYYY-MM-DD"，空串 = 未选） */
  value: string
  onChange: (value: string) => void
  /** chip 占位文案（如 "开始日期"） */
  placeholder?: string
  className?: string
}

/**
 * 统一日期选择器：属性 chip 触发 + 弹层（文本输入 + 日历网格），对齐 Linear datepicker。
 * 日历基于 react-day-picker v10，样式经 classNames 定制：周一开头、外月日淡化、
 * 今天描圈、选中 primary 填充。值收发一律 YYYY-MM-DD 字符串，与后端 wire 契约一致。
 * 弹层用 fixed 定位 + createPortal 到 body（脱离父级滚动/overflow/transform 上下文）：
 * absolute 方案在右侧窄面板内会撑大滚动区触发纵向滚动条、把面板内容挤偏；
 * fixed 不 portal 则会被 Dialog 面板的 scale-100（常驻 transform）劫持为相对 Dialog 定位，
 * 坐标整体偏移。右缘越界时自动向左展开。z-[60] 高于 Dialog 的 z-50。
 */
export function DatePicker({ value, onChange, placeholder, className }: DatePickerProps) {
  const { open, setOpen, ref, panelRef } = usePopover()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const [input, setInput] = useState(value)
  const [month, setMonth] = useState<Date>()

  // 打开时同步：输入框回显当前值，日历跳到已选月份（无值则当月）；
  // 并按 trigger 视口坐标定位弹层（右缘贴视口时向左展开，Linear 在窄面板内的形态）
  useEffect(() => {
    if (open) {
      setInput(value)
      setMonth(parseDate(value) ?? new Date())
      const rect = triggerRef.current?.getBoundingClientRect()
      if (rect) {
        const width = 248 // 弹层 w-[15.5rem]
        const left =
          rect.left + width > window.innerWidth - 8 ? rect.right - width : rect.left
        setPos({ left: Math.max(8, left), top: rect.bottom + 4 })
      }
    }
    // 仅在打开瞬间同步；值变化由输入联动与日历点击各自处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // 输入合法日期即实时生效（chip 与日历联动跳月）；中间态不生效
  const handleInput = (raw: string) => {
    setInput(raw)
    const date = parseDate(raw)
    if (date) {
      onChange(raw)
      setMonth(date)
    }
  }

  // blur 收尾：空 = 清空（对齐原生 date input 行为）；非空非法 = 回退当前值
  const commitInput = () => {
    if (input === "") {
      if (value !== "") onChange("")
    } else if (!parseDate(input)) {
      setInput(value)
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault()
      commitInput()
      setOpen(false)
    }
  }

  return (
    <div ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={placeholder}
        onClick={() => setOpen(!open)}
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 text-xs text-ink-muted transition-colors hover:bg-surface-3",
          className,
        )}
      >
        <CalendarIcon className="size-3.5" />
        <span className={cn("max-w-40 truncate", !value && "text-muted-foreground")}>
          {value || placeholder}
        </span>
      </button>
      {/* 弹层 portal 到 body：坐标在打开瞬间快照（打开期间 trigger 不移动）；
          click-outside 由 usePopover 同时判定 trigger 容器与 panelRef（弹层脱离原容器） */}
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            style={{ left: pos.left, top: pos.top }}
            className="fixed z-60 w-62 rounded-md border border-border bg-popover p-3 shadow-lg"
          >
            <div className="relative mb-2">
              <input
                value={input}
                autoFocus
                aria-label="日期"
                placeholder="YYYY-MM-DD"
                inputMode="numeric"
                onChange={(e) => handleInput(e.target.value)}
                onBlur={commitInput}
                onKeyDown={handleKeyDown}
                className="h-8 w-full rounded-md border border-input bg-surface-1 px-2.5 pr-14 text-xs text-foreground placeholder:text-ink-tertiary focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
              />
              <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
                {value && (
                  <button
                    type="button"
                    aria-label="清除日期"
                    onClick={() => {
                      onChange("")
                      setInput("")
                    }}
                    className="flex size-5 items-center justify-center rounded text-ink-subtle transition-colors hover:bg-surface-3 hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
                <CalendarIcon className="pointer-events-none size-3.5 text-ink-tertiary" />
              </div>
            </div>
            <DayPicker
              mode="single"
              weekStartsOn={1}
              showOutsideDays
              month={month}
              onMonthChange={setMonth}
              selected={parseDate(value)}
              onSelect={(date) => {
                if (!date) return // 单选模式下再点已选日会回调 undefined，忽略即可
                onChange(formatDate(date))
                setInput(formatDate(date))
                setOpen(false)
              }}
              formatters={{
                formatCaption: (m) => `${m.getFullYear()}年${m.getMonth() + 1}月`,
                formatWeekdayName: (d) => "日一二三四五六"[d.getDay()],
              }}
              components={{
                Chevron: ({ orientation }) =>
                  orientation === "left" ? (
                    <ChevronLeft className="size-4" />
                  ) : (
                    <ChevronRight className="size-4" />
                  ),
              }}
              classNames={{
                root: "w-full",
                // Nav 渲染在 Months 首位（v10 默认布局），绝对定位到右上角
                months: "relative flex flex-col",
                nav: "absolute right-0 top-0 flex items-center",
                button_previous:
                  "flex size-7 items-center justify-center rounded-md text-ink-subtle transition-colors hover:bg-surface-3 hover:text-foreground",
                button_next:
                  "flex size-7 items-center justify-center rounded-md text-ink-subtle transition-colors hover:bg-surface-3 hover:text-foreground",
                month: "flex flex-col",
                month_caption: "flex h-7 items-center pl-1",
                caption_label: "text-xs font-medium text-foreground",
                month_grid: "w-full",
                weekdays: "flex",
                weekday: "w-8 p-0 text-center text-[0.7rem] text-ink-subtle",
                weeks: "flex flex-col",
                week: "flex",
                day: "p-0",
                day_button:
                  "flex size-8 items-center justify-center rounded-md text-xs text-ink-muted transition-colors hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                // 修饰类挂在 day 单元格（td）上，经 [&>button] 下钻到按钮，避免与 day_button 同特异性冲突
                selected:
                  "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary",
                today: "[&>button]:text-foreground [&>button]:ring-1 [&>button]:ring-ink-subtle/50",
                outside: "[&>button]:text-ink-tertiary/70",
                disabled: "[&>button]:opacity-40",
                hidden: "invisible",
              }}
            />
          </div>,
          document.body,
        )}
    </div>
  )
}
