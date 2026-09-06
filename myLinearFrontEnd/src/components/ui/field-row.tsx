import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * 详情页字段行（overview 主区，对齐 Linear）：左列 7.5rem 固定字段名 + 右列自适应内容。
 * 项目详情（Properties / Labels / Description）与任务详情（Properties / Description /
 * Sub-issues）共用。items-start + 名称 pt-1.5 让字段名与右列首行 chip（h-7）视觉齐平；
 * 右列用 minmax(0,1fr) 而非 1fr，保证内部 flex-wrap 的 chip 簇能正常收缩换行不撑破栅格。
 */
export function FieldRow({
  label,
  children,
  className,
}: {
  label: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn("grid grid-cols-[7.5rem_minmax(0,1fr)] items-start gap-4", className)}>
      <span className="pt-1.5 text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}
