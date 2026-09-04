import { Link, Navigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useWorkspaces } from "@/hooks/useWorkspaces"
import { displayError } from "@/lib/errors"
import { buttonVariants } from "@/components/ui/button"

// / → 空状态引导 / 第一个 workspace 的 Home（P0.md §0、§4）
export function RootPage() {
  const { t } = useTranslation()
  const { data: workspaces, isLoading, isError, error } = useWorkspaces()

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t("common.loading")}
      </div>
    )
  }
  if (isError) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-destructive">
        {t("errors.loadFailedWithReason", {
          reason: displayError(t, error, "errors.loadFailed") ?? "",
        })}
      </div>
    )
  }
  if (workspaces && workspaces.length > 0) {
    return <Navigate to={`/w/${workspaces[0].id}/home`} replace />
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <p className="text-sm text-muted-foreground">{t("workspace.rootEmpty")}</p>
      <Link to="/w/new" className={buttonVariants()}>
        {t("workspace.createNew")}
      </Link>
    </div>
  )
}
