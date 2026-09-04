import { cva, type VariantProps } from "class-variance-authority"
import type { ButtonHTMLAttributes } from "react"
import { cn } from "@/lib/utils"

// 按钮规格对应 DESIGN-linear.app.md components.button-*：rounded.md + 紧凑 padding
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:bg-primary-hover",
        secondary: "border border-border bg-surface-1 text-foreground hover:bg-surface-2",
        ghost: "text-muted-foreground hover:bg-accent hover:text-foreground",
        destructive: "bg-destructive text-white hover:bg-destructive/90",
      },
      size: {
        sm: "h-7 px-2.5 text-xs",
        md: "h-8 px-3.5 text-sm",
        icon: "size-7",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

// 默认 type="button" 防止表单内意外提交；提交按钮需显式 type="submit"
export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
}

/**
 * 双文案同格堆叠：按钮宽度恒定为较宽文案，pending 切换时宽度不突变
 * 例：<PendingLabel pending={isPending} label="保存" pendingLabel="保存中…" />
 */
export function PendingLabel({
  pending,
  label,
  pendingLabel,
}: {
  pending: boolean
  label: string
  pendingLabel: string
}) {
  return (
    <span className="inline-grid">
      <span className={cn("col-start-1 row-start-1", pending && "invisible")}>{label}</span>
      <span className={cn("col-start-1 row-start-1", !pending && "invisible")}>
        {pendingLabel}
      </span>
    </span>
  )
}

export { buttonVariants }
