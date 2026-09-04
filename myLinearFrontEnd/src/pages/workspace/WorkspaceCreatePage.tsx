import { useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { useCreateWorkspace } from "@/hooks/useWorkspaces"
import { ApiError } from "@/api/client"
import { Button, PendingLabel } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

// /w/new → workspace 创建页（P0.md §0：点击侧边栏 + 右侧变为创建页）
export function WorkspaceCreatePage() {
  const navigate = useNavigate()
  const create = useCreateWorkspace()
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [error, setError] = useState<string | null>(null)

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError("名称不能为空")
      return
    }
    setError(null)
    const desc = description.trim()
    create.mutate(
      { name: trimmedName, ...(desc ? { description: desc } : {}) },
      {
        onSuccess: (ws) => navigate(`/w/${ws.id}/home`),
        onError: (err) => setError(err instanceof ApiError ? err.message : "创建失败"),
      },
    )
  }

  return (
    <div className="mx-auto max-w-lg px-6 py-10">
      <h1 className="text-xl font-semibold tracking-tight">新建 workspace</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        workspace 是顶层容器，承载项目与成员。
      </p>
      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ws-name" className="text-sm font-medium">
            名称
          </label>
          <Input
            id="ws-name"
            value={name}
            placeholder="例如：Personal"
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ws-desc" className="text-sm font-medium">
            描述 <span className="font-normal text-muted-foreground">（可选）</span>
          </label>
          <Textarea
            id="ws-desc"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
            取消
          </Button>
          <Button type="submit" disabled={create.isPending || !name.trim()}>
            <PendingLabel pending={create.isPending} label="创建" pendingLabel="创建中…" />
          </Button>
        </div>
      </form>
    </div>
  )
}
