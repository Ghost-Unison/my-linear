import { cn } from "@/lib/utils"

// 优先级刻度与后端一致：0 No priority / 1 Urgent / 2 High / 3 Medium / 4 Low
export const PRIORITY_LABELS: Record<number, string> = {
  0: "No priority",
  1: "Urgent",
  2: "High",
  3: "Medium",
  4: "Low",
}

/** Select 选项集：新建弹窗与属性编辑共用 */
export const PRIORITY_OPTIONS = [0, 1, 2, 3, 4].map((p) => ({
  value: p,
  label: PRIORITY_LABELS[p],
  icon: <PriorityIcon value={p} />,
}))

const BAR_ACTIVE = "#d0d6e0" // ink-muted
const BAR_INACTIVE = "#3e3e44" // hairline-tertiary

// 对齐 Linear：No priority = 三点；Urgent = 橙色圆角方块 "!"；High/Medium/Low = 3/2/1 根信号条
export function PriorityIcon({ value, className }: { value: number; className?: string }) {
  if (value === 1) {
    return (
      <svg viewBox="0 0 16 16" className={cn("size-4 shrink-0", className)} aria-hidden>
        <rect x="1.5" y="1.5" width="13" height="13" rx="3.5" fill="#f2994a" />
        <path d="M8 4.5v4" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="8" cy="11.2" r="1" fill="#fff" />
      </svg>
    )
  }
  if (value >= 2 && value <= 4) {
    const filled = value === 2 ? 3 : value === 3 ? 2 : 1
    const bars = [
      { x: 2, y: 10, h: 5 },
      { x: 6.5, y: 6, h: 9 },
      { x: 11, y: 2, h: 13 },
    ]
    return (
      <svg viewBox="0 0 16 16" className={cn("size-4 shrink-0", className)} aria-hidden>
        {bars.map((b, i) => (
          <rect
            key={i}
            x={b.x}
            y={b.y}
            width={3}
            height={b.h}
            rx={1}
            fill={i < filled ? BAR_ACTIVE : BAR_INACTIVE}
          />
        ))}
      </svg>
    )
  }
  // 0 No priority：三点
  return (
    <svg viewBox="0 0 16 16" className={cn("size-4 shrink-0", className)} aria-hidden>
      {[3, 8, 13].map((cx) => (
        <circle key={cx} cx={cx} cy={8} r={1.2} fill="#8a8f98" />
      ))}
    </svg>
  )
}
