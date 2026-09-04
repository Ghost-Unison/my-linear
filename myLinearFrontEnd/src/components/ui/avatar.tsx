import { cn } from "@/lib/utils"
import { colorFor } from "@/lib/color"

interface MemberAvatarProps {
  name: string
  /** 空串/缺省时按名字散列取确定性颜色（api.md：avatarColor 可为 ''） */
  color?: string
  className?: string
}

export function MemberAvatar({ name, color, className }: MemberAvatarProps) {
  return (
    <span
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white",
        className,
      )}
      style={{ backgroundColor: color || colorFor(name) }}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  )
}

/** workspace 方形头像：颜色由名称散列确定（workspace 无 avatarColor 字段） */
export function WorkspaceAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded text-[10px] font-semibold text-white",
        className,
      )}
      style={{ backgroundColor: colorFor(name) }}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  )
}
