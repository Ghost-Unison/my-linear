import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * 页头三段式（Linear 风格，吸顶由父级布局的 shrink-0 + 内部滚动区保证）：
 * 标题/面包屑行（自带底部分割线）→ tab 行（胶囊 tab + 右侧 ml-auto 操作区）。
 * tabs/actions 为自由槽位：tabs 放 tabPill 胶囊组，actions 放当前 tab 的操作按钮。
 */
export function PageHeader({
  title,
  tabs,
  actions,
}: {
  title: ReactNode
  tabs?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="shrink-0">
      <div className="flex items-center gap-2 border-b border-border px-6 pb-3 pt-5">{title}</div>
      <nav className="flex items-center gap-1 px-6 py-2.5">
        {tabs}
        {actions && <div className="ml-auto flex items-center gap-1">{actions}</div>}
      </nav>
    </header>
  )
}

/** 胶囊 tab 样式（选中 / 未选中）：页头 tab 行与单视图占位胶囊共用 */
export function tabPill(active: boolean) {
  return cn(
    "rounded-full px-3 py-1 text-sm transition-colors",
    active ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
  )
}
