// Filter 按钮（页头圆形漏斗）+ 纯添加级联菜单（P2.md §2.1，Linear 实测定稿）：
// shadcn DropdownMenu 实现，二级值面板经 Radix Sub 悬浮飞出（Dates 组三级飞出：
// Dates → 日期字段 → 阶梯清单）。菜单不显示已有条件：值级勾选态恒空初态，每次开合为
// 一个添加会话——会话状态在 Sub 内容组件内（Radix 关闭即卸载，重开 = 新会话）：会话内
// 首次勾选追加一条新条件 chip，其后勾选更新该会话条件的 values，全部取消则移除会话条件
//（条件列表模型，P2.md §1.7）。
import { useEffect, useRef, useState, type ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  Box,
  Calendar,
  ChartColumn,
  CircleDashed,
  ListFilter,
  Tag,
  User,
  Users,
  type LucideIcon,
} from "lucide-react"
import {
  NONE,
  OVERDUE,
  defaultOpOf,
  ladderCodesOf,
  ladderLabelKey,
  normalizeOp,
  surfaceSpecs,
  toggleValues,
  type FieldSpec,
  type FilterCond,
  type Surface,
} from "@/lib/filter-state"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { RoundIconButton } from "@/components/ui/round-icon-button"
import { ValueCheckList, prefetchFilterOptions } from "./filter-options"

/** 字段图标映射（Linear 同位图标）：status 虚线圆 / priority 柱状 / labels 标签 / lead・assignee 单人 / members 多人 / project 盒 */
const FIELD_ICONS: Record<string, LucideIcon> = {
  status: CircleDashed,
  priority: ChartColumn,
  labels: Tag,
  lead: User,
  assignee: User,
  member: Users,
  project: Box,
}

const SUB_TRIGGER = "text-xs"
const SUB_CONTENT = "w-56"

// Radix MenuSubContent 内置 onFocusOutside：焦点离开 sub（target ≠ sub trigger）即 onOpenChange(false)。
// 本菜单贴近视口右缘时 popper 把飞出清单翻到 side="left"，而 grace 判定要求 pointerDirRef === side
//（该 ref 初值 "right" 且只被根菜单 DOM 内的 pointermove 更新，portal 里的飞出清单永不更新它），
// 于是指针移入飞出清单时 grace 失败 → onItemLeave 把焦点抢回根菜单 → sub 被误关（会话态随之卸载）。
// 这里用悬挂守卫阻断：仅当指针仍在飞出清单内时忽略 focus-outside 误关；移开到其他字段行仍照常互斥关闭。
function SubGuard({ children }: { children: ReactNode }) {
  const hovering = useRef(false)
  return (
    <DropdownMenuSubContent
      className={SUB_CONTENT}
      onPointerEnter={() => (hovering.current = true)}
      onPointerLeave={() => (hovering.current = false)}
      onFocusOutside={(e) => {
        if (hovering.current) e.preventDefault()
      }}
    >
      {children}
    </DropdownMenuSubContent>
  )
}

interface FilterSurfaceProps {
  workspaceId: string
  surface: Surface
  conds: FilterCond[]
  onChange: (next: FilterCond[]) => void
}

/** 页头 filter 按钮：Linear 圆形风格，非默认态（存在条件）亮蓝点 */
export function FilterButton(props: FilterSurfaceProps) {
  const { t } = useTranslation()
  return (
    <FilterDropdown
      {...props}
      trigger={
        <RoundIconButton label={t("filter.button")} active={props.conds.length > 0}>
          <ListFilter className="size-4" />
        </RoundIconButton>
      }
    />
  )
}

/** 纯添加级联菜单（FilterButton 与 chip 行 "+" 共用）：主菜单字段清单 →
 * 悬浮飞出值勾选清单；日期字段收进 Dates 组三级飞出 */
export function FilterDropdown({
  workspaceId,
  surface,
  conds,
  onChange,
  trigger,
}: FilterSurfaceProps & { trigger: ReactNode }) {
  const { t } = useTranslation()
  // 根菜单受控：值行「其余区」点击要能直接关闭整个菜单（Linear 规格），故持有 open
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  // 打开菜单即预取本面值集（members/labels/projects），悬浮任一属性打开面板秒开、零 loading；
  // staleTime: Infinity 命中缓存，二次打开不再重复 GET（划过未选中属性也不各自发请求）
  const qc = useQueryClient()
  useEffect(() => {
    if (open) prefetchFilterOptions(qc, workspaceId, surface)
  }, [open, qc, workspaceId, surface])
  const specs = surfaceSpecs(surface)
  const plain = specs.filter((s) => s.kind === "single" || s.kind === "multi")
  const dates = specs.filter((s) => s.kind === "day" || s.kind === "moment")
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          {plain.map((s) => {
            const Icon = FIELD_ICONS[s.field]
            return (
              <DropdownMenuSub key={s.field}>
                <DropdownMenuSubTrigger className={SUB_TRIGGER}>
                  {Icon && <Icon />}
                  <span className="truncate">{t(s.labelKey)}</span>
                </DropdownMenuSubTrigger>
                <SubGuard>
                  <ValueSessionList
                    workspaceId={workspaceId}
                    spec={s}
                    conds={conds}
                    onChange={onChange}
                    onClose={close}
                  />
                </SubGuard>
              </DropdownMenuSub>
            )
          })}
          {dates.length > 0 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className={SUB_TRIGGER}>
                <Calendar />
                <span className="truncate">{t("filter.dates")}</span>
              </DropdownMenuSubTrigger>
              <SubGuard>
                {dates.map((s) => (
                  <DropdownMenuSub key={s.field}>
                    <DropdownMenuSubTrigger className={SUB_TRIGGER} inset>
                      <span className="truncate">{t(s.labelKey)}</span>
                    </DropdownMenuSubTrigger>
                    <SubGuard>
                      <LadderList spec={s} conds={conds} onChange={onChange} />
                    </SubGuard>
                  </DropdownMenuSub>
                ))}
              </SubGuard>
            </DropdownMenuSub>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** 值勾选飞出面板：添加会话语义（组件挂载 = 会话开始，Radix 关闭卸载 = 会话结束）。
 * 行分两区（Linear 实测）：checkbox 区 = 本会话累积勾选（多选合并，菜单不关）；其余区 = 单值成
 * 一条 chip 并直接关闭整个菜单。多值字段 none 哨兵与真实值互斥（勾 No labels 即取消其它勾选） */
function ValueSessionList({
  workspaceId,
  spec,
  conds,
  onChange,
  onClose,
}: {
  workspaceId: string
  spec: FieldSpec
  conds: FilterCond[]
  onChange: (next: FilterCond[]) => void
  onClose: () => void
}) {
  const [selected, setSelected] = useState<string[]>([])
  // 本会话已追加条件的下标；null = 会话内尚未追加条件
  const [sessionIndex, setSessionIndex] = useState<number | null>(null)
  const toggle = (value: string) => {
    const next = toggleValues(spec, selected, value)
    setSelected(next)
    if (sessionIndex === null) {
      if (next.length === 0) return
      onChange([...conds, { field: spec.field, op: defaultOpOf(spec), values: next }])
      setSessionIndex(conds.length)
    } else if (next.length === 0) {
      onChange(conds.filter((_, i) => i !== sessionIndex))
      setSessionIndex(null)
    } else {
      onChange(
        conds.map((c, i) =>
          i === sessionIndex ? { ...c, op: normalizeOp(spec, c.op, next), values: next } : c,
        ),
      )
    }
  }
  // 其余区：单值成一条 chip（默认操作符）并直接关闭整个菜单
  const pick = (value: string) => {
    onChange([...conds, { field: spec.field, op: defaultOpOf(spec), values: [value] }])
    onClose()
  }
  return (
    <ValueCheckList
      workspaceId={workspaceId}
      spec={spec}
      selected={selected}
      onToggle={toggle}
      onPick={pick}
    />
  )
}

/** 阶梯飞出面板（三级）：点阶梯追加单值日期条件（默认操作符随方向，P2.md §2.4）并关闭菜单；
 * Overdue 逾期谓词置顶（is + overdue），No due date 等空值条件走 is + none */
function LadderList({
  spec,
  conds,
  onChange,
}: {
  spec: FieldSpec
  conds: FilterCond[]
  onChange: (next: FilterCond[]) => void
}) {
  const { t } = useTranslation()
  // 同字段同操作符同值已存在则不重复追加（日期阶梯点选幂等）
  const add = (op: string, values: string[]) => {
    if (conds.some((c) => c.field === spec.field && c.op === op && c.values.join() === values.join()))
      return
    onChange([...conds, { field: spec.field, op, values }])
  }
  return (
    <DropdownMenuGroup>
      {spec.allowOverdue && (
        <DropdownMenuItem className="text-xs" onClick={() => add("is", [OVERDUE])}>
          <span className="truncate">{t("filter.ladder.overdue")}</span>
        </DropdownMenuItem>
      )}
      {ladderCodesOf(spec).map((code) => (
        <DropdownMenuItem
          key={code}
          className="text-xs"
          onClick={() => add(defaultOpOf(spec), [code])}
        >
          <span className="truncate">{t(ladderLabelKey(spec, code))}</span>
        </DropdownMenuItem>
      ))}
      {spec.allowNone && spec.noneKey && (
        <DropdownMenuItem
          className="text-xs"
          onClick={() => add("is", [NONE])}
        >
          <span className="truncate">{t(spec.noneKey)}</span>
        </DropdownMenuItem>
      )}
    </DropdownMenuGroup>
  )
}
