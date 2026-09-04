import { useEffect, useRef, useState } from "react"

/**
 * 轻量弹层状态：点击外部 / Escape 关闭。
 * Escape 用 capture 阶段监听 + stopPropagation——避免嵌在 Dialog 内时
 * 连带触发 Dialog 的全局 Escape 关闭（Dialog 监听在 bubble 阶段）。
 * panelRef 给 portal 到 body 的弹层使用：弹层脱离 trigger 容器后，
 * click-outside 必须同时判定两处，否则点击弹层内部会被误判为“外部”而关闭。
 */
export function usePopover() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (ref.current?.contains(target) || panelRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey, true)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey, true)
    }
  }, [open])

  return { open, setOpen, ref, panelRef }
}
