import { useTranslation } from "react-i18next"
import { AVATAR_PALETTE } from "@/lib/color"
import { cn } from "@/lib/utils"

interface ColorSwatchPickerProps {
  value: string
  onChange: (color: string) => void
}

// 头像色板选择器：成员创建弹窗 / 行内编辑共用；ring 无 offset，适配任意容器底色
export function ColorSwatchPicker({ value, onChange }: ColorSwatchPickerProps) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-1.5">
      {AVATAR_PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={t("colorPicker.select", { color: c })}
          aria-pressed={value === c}
          onClick={() => onChange(c)}
          className={cn(
            "size-4 rounded-full transition-transform hover:scale-110",
            value === c && "scale-110 ring-2 ring-ring",
          )}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  )
}
