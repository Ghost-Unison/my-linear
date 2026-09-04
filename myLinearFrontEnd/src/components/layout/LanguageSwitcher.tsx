import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { isZhLocale } from "@/i18n"

// 语言切换器：EN / 中 两态分段控件，置于侧栏底部。
// changeLanguage 触发 useTranslation 订阅者全量重渲染，detector 自动写 localStorage 持久化。
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation()
  const isZh = isZhLocale(i18n.language)

  const seg = (active: boolean) =>
    cn(
      "flex-1 rounded px-2 py-1 text-xs font-medium transition-colors",
      active
        ? "bg-accent text-foreground"
        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
    )

  return (
    <div
      role="group"
      aria-label={t("language.switch")}
      className="flex items-center gap-1 rounded-md border border-border bg-surface-1 p-0.5"
    >
      <button type="button" onClick={() => i18n.changeLanguage("en")} className={seg(!isZh)}>
        EN
      </button>
      <button type="button" onClick={() => i18n.changeLanguage("zh-CN")} className={seg(isZh)}>
        中
      </button>
    </div>
  )
}
