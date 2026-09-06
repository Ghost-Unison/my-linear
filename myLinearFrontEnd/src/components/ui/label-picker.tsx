import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import { Check, Plus } from "lucide-react"
import type { LabelRef, LabelScope } from "@/api/types"
import { displayError } from "@/lib/errors"
import { LABEL_PALETTE } from "@/lib/color"
import { useCreateLabel, useLabels } from "@/hooks/useLabels"
import { cn } from "@/lib/utils"
import { ColorSwatchPicker } from "@/components/ui/color-swatch-picker"
import { LabelDot, LabelPill } from "@/components/ui/label-options"
import { usePopover } from "@/components/ui/popover"
import { useFixedPanelStyle } from "@/components/ui/select"

// 弹层与选项行样式对齐 select.tsx 的 MultiSelect（fixed 浮层 + hover 高亮行）；
// 260px = useFixedPanelStyle 夹住所有弹层的 maxWidth 上限，也是其右缘判断依据的宽度
const PANEL = "fixed z-[60] w-[260px] rounded-md border border-border bg-popover p-1 shadow-lg"
const OPTION =
  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-accent"

/** “+” 入口的锚点标识（chip 锚点直接用各自的 label id） */
const ADD_ANCHOR = "add"

interface LabelsEditorProps {
  /** 实体当前已打的标签（ProjectDetail.labels / TaskDetail.labels，均为后端内嵌的 LabelRef） */
  labels: LabelRef[]
  workspaceId: string
  /** 候选列表与就地新建的 scope：项目详情传 "project"，任务详情传 "task" */
  scope: LabelScope
  /** 标签走 PUT 子资源（全量替换，api.md §9），不走各实体 PATCH 通道 */
  onLabelsChange: (labelIds: string[]) => void
  className?: string
}

/**
 * Labels 行编辑器（对齐 Linear，Project / Task 详情共用，overview 属性行与右侧面板共用）：
 * 已打标签逐个渲染为独立 chip（色点+名称），尾随一枚 "+" 作为添加/管理入口；无标签时仅剩 "+"。
 * 点 "+" 或点任意 chip 都弹出同一枚面板（锚定被点元素）：顶部搜索框 + 该 scope 下已有
 * workspace 标签的复选列表——勾选或取消勾选即 PUT 全量替换并随即收起面板（一次开合完成一个
 * 标签的增删；点 chip 就是为了解绑不必绕回 "+"）；搜索无匹配且输入 >1 字符时给出
 * 「Create new workspace label: "xxx"」，点击切到选色视图，选定颜色即完成新建（POST /labels）
 * 并追加到当前实体（PUT /projects/:id/labels 或 /tasks/:id/labels）。
 * 领域侧的薄 wrapper 见 ProjectPropertyEditors.ProjectLabelsEditor / TaskPropertyEditors.TaskLabelsEditor。
 */
export function LabelsEditor({
  labels,
  workspaceId,
  scope,
  onLabelsChange,
  className,
}: LabelsEditorProps) {
  const { t } = useTranslation()
  const { data: allLabels, isLoading } = useLabels(workspaceId, scope)
  const createLabel = useCreateLabel(workspaceId)
  const { open, setOpen, ref, panelRef } = usePopover()
  // 面板锚点可为 "+" 或任意已打标签 chip：anchorRef 存被点元素供定位，anchorKey
  // 既做「再点同一锚点则收起」的判定，也作为浮层重算位置的依赖（切换锚点时 open 仍为 true）
  const anchorRef = useRef<HTMLElement | null>(null)
  const [anchorKey, setAnchorKey] = useState<string | null>(null)
  const panelStyle = useFixedPanelStyle(open, anchorRef, anchorKey)

  const [query, setQuery] = useState("")
  // 非 null 时面板切到选色视图，值为待新建的标签名
  const [creating, setCreating] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)

  // 每次打开或切换锚点都重置为干净初态：外部点击 / Escape 关闭走 usePopover 内部
  // setOpen(false)，不经过 close()，若不在打开时重置，上次搜索词与选色态会残留到下次打开
  useEffect(() => {
    if (!open) return
    setQuery("")
    setCreating(null)
    setError(null)
  }, [open, anchorKey])

  const selectedIds = labels.map((l) => l.id)
  const q = query.trim().toLowerCase()
  const filtered = useMemo(
    () => (allLabels ?? []).filter((l) => !q || l.name.toLowerCase().includes(q)),
    [allLabels, q],
  )

  // 关闭只翻 open：query/creating/error 的重置统一由上方的 open-effect 兜底
  // （外部点击 / Escape 走 usePopover 内部 setOpen(false)，本就不经过这里）
  const close = () => setOpen(false)
  // chip 与 "+" 共用同一入口：面板锚定到被点元素；再点同一锚点视为收起
  const togglePanel = (el: HTMLElement, key: string) => {
    if (open && anchorKey === key) {
      close()
      return
    }
    anchorRef.current = el
    setAnchorKey(key)
    setOpen(true)
  }
  // 勾选 / 取消勾选即完成一次增删，随即收起面板（PUT 失败由页面级横幅承接，
  // 见 ProjectDetailPage.setLabels / TaskDetailPage.setLabels 的 onError → editError）
  const toggle = (id: string) => {
    onLabelsChange(
      selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id],
    )
    close()
  }
  // 选色即新建：POST 标签成功后把新 id 追加进当前标签集合并关闭面板。
  // 防重用 ref 而非 createLabel.isPending：isPending 是 React state，同一帧内连点两枚色块时
  // 第二次读到的仍是旧值（disabled 也要等重渲染才生效），会多发一次 POST——同名同 scope
  // 被后端 409 挡住，异色则造出一枚未挂载到实体的孤儿标签（两次 onSuccess 用同一闭包的
  // 旧 selectedIds 发 PUT，后者覆盖前者）
  const submitting = useRef(false)
  const pickColor = (color: string) => {
    if (!creating || submitting.current) return
    submitting.current = true
    createLabel.mutate(
      { name: creating, color, scope },
      {
        onSuccess: (label) => {
          onLabelsChange([...selectedIds, label.id])
          close()
        },
        onError: (err) => setError(err),
        // 失败要放开闸门供重试；成功时面板已关，下次打开本就是干净初态
        onSettled: () => {
          submitting.current = false
        },
      },
    )
  }

  const errorText = displayError(t, error, "common.createFailed")
  const pending = createLabel.isPending
  // 空态三态：加载中 / 该 scope 下工作区还没有标签（提示继续输入以就地创建）/ 搜索无匹配。
  // 未就绪时 allLabels 为 undefined，不区分会闪一下错误的空态文案
  const emptyText = isLoading
    ? t("common.loading")
    : (allLabels?.length ?? 0) === 0
      ? t(scope === "project" ? "label.projectNoneYet" : "label.taskNoneYet")
      : t("label.noMatching")

  return (
    <div ref={ref} className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {labels.map((l) => (
        <LabelPill
          key={l.id}
          label={l}
          title={t("label.manage")}
          onClick={(e) => togglePanel(e.currentTarget, l.id)}
        />
      ))}

      <button
        type="button"
        aria-label={t("common.add")}
        title={t("common.add")}
        onClick={(e) => togglePanel(e.currentTarget, ADD_ANCHOR)}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-ink-muted transition-colors hover:bg-surface-3 hover:text-foreground"
      >
        <Plus className="size-3.5" />
      </button>

      {open &&
        panelStyle &&
        createPortal(
          <div ref={panelRef} className={PANEL} style={panelStyle}>
            {creating === null ? (
              <>
                <input
                  autoFocus
                  value={query}
                  disabled={pending}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("label.searchPlaceholder")}
                  aria-label={t("label.searchPlaceholder")}
                  className="w-full bg-transparent px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-ink-tertiary"
                />
                <div className="mt-1 max-h-56 overflow-y-auto">
                  {filtered.length > 0 ? (
                    filtered.map((l) => {
                      const checked = selectedIds.includes(l.id)
                      return (
                        <button
                          key={l.id}
                          type="button"
                          className={OPTION}
                          onClick={() => toggle(l.id)}
                        >
                          <span
                            className={cn(
                              "flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border",
                              checked
                                ? "border-primary bg-primary text-white"
                                : "border-border",
                            )}
                          >
                            {checked && <Check className="size-2.5" />}
                          </span>
                          <LabelDot color={l.color} />
                          <span className="truncate">{l.name}</span>
                        </button>
                      )
                    })
                  ) : q.length > 1 ? (
                    <button
                      type="button"
                      className={OPTION}
                      onClick={() => {
                        setError(null)
                        setCreating(query.trim())
                      }}
                    >
                      <Plus className="size-3.5 shrink-0" />
                      <span className="truncate">
                        {t("label.createNewPrefix")}{" "}
                        <span className="text-muted-foreground">“{query.trim()}”</span>
                      </span>
                    </button>
                  ) : (
                    <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                      {emptyText}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-2.5 p-2">
                <span className="text-xs text-muted-foreground">
                  {t("label.pickColor", { name: creating })}
                </span>
                <ColorSwatchPicker
                  value=""
                  onChange={pickColor}
                  palette={LABEL_PALETTE}
                  disabled={pending}
                />
                {pending && <span className="text-xs text-muted-foreground">{t("common.creating")}</span>}
                {errorText && <span className="text-xs text-destructive">{errorText}</span>}
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  )
}
