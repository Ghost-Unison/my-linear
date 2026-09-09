// 圆形图标按钮（Linear 页头风格，P2 用户实测定案）：filter / display options / panel 收缩
// 三按钮统一形态——圆形底纹 + muted 图标 + 激活态右上角蓝点。
import * as React from "react"
import { cn } from "@/lib/utils"

interface RoundIconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  /** 非默认态（如存在过滤条件）右上角亮蓝点 */
  active?: boolean
  children: React.ReactNode
}

/** forwardRef + 透传 rest props，使其可作为 Radix asChild 触发器（DropdownMenuTrigger 等）；
 * 否则 ref/aria-expanded/onClick 会被丢弃，菜单无法打开。 */
export const RoundIconButton = React.forwardRef<HTMLButtonElement, RoundIconButtonProps>(
  ({ label, active, className, children, ...rest }, ref) => (
    <button
      ref={ref}
      type="button"
      title={label}
      aria-label={label}
      className={cn(
        "relative inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground",
        className,
      )}
      {...rest}
    >
      {children}
      {active && <span className="absolute right-1 top-1 size-1.5 rounded-full bg-primary" />}
    </button>
  ),
)
RoundIconButton.displayName = "RoundIconButton"
