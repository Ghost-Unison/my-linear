import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react"
import { createPortal } from "react-dom"
import { Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { usePopover } from "./popover"

export interface SelectOption<T> {
  value: T
  label: ReactNode
  icon?: ReactNode
}

// 触发按钮基准样式：Linear 属性 chip（圆角药丸 + surface-2 底）
const TRIGGER =
  "inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 text-xs text-ink-muted transition-colors hover:bg-surface-3"

const PANEL =
  "fixed z-[60] max-h-60 w-max overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-lg"

const OPTION =
  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-accent"

/**
 * 弹层 maxWidth 上限：既写进 inline style 夹住 w-max 弹层的实际宽度，
 * 也作为右缘溢出判断的宽度依据（弹层真实宽度恒 ≤ 该上限，判据因此永不低估）
 */
const PANEL_MAX_W = 260

/**
 * fixed 浮层定位（对齐 Linear：弹层脱离父级滚动/overflow 上下文）。
 * absolute 方案在右侧窄面板内会溢出 aside 触发滚动条、挤压面板内容。
 * 默认左对齐 trigger 向右延伸；右缘空间不足时锚定 trigger 右缘向左展开
 * （right 锚定无需预知弹层宽度，适配 w-max 内容自适应）。
 * 右缘判断取 PANEL_MAX_W 上限而非内容实际宽度：上限由本 hook 的 inline maxWidth 强制，
 * 因此任何内容宽度都不会溢出视口被裁切；代价是 trigger 距右缘 260px 内即提前右对齐
 * （观感同 Linear 属性下拉）。
 * useLayoutEffect 保证坐标在绘制前就绪，无首帧闪动；返回 null 时弹层不渲染。
 * 注意：弹层必须 createPortal 到 body——fixed 坐标相对视口，若祖先带 transform
 * （如 Dialog 面板的 scale-100），fixed 会退化为相对该祖先定位，坐标整体偏移。
 * z-[60] 高于 Dialog 的 z-50，保证 Dialog 内弹层不被遮罩。
 * anchorKey：同一浮层可切换锚点元素时（如标签 chip 与 “+” 共用一个面板）作为额外
 * 重算依赖——open 保持 true 时仅靠 open 变化无法触发重算，浮层会停在旧锚点位置。
 */
export function useFixedPanelStyle(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  anchorKey?: unknown,
): CSSProperties | null {
  const [style, setStyle] = useState<CSSProperties | null>(null)
  useLayoutEffect(() => {
    if (!open) return
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    // minWidth 取 trigger 宽度，保持原 min-w-full 语义
    const base = { top: rect.bottom + 4, minWidth: rect.width, maxWidth: PANEL_MAX_W }
    setStyle(
      rect.left + PANEL_MAX_W > window.innerWidth - 8
        ? { ...base, right: window.innerWidth - rect.right }
        : { ...base, left: rect.left },
    )
  }, [open, triggerRef, anchorKey])
  return open ? style : null
}

interface SelectProps<T> {
  value: T
  options: readonly SelectOption<T>[]
  onChange: (value: T) => void
  /** 未选中/占位内容（如 "负责人"） */
  placeholder?: ReactNode
  className?: string
}

/** 单选下拉：trigger 显示当前项，面板点击即选即关 */
export function Select<T>({ value, options, onChange, placeholder, className }: SelectProps<T>) {
  const { open, setOpen, ref, panelRef } = usePopover()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelStyle = useFixedPanelStyle(open, triggerRef)
  const selected = options.find((o) => o.value === value)

  return (
    <div ref={ref}>
      <button ref={triggerRef} type="button" onClick={() => setOpen(!open)} className={cn(TRIGGER, className)}>
        {selected?.icon}
        <span className={cn("max-w-40 truncate", !selected && "text-muted-foreground")}>
          {selected ? selected.label : placeholder}
        </span>
      </button>
      {open &&
        panelStyle &&
        createPortal(
          <div ref={panelRef} className={PANEL} style={panelStyle}>
          {options.map((o, i) => (
            <button
              key={typeof o.value === "string" || typeof o.value === "number" ? o.value : i}
              type="button"
              className={OPTION}
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
            >
              {o.icon}
              <span className="truncate">{o.label}</span>
              {o.value === value && <Check className="ml-auto size-3.5 text-primary" />}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}

interface MultiSelectProps<T> {
  value: readonly T[]
  options: readonly SelectOption<T>[]
  onChange: (value: T[]) => void
  placeholder?: ReactNode
  className?: string
}

/** 多选下拉：勾选切换、面板保持打开；trigger 显示已选项的拼接文案 */
export function MultiSelect<T>({
  value,
  options,
  onChange,
  placeholder,
  className,
}: MultiSelectProps<T>) {
  const { open, setOpen, ref, panelRef } = usePopover()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelStyle = useFixedPanelStyle(open, triggerRef)
  const selected = options.filter((o) => value.includes(o.value))

  const toggle = (v: T) =>
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])

  return (
    <div ref={ref}>
      <button ref={triggerRef} type="button" onClick={() => setOpen(!open)} className={cn(TRIGGER, className)}>
        <span className={cn("max-w-48 truncate", selected.length === 0 && "text-muted-foreground")}>
          {selected.length > 0 ? selected.map((o) => o.label).join(", ") : placeholder}
        </span>
      </button>
      {open &&
        panelStyle &&
        createPortal(
          <div ref={panelRef} className={PANEL} style={panelStyle}>
          {options.map((o, i) => {
            const checked = value.includes(o.value)
            return (
              <button
                key={typeof o.value === "string" || typeof o.value === "number" ? o.value : i}
                type="button"
                className={OPTION}
                onClick={() => toggle(o.value)}
              >
                {o.icon}
                <span className="truncate">{o.label}</span>
                {checked && <Check className="ml-auto size-3.5 text-primary" />}
              </button>
            )
          })}
        </div>,
        document.body,
      )}
    </div>
  )
}
