import type { InputHTMLAttributes } from "react"
import { cn } from "@/lib/utils"

// text-input 规格：surface-1 底 + hairline 边 + 2px primary-focus 聚焦环（50% 透明）
export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-8 w-full rounded-md border border-input bg-surface-1 px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50",
        className,
      )}
      {...props}
    />
  )
}
