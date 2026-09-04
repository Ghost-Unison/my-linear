import { useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useCreateWorkspace } from "@/hooks/useWorkspaces"
import { displayError } from "@/lib/errors"
import { Button, PendingLabel } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

// /w/new → workspace 创建页（P0.md §0：点击侧边栏 + 右侧变为创建页）
export function WorkspaceCreatePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const create = useCreateWorkspace()
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [error, setError] = useState<unknown>(null)

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError("validation.nameRequired")
      return
    }
    setError(null)
    const desc = description.trim()
    create.mutate(
      { name: trimmedName, ...(desc ? { description: desc } : {}) },
      {
        onSuccess: (ws) => navigate(`/w/${ws.id}/home`),
        onError: (err) => setError(err),
      },
    )
  }

  const errorText = displayError(t, error, "common.createFailed")

  return (
    <div className="mx-auto max-w-lg px-6 py-10">
      <h1 className="text-xl font-semibold tracking-tight">{t("workspace.create.title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("workspace.create.subtitle")}</p>
      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ws-name" className="text-sm font-medium">
            {t("common.name")}
          </label>
          <Input
            id="ws-name"
            value={name}
            placeholder={t("workspace.create.namePlaceholder")}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ws-desc" className="text-sm font-medium">
            {t("common.description")}{" "}
            <span className="font-normal text-muted-foreground">{t("common.optional")}</span>
          </label>
          <Textarea
            id="ws-desc"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        {errorText && <p className="text-sm text-destructive">{errorText}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={create.isPending || !name.trim()}>
            <PendingLabel
              pending={create.isPending}
              label={t("common.create")}
              pendingLabel={t("common.creating")}
            />
          </Button>
        </div>
      </form>
    </div>
  )
}
