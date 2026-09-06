import { useEffect, useRef, useState, type FormEvent, type MutableRefObject } from "react"
import { useTranslation } from "react-i18next"
import { Pencil, Trash2 } from "lucide-react"
import type { Label, LabelScope } from "@/api/types"
import { displayError } from "@/lib/errors"
import {
  useCreateLabel,
  useDeleteLabel,
  useLabels,
  useUpdateLabel,
} from "@/hooks/useLabels"
import { LABEL_PALETTE } from "@/lib/color"
import { cn } from "@/lib/utils"
import { Button, PendingLabel } from "@/components/ui/button"
import { ColorSwatchPicker } from "@/components/ui/color-swatch-picker"
import { ConfirmDialog, Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { LabelPill } from "@/components/ui/label-options"

// 弹窗目标：create 携带入口 section 的 scope；edit 携带基准行（PATCH presence 只发变更字段）
type DialogTarget =
  | { mode: "create"; scope: LabelScope }
  | { mode: "edit"; label: Label }
  | null

// 页头 "+ New label" 按钮的命令式句柄：按钮直接调 openCreate 写入弹窗 target
export interface LabelsSectionHandle {
  openCreate: () => void
}

// Label 管理区（P1.md §2）：Task labels / Project labels 两个独立表格，created_at ASC（后端固定）。
// 交互约定同 MembersSection：创建走弹窗（页头 "+ New label" 按钮经 handle 驱动）；
// 编辑复用同一弹窗（预填）；删除二次确认（联结行 CASCADE，任务/项目本体保留）。
// 弹窗 target 是唯一事实来源：创建（页头按钮）与编辑（行内铅笔）都直接写 target，
// 不用受控 addOpen + effect 同步——双源状态会互相覆盖（编辑保存后误弹创建弹窗）
export function LabelsSection({
  workspaceId,
  handle,
}: {
  workspaceId: string
  /** 页头按钮的命令式句柄：挂载时注册 openCreate，卸载时清空 */
  handle?: MutableRefObject<LabelsSectionHandle | null>
}) {
  const { t } = useTranslation()
  // 一次拉全量（scope 缺席），前端按 scope 分两组渲染，两个 section 共享一份缓存
  const { data: labels, isLoading, isError, error } = useLabels(workspaceId)
  const deleteLabel = useDeleteLabel(workspaceId)
  const [target, setTarget] = useState<DialogTarget>(null)
  // deleting 在弹窗关闭后保留（下次打开会重设），避免淡出动画期间标题变空（同 MembersSection）
  const [deleting, setDeleting] = useState<Label | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)

  // 注册页头按钮句柄：创建默认落在 task scope，弹窗内可切（对齐 Linear 的 label group 选择）
  useEffect(() => {
    if (!handle) return
    handle.current = { openCreate: () => setTarget({ mode: "create", scope: "task" }) }
    return () => {
      handle.current = null
    }
  }, [handle])

  const taskLabels = labels?.filter((l) => l.scope === "task") ?? []
  const projectLabels = labels?.filter((l) => l.scope === "project") ?? []

  return (
    <section className="flex flex-col gap-8">
      <LabelTable
        title={t("label.taskSection")}
        labels={taskLabels}
        isLoading={isLoading}
        isError={isError}
        error={error}
        emptyText={t("label.taskEmpty")}
        onEdit={(label) => setTarget({ mode: "edit", label })}
        onDelete={(label) => {
          setDeleting(label)
          setDeleteOpen(true)
        }}
      />
      <LabelTable
        title={t("label.projectSection")}
        labels={projectLabels}
        isLoading={isLoading}
        isError={isError}
        error={error}
        emptyText={t("label.projectEmpty")}
        onEdit={(label) => setTarget({ mode: "edit", label })}
        onDelete={(label) => {
          setDeleting(label)
          setDeleteOpen(true)
        }}
      />

      {/* 常驻挂载 + open 控制，保证淡出动画完整播放（open 由 target 派生） */}
      <LabelFormDialog
        workspaceId={workspaceId}
        target={target}
        onClose={() => setTarget(null)}
      />

      <ConfirmDialog
        open={deleteOpen}
        title={t("label.deleteConfirmTitle", { name: deleting?.name ?? "" })}
        description={t("label.deleteConfirmDesc")}
        confirmText={t("label.deleteConfirmButton")}
        destructive
        pending={deleteLabel.isPending}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => {
          if (!deleting) return
          deleteLabel.mutate(deleting.id, { onSuccess: () => setDeleteOpen(false) })
        }}
      />
    </section>
  )
}

/** 单个 scope 的标签区：标题行 + chip 流（色点+名称药丸，hover/聚焦显现编辑、删除），裸排无卡片包裹（对齐 MembersSection） */
function LabelTable({
  title,
  labels,
  isLoading,
  isError,
  error,
  emptyText,
  onEdit,
  onDelete,
}: {
  title: string
  labels: Label[]
  isLoading: boolean
  isError: boolean
  error: unknown
  emptyText: string
  onEdit: (label: Label) => void
  onDelete: (label: Label) => void
}) {
  const { t } = useTranslation()
  return (
    <div>
      <h2 className="border-b border-border pb-2 text-xs font-medium text-muted-foreground">
        {title}
      </h2>

      {isLoading && <p className="py-4 text-sm text-muted-foreground">{t("common.loading")}</p>}
      {isError && (
        <p className="py-4 text-sm text-destructive">
          {displayError(t, error, "errors.loadFailed")}
        </p>
      )}
      {!isLoading && !isError && labels.length === 0 && (
        <p className="py-4 text-sm text-muted-foreground">{emptyText}</p>
      )}

      {!isLoading && !isError && labels.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-3">
          {labels.map((l) => (
            <LabelPill key={l.id} label={l} className="group pr-1">
              {/* focus-within：键盘 Tab 聚焦时操作按钮同样可见（同 MembersSection） */}
              <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                <button
                  type="button"
                  title={t("label.edit")}
                  onClick={() => onEdit(l)}
                  className="flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Pencil className="size-3" />
                </button>
                <button
                  type="button"
                  title={t("label.delete")}
                  onClick={() => onDelete(l)}
                  className="flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Trash2 className="size-3" />
                </button>
              </span>
            </LabelPill>
          ))}
        </div>
      )}
    </div>
  )
}

/** 创建 / 编辑共用弹窗（P1.md §2）：name 必填（trim 后非空，同 scope 重名 → 409）；
 * color 必选（LABEL_PALETTE 点选，默认预选首色，不存在无色场景）。scope 创建时由入口决定，不可改 */
function LabelFormDialog({
  workspaceId,
  target,
  onClose,
}: {
  workspaceId: string
  target: DialogTarget
  onClose: () => void
}) {
  const { t } = useTranslation()
  const createLabel = useCreateLabel(workspaceId)
  const updateLabel = useUpdateLabel(workspaceId)
  const [name, setName] = useState("")
  const [color, setColor] = useState<string>(LABEL_PALETTE[0])
  // 创建时的 scope（弹窗内可切）；编辑时 scope 不可改，以 target.label.scope 为准
  const [createScope, setCreateScope] = useState<LabelScope>("task")
  const [error, setError] = useState<unknown>(null)

  const open = target !== null
  const pending = createLabel.isPending || updateLabel.isPending

  // 淡出动画期间 target 已置 null，但 Dialog 在 open→false 的那一帧仍以 opacity-100 渲染 children
  // （见 dialog.tsx：visible 由 useEffect 异步翻转，晚一帧）。用 ref 缓存最后一次非空 target 供
  // 标题/scope/按钮渲染，避免编辑弹窗关闭瞬间标题 fall-through 成“新建标签”闪现（同 ConfirmDialog 保留 deleting）
  const lastTarget = useRef<DialogTarget>(null)
  if (target) lastTarget.current = target
  const view = target ?? lastTarget.current

  // 每次打开时重置表单：create 空名 + 默认首色（scope 用入口默认值）；edit 预填基准行
  useEffect(() => {
    if (!target) return
    setName(target.mode === "edit" ? target.label.name : "")
    setColor(target.mode === "edit" ? target.label.color : LABEL_PALETTE[0])
    setCreateScope(target.mode === "create" ? target.scope : "task")
    setError(null)
  }, [target])

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!target) return
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError("validation.nameRequired")
      return
    }
    setError(null)
    if (target.mode === "create") {
      createLabel.mutate(
        { name: trimmedName, color, scope: createScope },
        { onSuccess: onClose, onError: setError },
      )
      return
    }
    // PATCH presence 合并：只发送变更字段（同 EditMemberRow）；无变更直接关闭
    const base = target.label
    const input: { name?: string; color?: string } = {}
    if (trimmedName !== base.name) input.name = trimmedName
    if (color !== base.color) input.color = color
    if (Object.keys(input).length === 0) {
      onClose()
      return
    }
    updateLabel.mutate(
      { labelId: base.id, input },
      { onSuccess: onClose, onError: setError },
    )
  }

  const errorText = displayError(t, error, view?.mode === "edit" ? "common.saveFailed" : "common.createFailed")

  return (
    <Dialog open={open} onClose={onClose}>
      <h2 className="text-base font-semibold tracking-tight">
        {view?.mode === "edit" ? t("label.editTitle") : t("label.createTitle")}
      </h2>
      <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-4">
        {view?.mode === "create" && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">{t("label.scope")}</span>
            <div className="flex gap-1.5">
              {(["task", "project"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={createScope === s}
                  onClick={() => setCreateScope(s)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs transition-colors",
                    createScope === s
                      ? "border-ring bg-accent text-foreground"
                      : "border-border text-muted-foreground hover:bg-accent/50",
                  )}
                >
                  {s === "task" ? t("label.taskSection") : t("label.projectSection")}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="lb-name" className="text-xs font-medium text-muted-foreground">
            {t("common.name")}
          </label>
          <Input
            id="lb-name"
            value={name}
            placeholder={t("label.namePlaceholder")}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">{t("label.color")}</span>
          <div className="flex items-center gap-3">
            <ColorSwatchPicker value={color} onChange={setColor} palette={LABEL_PALETTE} />
            {/* 当前色预览：chip 实际观感（色点 + name） */}
            <span className="flex items-center gap-1.5 rounded-full border border-border bg-accent px-2 py-0.5 text-xs text-muted-foreground">
              <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: color }} />
              {name.trim() || t("label.namePlaceholder")}
            </span>
          </div>
        </div>
        {errorText && <p className="text-sm text-destructive">{errorText}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={pending || !name.trim()}>
            <PendingLabel
              pending={pending}
              label={view?.mode === "edit" ? t("common.save") : t("common.create")}
              pendingLabel={
                view?.mode === "edit" ? t("common.saving") : t("common.creating")
              }
            />
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
