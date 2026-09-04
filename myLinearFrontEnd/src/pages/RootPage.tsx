import { Link, Navigate } from "react-router-dom"
import { useWorkspaces } from "@/hooks/useWorkspaces"
import { buttonVariants } from "@/components/ui/button"

// / → 空状态引导 / 第一个 workspace 的 Home（P0.md §0、§4）
export function RootPage() {
  const { data: workspaces, isLoading, isError, error } = useWorkspaces()

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        加载中…
      </div>
    )
  }
  if (isError) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-destructive">
        加载失败：{error.message}
      </div>
    )
  }
  if (workspaces && workspaces.length > 0) {
    return <Navigate to={`/w/${workspaces[0].id}/home`} replace />
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <p className="text-sm text-muted-foreground">还没有 workspace，创建第一个开始使用</p>
      <Link to="/w/new" className={buttonVariants()}>
        新建 workspace
      </Link>
    </div>
  )
}
