import type { FormEvent, ReactNode } from "react"
import { X } from "lucide-react"
import { Button, PendingLabel } from "./button"
import { Dialog } from "./dialog"

/** 创建弹窗的大标题输入框样式（Project name / Task title 共用，无边框 Linear 式） */
export const DIALOG_TITLE_INPUT =
  "w-full bg-transparent text-xl font-medium tracking-tight text-foreground placeholder:text-ink-tertiary focus-visible:outline-none"

/**
 * 创建类弹窗骨架（对齐 Linear New project / New issue）：
 * 标题行 + 关闭 X → 内容区（大标题输入 + 属性 chip 行 + 可选描述，由 children 填充）→
 * 底栏（错误文案 + 提交按钮）。表单校验与提交逻辑由调用方实现。
 */
export function FormDialog({
  open,
  onClose,
  title,
  onSubmit,
  error,
  pending,
  submitLabel,
  submitDisabled,
  children,
}: {
  open: boolean
  onClose: () => void
  /** 左上角小标题（如 "新建项目"） */
  title: string
  onSubmit: (e: FormEvent) => void
  error: string | null
  pending: boolean
  submitLabel: string
  /** 额外禁用条件（如必填名为空）；pending 时恒禁用 */
  submitDisabled?: boolean
  children: ReactNode
}) {
  return (
    <Dialog open={open} onClose={onClose} className="max-w-2xl p-0">
      <form onSubmit={onSubmit}>
        <div className="flex items-center justify-between px-6 pt-4">
          <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex flex-col gap-4 px-6 pt-3">{children}</div>

        <div className="mt-4 flex items-center justify-between border-t border-border px-6 py-4">
          <span className="text-sm text-destructive">{error}</span>
          <Button type="submit" disabled={pending || submitDisabled}>
            <PendingLabel pending={pending} label={submitLabel} pendingLabel="创建中…" />
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
