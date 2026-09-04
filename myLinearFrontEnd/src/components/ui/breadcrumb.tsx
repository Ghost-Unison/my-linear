import { Fragment } from "react"
import { Link } from "react-router-dom"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

export interface BreadcrumbItem {
  label: string
  /** 缺省（含末项）不可点击 */
  to?: string
}

/**
 * 面包屑（对齐 Linear 详情页顶部）：中间项可点回跳，末项为当前页。
 * 标签逐项 truncate，末项优先占满余量，避免长名称撑破页头。
 */
export function Breadcrumb({
  items,
  className,
}: {
  items: BreadcrumbItem[]
  className?: string
}) {
  return (
    <nav aria-label="面包屑" className={cn("flex min-w-0 items-center gap-1 text-sm", className)}>
      {items.map((item, i) => {
        const last = i === items.length - 1
        return (
          <Fragment key={`${item.label}-${i}`}>
            {i > 0 && <ChevronRight className="size-3 shrink-0 text-ink-tertiary" />}
            {item.to && !last ? (
              <Link
                to={item.to}
                className="max-w-40 shrink truncate text-muted-foreground transition-colors hover:text-foreground"
              >
                {item.label}
              </Link>
            ) : (
              <span
                className={cn(
                  "min-w-0 truncate",
                  last ? "text-ink-muted" : "text-muted-foreground",
                )}
              >
                {item.label}
              </span>
            )}
          </Fragment>
        )
      })}
    </nav>
  )
}
