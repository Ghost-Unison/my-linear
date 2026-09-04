import type { Member } from "@/api/types"
import { MemberAvatar } from "./avatar"

/**
 * 成员下拉选项构建（Select/MultiSelect 通用）：新建弹窗与属性编辑器共用。
 * emptyLabel 传入时在首部加空位项（如 "No lead" / "Unassigned"）；
 * 缺省返回纯成员项（MultiSelect 场景）。lead/members 互斥等护栏由调用方处理。
 */
export function memberOptions(members: Member[] | undefined, emptyLabel?: string) {
  const options = (members ?? []).map((m) => ({
    value: m.id,
    label: m.name,
    icon: <MemberAvatar name={m.name} color={m.avatarColor || undefined} />,
  }))
  return emptyLabel === undefined ? options : [{ value: "", label: emptyLabel }, ...options]
}
