import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react"
import { Pencil, Trash2 } from "lucide-react"
import type { Member, UpdateMemberInput } from "@/api/types"
import { errorMessage } from "@/api/client"
import {
  useCreateMember,
  useDeleteMember,
  useMembers,
  useUpdateMember,
} from "@/hooks/useMembers"
import { AVATAR_PALETTE } from "@/lib/color"
import { MemberAvatar } from "@/components/ui/avatar"
import { Button, PendingLabel } from "@/components/ui/button"
import { ColorSwatchPicker } from "@/components/ui/color-swatch-picker"
import { ConfirmDialog, Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

// 表头 / 数据行 / 编辑行共用同一套列宽
const ROW_GRID = "grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7rem]"

// Members 区：Name / Email 两列表格（P0.md §1，无 Role 列）
// 对齐 Linear Members 页：裸表格无卡片包裹；添加按钮在页头 tab 行（addOpen 受控）
// 交互约定：添加走弹窗；编辑行内进行；删除二次确认
export function MembersSection({
  workspaceId,
  addOpen,
  onAddOpenChange,
}: {
  workspaceId: string
  /** 外部受控的添加弹窗开关（页头按钮驱动）；缺省退化为内部状态 */
  addOpen?: boolean
  onAddOpenChange?: (open: boolean) => void
}) {
  const { data: members, isLoading, isError, error } = useMembers(workspaceId)
  const deleteMember = useDeleteMember(workspaceId)
  const [addingInner, setAddingInner] = useState(false)
  const adding = addOpen ?? addingInner
  const setAdding = (v: boolean) => {
    if (onAddOpenChange) onAddOpenChange(v)
    else setAddingInner(v)
  }
  const [editingId, setEditingId] = useState<string | null>(null)
  // deleting 在弹窗关闭后保留（下次打开会重设），避免淡出动画期间标题变空
  const [deleting, setDeleting] = useState<Member | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)

  return (
    <section>
      <div className={`grid ${ROW_GRID} gap-4 border-b border-border pb-2 text-xs font-medium text-muted-foreground`}>
        <span>Name</span>
        <span>Email</span>
        <span />
      </div>

      {isLoading && <p className="py-4 text-sm text-muted-foreground">加载中…</p>}
      {isError && <p className="py-4 text-sm text-destructive">{error.message}</p>}
      {!isLoading && members?.length === 0 && (
        <p className="py-4 text-sm text-muted-foreground">
          暂无成员。成员是“责任人名片”，用于任务指派与项目负责。点击右上角 Add a member 创建。
        </p>
      )}

      {members?.map((m) =>
        editingId === m.id ? (
          <EditMemberRow
            key={m.id}
            workspaceId={workspaceId}
            initial={m}
            onDone={() => setEditingId(null)}
          />
        ) : (
          <div
            key={m.id}
            className={`group grid ${ROW_GRID} items-center gap-4 border-b border-border py-2 last:border-0`}
          >
            <span className="flex min-w-0 items-center gap-2">
              <MemberAvatar name={m.name} color={m.avatarColor || undefined} />
              <span className="truncate text-sm">{m.name}</span>
            </span>
            <span className="truncate text-sm text-muted-foreground">{m.email || "—"}</span>
            {/* focus-within：键盘 Tab 聚焦时操作按钮同样可见 */}
            <span className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              <Button
                variant="ghost"
                size="icon"
                title="编辑成员"
                onClick={() => setEditingId(m.id)}
              >
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                title="删除成员"
                onClick={() => {
                  setDeleting(m)
                  setDeleteOpen(true)
                }}
              >
                <Trash2 />
              </Button>
            </span>
          </div>
        ),
      )}

      <CreateMemberDialog
        open={adding}
        workspaceId={workspaceId}
        onClose={() => setAdding(false)}
      />

      <ConfirmDialog
        open={deleteOpen}
        title={`删除成员「${deleting?.name ?? ""}」？`}
        description="其名下任务的 assignee 与项目 lead 将自动变为未指派。"
        confirmText="删除"
        destructive
        pending={deleteMember.isPending}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => {
          if (!deleting) return
          deleteMember.mutate(deleting.id, { onSuccess: () => setDeleteOpen(false) })
        }}
      />
    </section>
  )
}

/** 添加成员弹窗（对齐 Linear：创建类操作统一走模态框）。常驻挂载 + open 控制，保证淡出动画完整播放 */
function CreateMemberDialog({
  open,
  workspaceId,
  onClose,
}: {
  open: boolean
  workspaceId: string
  onClose: () => void
}) {
  const createMember = useCreateMember(workspaceId)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [color, setColor] = useState<string>(AVATAR_PALETTE[0])
  const [error, setError] = useState<string | null>(null)

  // 每次打开时重置表单
  useEffect(() => {
    if (open) {
      setName("")
      setEmail("")
      setColor(AVATAR_PALETTE[0])
      setError(null)
    }
  }, [open])

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError("名称不能为空")
      return
    }
    setError(null)
    const trimmedEmail = email.trim()
    createMember.mutate(
      {
        name: trimmedName,
        ...(trimmedEmail ? { email: trimmedEmail } : {}),
        avatarColor: color,
      },
      {
        onSuccess: onClose,
        onError: (err) => setError(errorMessage(err, "创建失败")),
      },
    )
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <h2 className="text-base font-semibold tracking-tight">添加成员</h2>
      <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="cm-name" className="text-xs font-medium text-muted-foreground">
            名称
          </label>
          <Input
            id="cm-name"
            value={name}
            placeholder="成员名称"
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="cm-email" className="text-xs font-medium text-muted-foreground">
            Email（可选）
          </label>
          <Input
            id="cm-email"
            value={email}
            placeholder="name@example.com"
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">头像颜色</span>
          <ColorSwatchPicker value={color} onChange={setColor} />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={createMember.isPending}
          >
            取消
          </Button>
          <Button type="submit" disabled={createMember.isPending || !name.trim()}>
            <PendingLabel pending={createMember.isPending} label="添加" pendingLabel="添加中…" />
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

/** 行内编辑成员：PATCH presence——只发送变更字段；email 清空 → 显式 null（api.md §1） */
function EditMemberRow({
  workspaceId,
  initial,
  onDone,
}: {
  workspaceId: string
  initial: Member
  onDone: () => void
}) {
  const updateMember = useUpdateMember(workspaceId)
  const [name, setName] = useState(initial.name)
  const [email, setEmail] = useState(initial.email ?? "")
  const [color, setColor] = useState(initial.avatarColor || AVATAR_PALETTE[0])
  const [error, setError] = useState<string | null>(null)

  const onSubmit = () => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError("名称不能为空")
      return
    }
    setError(null)
    const trimmedEmail = email.trim()
    const input: UpdateMemberInput = {}
    if (trimmedName !== initial.name) input.name = trimmedName
    if (trimmedEmail !== (initial.email ?? ""))
      input.email = trimmedEmail === "" ? null : trimmedEmail
    // 与 useState 初始值同一基准（avatarColor 可为 ''，此时走名字散列色，不该被静默改写）
    if (color !== (initial.avatarColor || AVATAR_PALETTE[0])) input.avatarColor = color
    if (Object.keys(input).length === 0) {
      onDone()
      return
    }
    updateMember.mutate(
      { memberId: initial.id, input },
      {
        onSuccess: onDone,
        onError: (err) => setError(errorMessage(err, "保存失败")),
      },
    )
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") onSubmit()
    if (e.key === "Escape") onDone()
  }

  return (
    <div className="border-b border-border py-3 last:border-0">
      <div className={`grid ${ROW_GRID} items-center gap-4`}>
        <span className="flex min-w-0 items-center gap-2">
          <MemberAvatar name={name || "?"} color={color} />
          <Input
            value={name}
            placeholder="名称（必填）"
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </span>
        <Input
          value={email}
          placeholder="Email（可选）"
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <span className="flex items-center justify-end gap-1">
          <Button size="sm" onClick={onSubmit} disabled={updateMember.isPending}>
            保存
          </Button>
          <Button size="sm" variant="ghost" onClick={onDone}>
            取消
          </Button>
        </span>
      </div>
      <div className="mt-2.5 pl-7">
        <ColorSwatchPicker value={color} onChange={setColor} />
      </div>
      {error && <p className="mt-2 pl-7 text-sm text-destructive">{error}</p>}
    </div>
  )
}
