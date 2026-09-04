import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import type { ProjectStatus } from "@/api/types"

/** 展示/选项顺序 = 业务生命周期序（对齐后端 projectStatusRank，非字典序）；与语言无关 */
export const PROJECT_STATUS_ORDER: readonly ProjectStatus[] = [
  "backlog",
  "planned",
  "in_progress",
  "completed",
  "canceled",
]

/** 状态标签函数（组件内订阅语言变更）：key = enums.projectStatus.<status> */
export function useProjectStatusLabel(): (s: ProjectStatus) => string {
  const { t } = useTranslation()
  return (s) => t(`enums.projectStatus.${s}`)
}

/** Select 选项集：新建弹窗与详情属性编辑共用（经 hook 在组件内求值，随语言切换刷新） */
export function useProjectStatusOptions() {
  const { t } = useTranslation()
  return PROJECT_STATUS_ORDER.map((s) => ({
    value: s,
    label: t(`enums.projectStatus.${s}`),
    icon: <ProjectStatusIcon status={s} />,
  }))
}

// 状态图标对齐 Linear：圆环填充度即进度隐喻（虚线 → 空心 → 半填 → 全填✓）；取消 = ✕
export function ProjectStatusIcon({
  status,
  className,
}: {
  status: ProjectStatus
  className?: string
}) {
  const cls = cn("size-4 shrink-0", className)
  switch (status) {
    case "backlog":
      return (
        <svg viewBox="0 0 16 16" className={cls} aria-hidden>
          <circle
            cx="8"
            cy="8"
            r="6"
            fill="none"
            stroke="#8a8f98"
            strokeWidth="1.5"
            strokeDasharray="2.4 2.4"
            strokeLinecap="round"
          />
        </svg>
      )
    case "planned":
      return (
        <svg viewBox="0 0 16 16" className={cls} aria-hidden>
          <circle cx="8" cy="8" r="6" fill="none" stroke="#8a8f98" strokeWidth="1.5" />
        </svg>
      )
    case "in_progress":
      return (
        <svg viewBox="0 0 16 16" className={cls} aria-hidden>
          <circle cx="8" cy="8" r="6" fill="none" stroke="#f2c94c" strokeWidth="1.5" />
          <path d="M8 2 A6 6 0 0 1 8 14 Z" fill="#f2c94c" />
        </svg>
      )
    case "completed":
      return (
        <svg viewBox="0 0 16 16" className={cls} aria-hidden>
          <circle cx="8" cy="8" r="7" fill="#5e6ad2" />
          <path
            d="M5 8.2 7.2 10.4 11 6"
            fill="none"
            stroke="#fff"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )
    case "canceled":
      return (
        <svg viewBox="0 0 16 16" className={cls} aria-hidden>
          <circle cx="8" cy="8" r="6" fill="none" stroke="#8a8f98" strokeWidth="1.5" />
          <path
            d="M5.8 5.8 10.2 10.2 M10.2 5.8 5.8 10.2"
            stroke="#8a8f98"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      )
  }
}
