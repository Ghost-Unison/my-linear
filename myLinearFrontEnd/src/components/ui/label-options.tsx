import type { MouseEvent, ReactNode } from "react"
import type { Label, LabelRef } from "@/api/types"
import { cn } from "@/lib/utils"

/** 行内 chip 统一规格（与 TaskGroupList / TaskDetailPage 的 ROW_CHIP 一致） */
const CHIP = "flex h-5 shrink-0 items-center gap-1 rounded border px-1.5 text-xs"

/**
 * 标签下拉选项构建（Select/MultiSelect 通用）：打标 popover 与新建弹窗共用，
 * 对称 memberOptions——icon 为标签色点，value 为 label id
 */
export function labelOptions(labels: Label[] | undefined) {
  return (labels ?? []).map((l) => ({
    value: l.id,
    label: l.name,
    icon: <LabelDot color={l.color} />,
  }))
}

/** 标签色点（选项 icon / chip 簇共用） */
export function LabelDot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("size-2.5 shrink-0 rounded-full", className)}
      style={{ backgroundColor: color }}
    />
  )
}

/**
 * 列表行 label chip 簇（P1.md §3：色点 + name，位于行右信息区 assignee 之前）：
 * 任务列表行（TaskGroupList RowMeta）与子任务行（详情页 SubTaskItem）共用。
 * 无标签不渲染（行高不抖动）；纯展示，打标入口在详情属性面板与新建弹窗
 */
export function LabelChips({ labels }: { labels: LabelRef[] }) {
  if (labels.length === 0) return null
  return (
    <>
      {labels.map((l) => (
        <span key={l.id} title={l.name} className={cn(CHIP, "border-border text-muted-foreground")}>
          <LabelDot color={l.color} className="size-2" />
          <span className="max-w-20 truncate">{l.name}</span>
        </span>
      ))}
    </>
  )
}

/**
 * 标签药丸 chip（色点 + 名称，h-7 圆角药丸，对齐 Linear 属性行观感）：
 * Project 详情 Labels 行与 Workspace 标签管理区共用。比列表行 LabelChips（h-5）更大，
 * 可承载尾随操作位（children，如管理区 hover 显现的编辑/删除按钮）。
 * 传 onClick 时渲染为 button（如 Project 详情点 chip 打开标签管理面板），带 hover 反馈；
 * 不传则为 span——children 内含按钮的场景（管理区）必须用 span，避免 button 嵌套 button
 */
export function LabelPill({
  label,
  className,
  children,
  title,
  onClick,
}: {
  label: LabelRef
  className?: string
  children?: ReactNode
  title?: string
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void
}) {
  const body = (
    <>
      <LabelDot color={label.color} className="size-2" />
      <span className="max-w-40 truncate">{label.name}</span>
      {children}
    </>
  )
  const base =
    "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface-2 pl-2.5 pr-2.5 text-xs text-foreground"

  if (!onClick) return <span className={cn(base, className)}>{body}</span>
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(base, "transition-colors hover:bg-surface-3", className)}
    >
      {body}
    </button>
  )
}
