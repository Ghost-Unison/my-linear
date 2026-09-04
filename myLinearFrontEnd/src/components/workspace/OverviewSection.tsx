import { useEffect, useRef, useState } from "react"
import type { UpdateWorkspaceInput, Workspace } from "@/api/types"
import { errorMessage } from "@/api/client"
import { useUpdateWorkspace } from "@/hooks/useWorkspaces"
import { cn } from "@/lib/utils"
import { Button, PendingLabel } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

// Overview 区：workspace 名称 / 描述编辑（P0.md §1）。PATCH 只发送变更字段（presence 语义）
export function OverviewSection({ workspace }: { workspace: Workspace }) {
  const update = useUpdateWorkspace()
  const [name, setName] = useState(workspace.name)
  const [description, setDescription] = useState(workspace.description)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // “已保存”提示仅出现 3 秒后自动消失；组件卸载时清理定时器
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current)
    },
    [],
  )

  const trimmedName = name.trim()
  const dirty = trimmedName !== workspace.name || description !== workspace.description

  const onSave = () => {
    if (!trimmedName) {
      setError("名称不能为空")
      return
    }
    const input: UpdateWorkspaceInput = {}
    if (trimmedName !== workspace.name) input.name = trimmedName
    if (description !== workspace.description) input.description = description
    if (Object.keys(input).length === 0) return
    setError(null)
    setSaved(false)
    update.mutate(
      { id: workspace.id, input },
      {
        onSuccess: () => {
          setSaved(true)
          if (savedTimer.current) clearTimeout(savedTimer.current)
          savedTimer.current = setTimeout(() => setSaved(false), 3000)
        },
        onError: (err) => setError(errorMessage(err, "保存失败")),
      },
    )
  }

  return (
    // 裸区块无卡片包裹（对齐 Members tab 与项目/任务详情页：内容直接落在页面底色上，无带底色区域）
    <section>
      {/* form 包裹：名称输入框内 Enter 即可保存（textarea 的 Enter 仍换行） */}
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          onSave()
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ov-name" className="text-xs font-medium text-muted-foreground">
            名称
          </label>
          <Input
            id="ov-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setSaved(false)
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ov-desc" className="text-xs font-medium text-muted-foreground">
            描述
          </label>
          <Textarea
            id="ov-desc"
            rows={3}
            value={description}
            placeholder="这个 workspace 用来做什么？"
            onChange={(e) => {
              setDescription(e.target.value)
              setSaved(false)
            }}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex items-center justify-end gap-3">
          {/* 视觉上是常驻占位的渐变提示；读屏通过 sr-only live region 播报 */}
          <span role="status" className="sr-only">
            {saved && !dirty ? "已保存" : ""}
          </span>
          <span
            aria-hidden
            className={cn(
              "text-xs text-success transition-opacity duration-300",
              saved && !dirty ? "opacity-100" : "opacity-0",
            )}
          >
            已保存
          </span>
          <Button type="submit" size="sm" disabled={!dirty || update.isPending}>
            <PendingLabel pending={update.isPending} label="保存" pendingLabel="保存中…" />
          </Button>
        </div>
      </form>
    </section>
  )
}
