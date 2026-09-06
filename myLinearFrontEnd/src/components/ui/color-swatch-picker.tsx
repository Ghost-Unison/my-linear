import { useTranslation } from "react-i18next"
import { AVATAR_PALETTE } from "@/lib/color"
import { cn } from "@/lib/utils"

interface ColorSwatchPickerProps {
  value: string
  onChange: (color: string) => void
  /** 调色板可替换：缺省头像色板，标签弹窗传 LABEL_PALETTE（P1.md §2） */
  palette?: readonly string[]
  /** 提交中禁用：防止连点色块重复发起创建（标签就地新建面板传 pending） */
  disabled?: boolean
}

// 色板选择器：成员创建弹窗 / 行内编辑 / 标签弹窗共用；ring 无 offset，适配任意容器底色
export function ColorSwatchPicker({
  value,
  onChange,
  palette = AVATAR_PALETTE,
  disabled,
}: ColorSwatchPickerProps) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-1.5">
      {palette.map((c) => (
        <button
          key={c}
          type="button"
          disabled={disabled}
          aria-label={t("colorPicker.select", { color: c })}
          aria-pressed={value === c}
          onClick={() => onChange(c)}
          className={cn(
            "size-4 rounded-full transition-transform hover:scale-110",
            value === c && "scale-110 ring-2 ring-ring",
            disabled && "opacity-50 hover:scale-100",
          )}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  )
}
