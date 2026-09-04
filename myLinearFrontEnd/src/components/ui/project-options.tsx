import { Box } from "lucide-react"

/**
 * 项目下拉选项构建（对称 member-options.tsx）：任务属性编辑与新建弹窗共用。
 * emptyLabel 传入时在首部加空位项（如 "No project"：任务可不归属项目，P0.md §3）。
 */
export function projectOptions(
  projects: readonly { id: string; name: string }[] | undefined,
  emptyLabel?: string,
) {
  const options = (projects ?? []).map((p) => ({
    value: p.id,
    label: p.name,
    icon: <Box className="size-3.5 shrink-0 text-muted-foreground" />,
  }))
  return emptyLabel === undefined ? options : [{ value: "", label: emptyLabel }, ...options]
}
