import { useEffect, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { Button, PendingLabel } from "./button"

// 与下方 transition 的 duration-200 对应：淡出动画播完才真正卸载
const TRANSITION_MS = 200

interface DialogProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  className?: string
}

// 轻量对话框：overlay 点击 / Escape 关闭；淡入淡出 + 面板轻微缩放
// 注意：调用方必须传 open prop 控制显隐（不要条件渲染 Dialog 本身），否则淡出动画会被直接卸载吃掉
export function Dialog({ open, onClose, children, className }: DialogProps) {
  const [mounted, setMounted] = useState(open)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (open) {
      setMounted(true)
      // 双 rAF：先以透明态挂载，下一帧再置可见，确保 transition 生效
      const raf = requestAnimationFrame(() =>
        requestAnimationFrame(() => setVisible(true)),
      )
      return () => cancelAnimationFrame(raf)
    }
    setVisible(false)
    const timer = setTimeout(() => setMounted(false), TRANSITION_MS)
    return () => clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!mounted) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className={cn(
          "absolute inset-0 bg-black/70 transition-opacity duration-200",
          visible ? "opacity-100" : "opacity-0",
        )}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "relative w-full max-w-md rounded-lg border border-border bg-popover p-6 transition-all duration-200",
          visible ? "scale-100 opacity-100" : "scale-95 opacity-0",
          className,
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}

interface ConfirmDialogProps {
  open: boolean
  title: string
  description?: string
  confirmText?: string
  destructive?: boolean
  pending?: boolean
  onConfirm: () => void
  onClose: () => void
}

/** 二次确认对话框（删除 workspace 等毁灭性操作必须走这里，见 api.md §5） */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmText,
  destructive,
  pending,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onClose={onClose}>
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      {description && <p className="mt-2 text-sm text-muted-foreground">{description}</p>}
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={pending}>
          {t("common.cancel")}
        </Button>
        <Button
          variant={destructive ? "destructive" : "primary"}
          onClick={onConfirm}
          disabled={pending}
        >
          <PendingLabel
            pending={!!pending}
            label={confirmText ?? t("common.confirm")}
            pendingLabel={t("common.processing")}
          />
        </Button>
      </div>
    </Dialog>
  )
}
