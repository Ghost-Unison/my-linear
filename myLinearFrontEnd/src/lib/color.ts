// 头像色板：Linear 产品内标签色系（见 DESIGN-linear.app.md Known Gaps）
export const AVATAR_PALETTE = [
  "#5e6ad2", // lavender（品牌色）
  "#2d9cdb", // blue
  "#27a644", // green
  "#f2994a", // orange
  "#eb5757", // red
  "#9b51e0", // purple
  "#f2c94c", // yellow
  "#bb6bd9", // pink
] as const

// 标签色板：Linear 产品内标签色系（P1.md §2：预设调色板点选，约 12 色，不做自由 hex 输入）
export const LABEL_PALETTE = [
  "#5e6ad2", // lavender（品牌色）
  "#eb5757", // red
  "#f2994a", // orange
  "#f2c94c", // yellow
  "#27a644", // green
  "#2d9cdb", // blue
  "#9b51e0", // purple
  "#bb6bd9", // pink
  "#26b5ce", // cyan
  "#4cb782", // mint
  "#8d8d8d", // gray
  "#6f56d9", // indigo
] as const

/** 未设置 avatarColor 时按名字散列取确定性颜色 */
export function colorFor(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length]
}
